// Codex 실행기 시험(T37). 실제 codex 대신 같은 JSONL을 내는 가짜 CLI를 쓴다.
// C1: Codex로 띄운 Run도 노드 시작·활동·끝, 원문, Agent 결과 기록이 남고 검사 규칙을 통과한다.
// C2: 한 계획에서 Task마다 Claude Code와 Codex를 골라 실행하고, 어느 Agent 프로그램이 했는지 노드 기록에 남는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, me } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { runCheckNode } from './verify.ts';
import { recordAcceptance } from './accept.ts';
import { normalizeCodex } from './codex.ts';
import { foldAll } from '../tools/readmodel.ts';

const CLAUDE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const CODEX = [process.execPath, new URL('./fixtures/fake-codex.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const check = { command: 'sh checks/test.sh', files: ['checks/test.sh'] };
// A는 Claude Code, B는 Codex. B는 A의 결과를 입력으로 받는다
const PLAN = { project: { project_id: 'p', name: '여러 Agent 공정' }, phases: [{ id: 'P1', name: '구현' }], milestones: [], wbs: [
  { id: 'A', name: '인사 파일 구현', phase: 'P1', goal: '인사 파일을 만든다', outputs: { out: '코드' },
    conditions: [{ id: 'A-C1', method: 'auto', slot: 'out', text: '인사 파일이 있다', verify: check }] },
  { id: 'B', name: '인사 사용 구현', phase: 'P1', goal: '인사 파일을 쓴다', agent: 'codex', inputs: { greet: 'A.out' }, outputs: { out: '코드' },
    conditions: [{ id: 'B-C1', method: 'auto', slot: 'out', text: '인사 파일이 있다', verify: check }] }] };

function project(plan: any) {
  const base = mkdtempSync(join(tmpdir(), 'catena-codex-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'checks'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'checks', 'test.sh'), 'test -f hello.txt\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  return { base, s, sha: git(repo, 'rev-parse', 'HEAD') };
}
async function run(s: any, task: string, sha: string, command: string[]) {
  const r = execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: task, base_ref: sha } });
  assert.ok(r.ok, !r.ok ? r.message : '');
  const holder = me();
  assert.ok(beginRun(s, `${task}-r1`, holder, 30_000).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CODEX_MODE = 'ok';
  const step = await runAgentNode(s, { run_id: `${task}-r1`, node_id: 'work', iteration: 1, holder, command, tickMs: 50 });
  return { holder, step };
}

test('T37-C1: Codex로 띄운 Run도 노드 시작·활동·끝, 원문, Agent 결과 기록이 남고 검사 규칙을 통과한다', async () => {
  const { base, s, sha } = project({ ...PLAN, wbs: [{ ...PLAN.wbs[0], agent: 'codex' }] });
  const argsFile = join(base, 'codex-args.json');
  process.env.FAKE_CODEX_ARGS = argsFile;
  const { step } = await run(s, 'A', sha, CODEX);
  delete process.env.FAKE_CODEX_ARGS;
  assert.deepEqual([step.result, step.submission?.scope_check], ['성공', '통과']);
  const got = JSON.parse(readFileSync(argsFile, 'utf8'));
  const wt = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'A-r1'").get() as any).payload).worktree;
  assert.deepEqual(got.argv.slice(0, 5), ['exec', '--json', '--ephemeral', '-C', wt], 'Run 전용 worktree에서 비대화형으로 띄운다');
  assert.match(got.prompt, /인사 파일을 만든다/);
  const evs = s.events().filter(e => e.payload.run_id === 'A-r1' && e.type !== 'run.state_changed' && e.type !== 'run.created');
  assert.deepEqual(evs.map(e => e.type), ['node.started', 'agent.activity', 'agent.activity', 'agent.activity', 'submission.created', 'agent.activity', 'usage.recorded', 'node.finished']);
  assert.deepEqual(evs[0].payload.profile, { runtime: 'codex', model: '기본값' });
  assert.deepEqual(evs.slice(1, 4).map(e => [e.payload.kind, e.payload.source]), [['도구 호출', 'Agent 보고'], ['도구 호출', 'Agent 보고'], ['메시지', 'Agent 보고']]);
  assert.equal(evs[5].payload.source, '시스템 기록', 'JSONL 원문(transcript)은 시스템 기록');
  assert.deepEqual([evs[6].payload.tokens, evs[6].payload.reliability], [280, '알 수 없음'], 'Codex는 비용을 보고하지 않아 토큰만 남는다');
  assert.doesNotThrow(() => foldAll(s.events(), s.refCheck));
  s.close();
});

test('T37-C2: 한 계획에서 A는 Claude Code, B는 Codex로 실행하고, 노드 기록에 어느 Agent 프로그램이 했는지 남는다', async () => {
  const { s, sha } = project(PLAN);
  const a = await run(s, 'A', sha, CLAUDE);
  const [ca] = await runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder: a.holder, submission_id: 'A-r1-s1' });
  assert.equal(ca.result, '통과');
  assert.ok(recordAcceptance(s, 'A-r1-s1').ok, '자동 조건만 있는 A는 통과한 근거로 검수된다');
  const b = await run(s, 'B', sha, CODEX);
  assert.equal(b.step.result, '성공');
  const [cb] = await runCheckNode(s, { run_id: 'B-r1', iteration: 1, holder: b.holder, submission_id: 'B-r1-s1' });
  assert.equal(cb.result, '통과');
  assert.ok(recordAcceptance(s, 'B-r1-s1').ok);

  const m = foldAll(s.events(), s.refCheck);
  const who = m.nodeLog.filter((l: any) => l.node === 'work').map((l: any) => [l.task, l.profile.runtime]);
  assert.deepEqual(who, [['A', 'claude-code'], ['B', 'codex']], '한 공정에서 Task마다 다른 Agent 프로그램');
  const bl = JSON.parse((s.db.prepare("SELECT payload FROM baselines WHERE baseline_id = 'B-r1-b'").get() as any).payload);
  assert.equal(bl.base_ref, JSON.parse((s.db.prepare("SELECT payload FROM submissions WHERE submission_id = 'A-r1-s1'").get() as any).payload).commit, 'B는 A가 검수된 결과에서 시작');
  assert.ok(m.taskAccepted.has('A') && m.taskAccepted.has('B'));
  s.close();
});

