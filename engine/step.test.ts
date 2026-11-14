// Claude Code 실행기와 Agent 노드 실행 시험(T19). 실제 claude 대신 같은 stream-json을 내는 가짜 CLI를 쓴다.
// C1: Run 하나를 띄우면 노드 시작·활동·끝 이벤트와 transcript가 남고 검사 규칙을 통과한다. 다른 인터페이스에서 취소하면
//     프로세스 그룹이 끝난다(Engine 인수 기준 13). C2: Agent 보고는 증거가 되지 않고 공식 상태를 바꾸지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, me, realProcs } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { normalize, prepare } from './runner.ts';
import { card, conditionState, foldAll } from '../tools/readmodel.ts';

const FAKE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const PLAN = { project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [{ id: 'A', name: 'A', phase: 'P1', goal: '인사 파일을 만든다', outputs: { out: '코드' }, conditions: [{ id: 'A-C1', method: 'auto', slot: 'out', text: '단위 테스트 통과' }] }] };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();

function running(opts: { configure?: boolean; begin?: boolean } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'catena-step-'));
  const repo = join(base, 'repo');
  execFileSync('mkdir', [repo]);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험 저장소\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: PLAN } }).ok);
  if (opts.configure !== false) assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: sha, model: 'claude-test-1' } }).ok);
  const holder = me();
  if (opts.begin !== false) assert.ok(beginRun(s, 'A-r1', holder, 30_000).ok);
  return { base, repo, sha, s, holder };
}
const types = (s: Store) => s.events().map(e => e.type);

test('C1: Agent 노드를 띄우면 새 worktree에서 실행되고, 노드 시작·활동·끝과 transcript가 기록되며 검사 규칙을 통과한다', async () => {
  const { base, repo, sha, s, holder } = running();
  const argsFile = join(base, 'args.json');
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CLAUDE_ARGS = argsFile;
  const r = await runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 });
  assert.deepEqual([r.result, r.exit, r.cancelled], ['성공', 0, false]);

  const got = JSON.parse(readFileSync(argsFile, 'utf8'));
  for (const f of ['-p', '--output-format', 'stream-json', '--no-session-persistence', '--permission-mode', 'acceptEdits', '--model', 'claude-test-1', '--max-turns']) assert.ok(got.argv.includes(f), f);
  assert.match(got.prompt, /인사 파일을 만든다/);
  const wt = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'A-r1'").get() as any).payload).worktree;
  assert.equal(git(wt, 'rev-parse', 'HEAD'), sha, 'worktree는 Baseline의 base_ref에서 시작한다');
  assert.ok(existsSync(join(wt, 'hello.txt')) && !existsSync(join(repo, 'hello.txt')), 'Agent는 Run 전용 worktree에서 일했다');
  assert.ok(got.tmpdir.endsWith(join('tmp', 'A-r1')), 'Run 전용 TMPDIR');

  const evs = s.events().filter(e => e.payload.run_id === 'A-r1' && e.type !== 'run.state_changed' && e.type !== 'run.created');
  assert.deepEqual(evs.map(e => e.type), ['node.started', 'agent.activity', 'agent.activity', 'submission.created', 'agent.activity', 'usage.recorded', 'node.finished']);
  assert.deepEqual(evs[0].payload.profile, { runtime: 'claude-code', model: 'claude-test-1' });
  assert.deepEqual(evs.slice(1, 3).map(e => [e.payload.kind, e.payload.source]), [['도구 호출', 'Agent 보고'], ['메시지', 'Agent 보고']]);
  assert.equal(evs[4].payload.source, '시스템 기록');
  assert.equal(s.refCheck(evs[4].payload.raw_ref), undefined, 'transcript 원문이 저장소에 있다');
  assert.match(readFileSync(join(s.dir, 'artifacts', 'sha256', evs[4].payload.raw_ref.id.slice(7)), 'utf8'), /"type":"result"/);
  assert.deepEqual([evs[5].payload.cost_usd, evs[5].payload.reliability], [0.12, '추정값']);
  assert.equal(evs[6].payload.result, '성공');
  assert.doesNotThrow(() => foldAll(s.events(), s.refCheck));
  s.close();
});

test('C1: 다른 인터페이스에서 취소하면 감독 프로세스가 프로세스 그룹을 끝내고 Run을 취소로 닫는다(Engine 인수 기준 13)', async () => {
  const { s, holder } = running();
  process.env.FAKE_CLAUDE_MODE = 'slow';
  delete process.env.FAKE_CLAUDE_ARGS;
  const step = runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 });
  let pgid = 0;
  for (const until = Date.now() + 10_000; !pgid; await new Promise(r => setTimeout(r, 20))) {
    if (Date.now() > until) throw new Error('Runner가 시작되지 않았다');
    pgid = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'A-r1'").get() as any).payload).process?.pgid ?? 0;
  }
  await new Promise(r => setTimeout(r, 200));
  // 다른 인터페이스(CLI·Web)는 같은 저장소를 따로 열어 명령을 보낸다
  const other = openStore(s.dir);
  const cancel = execute(other, { command: 'run.cancel', principal: human, channel: 'cli-tty', args: { run_id: 'A-r1' } });
  other.close();
  assert.ok(cancel.ok, !cancel.ok ? cancel.message : '');
  const r = await step;
  assert.deepEqual([r.result, r.cancelled], ['중단', true]);
  assert.equal(realProcs.groupAlive(pgid), false, 'Agent와 그 하위 프로세스(sleep)가 모두 끝났다');
  assert.equal((s.db.prepare("SELECT state FROM runs WHERE run_id = 'A-r1'").get() as any).state, '취소');
  assert.equal((s.db.prepare("SELECT status FROM tickets WHERE run_id = 'A-r1'").get() as any).status, '취소');
  assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM run_leases').get() as any).n, 0);
  const tail = s.events().slice(-2).map(e => [e.type, e.payload.result ?? e.payload.to, e.payload.reason ?? null]);
  assert.deepEqual(tail, [['node.finished', '중단', null], ['run.state_changed', '취소', '사용자 취소']]);
  assert.equal(card(foldAll(s.events(), s.refCheck), 'A').exec, '취소');
  s.close();
});

test('C1: 대기 중인 Run은 바로 취소되고, 권한 모드가 정해지지 않은 Project에서는 Agent를 띄우지 않는다', async () => {
  const { s, holder } = running({ configure: false });
  const before = types(s).length;
  await assert.rejects(runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE }), /권한 모드/);
  assert.equal(types(s).length, before, '노드를 시작하지 않았다');
  s.close();

  const w = running({ begin: false });
  const c = execute(w.s, { command: 'run.cancel', principal: human, channel: 'cli-tty', args: { run_id: 'A-r1' } });
  assert.ok(c.ok && c.events.map(e => [e.type, e.payload.to]).join() === 'run.state_changed,취소', '대기 중인 Run은 바로 취소된다');
  assert.equal((w.s.db.prepare("SELECT status FROM tickets WHERE run_id = 'A-r1'").get() as any).status, '취소');
  assert.ok(!execute(w.s, { command: 'run.cancel', principal: human, channel: 'cli-tty', args: { run_id: 'A-r1' } }).ok, '끝난 Run은 다시 취소하지 않는다');
  assert.ok(execute(w.s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: w.sha } }).ok, '취소 뒤 새 Run으로 다시 착수할 수 있다');
  w.s.close();
});

test('C2: Agent의 "테스트 통과" 보고는 증거가 되지 않고 완료 조건과 인수 상태를 바꾸지 않는다', async () => {
  const { s, holder } = running();
  process.env.FAKE_CLAUDE_MODE = 'ok';
  delete process.env.FAKE_CLAUDE_ARGS;
  await runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 });
  const m = foldAll(s.events(), s.refCheck);
  assert.ok(m.activities.some((a: any) => /테스트를 통과/.test(a.summary) && a.source === 'Agent 보고'));
  assert.equal(m.evidence.size, 0);
  assert.equal(conditionState(m, 'A', 'A-C1'), '미검증');
  assert.equal(card(m, 'A').acceptance, '미인수');
  assert.equal(s.events().filter(e => ['evidence.recorded', 'acceptance.recorded'].includes(e.type)).length, 0);
  s.close();
});

test('정규화(R-7): stream-json 종류마다 이벤트 초안으로 바꾸고, 표에 없는 종류는 버린다', () => {
  assert.deepEqual(normalize({ type: 'system', subtype: 'init', model: 'm', session_id: 's' }), [{ type: 'init', payload: { model: 'm', session_id: 's' } }]);
  assert.deepEqual(normalize({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, { type: 'text', text: ' 끝 ' }] } }).map(d => [d.type, (d.payload as any).kind, (d.payload as any).source]),
    [['agent.activity', '도구 호출', 'Agent 보고'], ['agent.activity', '메시지', 'Agent 보고']]);
  assert.deepEqual(normalize({ type: 'result', subtype: 'success', total_cost_usd: 1.5, usage: { input_tokens: 10, output_tokens: 5 } }), [{ type: 'result', payload: { ok: true, subtype: 'success', cost_usd: 1.5, tokens: 15 } }]);
  assert.deepEqual(normalize({ type: 'user', message: { content: [] } }), []);
  assert.deepEqual(normalize('줄'), []);
  const spec = prepare({ worktree: '/w', tmpDir: '/t', prompt: 'p', permissionMode: 'plan', maxTurns: 3, budgetUsd: 2 });
  assert.deepEqual(spec.command, ['claude']);
  assert.ok(spec.argv.join(' ').includes('--max-budget-usd 1.80'), '비용 상한은 예약보다 낮게');
  assert.equal(spec.env.TMPDIR, '/t');
  assert.ok(!spec.argv.includes('--settings') && !spec.argv.includes('--tools'), '사용자 설정을 덮어쓰지 않는다');
});