test('T37: Codex JSONL 정규화 — 끝난 항목만 활동으로, 추론은 버리고, 턴 끝은 토큰으로', () => {
  assert.deepEqual(normalizeCodex({ type: 'thread.started', thread_id: 't1' }), [{ type: 'init', payload: { session_id: 't1' } }]);
  assert.deepEqual(normalizeCodex({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } }), []);
  assert.equal((normalizeCodex({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test', exit_code: 1 } })[0].payload as any).summary, '명령 npm test (종료 코드 1)');
  assert.equal((normalizeCodex({ type: 'item.completed', item: { type: 'file_change', changes: [{ path: 'a.ts', kind: 'update' }] } })[0].payload as any).summary, '파일 변경 update a.ts');
  assert.deepEqual(normalizeCodex({ type: 'item.completed', item: { type: 'reasoning', text: '생각' } }), []);
  assert.deepEqual(normalizeCodex({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }), [{ type: 'result', payload: { ok: true, subtype: 'turn.completed', tokens: 15 } }]);
  assert.equal((normalizeCodex({ type: 'turn.failed', error: {} })[0].payload as any).ok, false);
  const bad = execute(openStore(mkdtempSync(join(tmpdir(), 'catena-codex-'))), { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: { ...PLAN, wbs: [{ ...PLAN.wbs[0], agent: 'gemini' }] } } });
  assert.ok(!bad.ok && /agent는/.test(bad.message), '계획 파일의 agent는 Engine이 띄울 수 있는 프로그램이어야 한다');
});
