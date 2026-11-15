// 승인과 검수 시험(T22). C1: 비대화형 실행과 Runner 안에서 온 승인 요청이 거부된다(Engine 인수 기준 11).
// C2: 검수 기록에서 Baseline, 근거, 승인의 VersionRef를 따라갈 수 있고, 검사 뒤 작업공간이 바뀌어도 검수 대상이 바뀌지 않는다(기준 6, 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, me } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { runCheckNode } from './verify.ts';
import { CHANNEL_NOTE, recordAcceptance, requestApproval } from './accept.ts';
import { card, foldAll } from '../tools/readmodel.ts';

const FAKE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const CLI = new URL('../tools/catena.ts', import.meta.url).pathname;
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
// A: 자동 조건(검사 파일) + 사용자 확인 조건. B는 A의 결과를 입력으로 받는다
const PLAN = { project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [], wbs: [
  { id: 'A', name: 'A', phase: 'P1', goal: '인사 파일을 만든다', outputs: { out: '코드' }, conditions: [
    { id: 'A-C1', method: 'auto', slot: 'out', text: '인사 파일이 있다', verify: { command: 'sh checks/test.sh', files: ['checks/test.sh'] } },
    { id: 'A-C2', method: 'human', slot: 'out', text: '문구 검토' }] },
  { id: 'B', name: 'B', phase: 'P1', goal: '인사 파일을 쓴다', inputs: { greet: 'A.out' }, outputs: { out: '코드' }, conditions: [{ id: 'B-C1', method: 'auto', slot: 'out', text: '시험' }] }] };

async function checked() {
  const base = mkdtempSync(join(tmpdir(), 'catena-accept-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'checks'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'checks', 'test.sh'), 'test -f hello.txt\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const dir = join(base, 'store');
  const s = openStore(dir);
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: PLAN } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: sha } }).ok);
  const holder = me();
  assert.ok(beginRun(s, 'A-r1', holder, 30_000).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok';
  delete process.env.FAKE_CLAUDE_ARGS;
  await runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 });
  const [c] = await runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder, submission_id: 'A-r1-s1' });
  assert.equal(c.result, '통과');
  const r = requestApproval(s, 'A-r1-s1');
  assert.ok(r.ok, !r.ok ? r.message : '');
  return { base, repo, dir, s, sha, approval_id: 'A-r1-s1-a1' };
}

test('T22-C1: 승인은 대화형 CLI에서만 받는다. 비대화형 실행·Runner 채널·사람이 아닌 주체의 승인은 거부된다', async () => {
  const { s, dir, approval_id } = await checked();
  const decide = (principal: any, channel: string) => execute(s, { command: 'approval.decide', principal, channel: channel as any, args: { approval_id, decision: '승인' } });
  for (const ch of ['cli-batch', 'runner', 'mcp']) {
    const r = decide(human, ch);
    assert.ok(!r.ok && r.reason === '권한 거부', ch);
  }
  assert.ok(!decide({ kind: 'system', id: 'orchestrator' }, 'cli-tty').ok, '사람이 아닌 주체');
  assert.ok(!decide({ kind: 'agent', id: 'worker-1' }, 'cli-tty').ok, 'Agent 주체');
  // CLI: 파이프로 부르면(비대화형) 거부되고, Runner 안(CATENA_RUN_ID)에서 부르면 거부된다
  const cli = (env: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, 'approve', approval_id, '--store', dir], { encoding: 'utf8', input: '승인\n', env: { ...process.env, ...env } });
  const piped = cli();
  assert.equal(piped.status, 4, piped.stderr);
  assert.match(piped.stderr, /대화형 CLI에서만/);
  assert.equal(cli({ CATENA_RUN_ID: 'A-r1' }).status, 4);
  assert.ok(!foldAll(s.events(), s.refCheck).approvals.get(approval_id).decision, '아무 결정도 남지 않았다');
  // 대화형 채널의 승인: 14-15 한계를 함께 남긴다
  const ok = decide(human, 'cli-tty');
  assert.ok(ok.ok);
  assert.equal(ok.events[0].payload.channel_note, CHANNEL_NOTE);
  assert.ok(!decide(human, 'cli-tty').ok, '이미 결정한 승인 요청');
  s.close();
});

test('T22-C2: 검수 기록에서 Baseline·근거·승인·commit을 따라갈 수 있고, 검사 뒤 작업공간이 바뀌어도 검수 대상은 그대로다', async () => {
  const { s, repo, sha, approval_id } = await checked();
  // 승인 전에는 사용자 확인 조건이 덮이지 않아 검수할 수 없다
  assert.ok(!recordAcceptance(s, 'A-r1-s1').ok);
  assert.ok(execute(s, { command: 'approval.decide', principal: human, channel: 'cli-tty', args: { approval_id, decision: '승인', comment: '문구 확인' } }).ok);

  // 검사 뒤 Agent 작업공간을 바꾼다: 검수 대상은 결과 commit이므로 바뀌지 않아야 한다
  const wt = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'A-r1'").get() as any).payload).worktree;
  writeFileSync(join(wt, 'hello.txt'), '바뀐 내용\n');
  writeFileSync(join(wt, 'extra.txt'), '검사 뒤에 생긴 파일\n');

  const r = recordAcceptance(s, 'A-r1-s1');
  assert.ok(r.ok, !r.ok ? r.message : '');
  assert.deepEqual(r.events.map(e => [e.type, e.payload.scope]), [['acceptance.recorded', 'slot'], ['acceptance.recorded', 'task']]);
  const acc = r.events[0].payload;
  const sub = JSON.parse((s.db.prepare("SELECT payload FROM submissions WHERE submission_id = 'A-r1-s1'").get() as any).payload);
  assert.equal(acc.commit, sub.commit);
  assert.equal(git(repo, 'show', `${acc.commit}:hello.txt`), '안녕', '검수한 commit의 내용은 검사한 그대로다');
  assert.throws(() => git(repo, 'show', `${acc.commit}:extra.txt`), '검사 뒤 작업공간의 변경은 검수 대상에 들어가지 않는다');
  // VersionRef 따라가기: Baseline, 근거, 승인, 계약
  assert.ok(s.db.prepare('SELECT 1 FROM baselines WHERE baseline_id = ?').get(acc.baseline_id));
  for (const id of acc.evidence_ids) assert.equal((s.db.prepare('SELECT submission_id FROM evidence WHERE evidence_id = ?').get(id) as any).submission_id, 'A-r1-s1');
  assert.equal(JSON.parse((s.db.prepare('SELECT payload FROM approval_decisions WHERE approval_id = ?').get(acc.approval_id) as any).payload).decision, '승인');
  assert.equal(s.refCheck(acc.contract_ref), undefined);
  assert.ok(s.db.prepare('SELECT 1 FROM acceptances WHERE acceptance_id = ?').get(acc.acceptance_id));

  const m = foldAll(s.events(), s.refCheck);
  assert.equal(card(m, 'A').acceptance, '인수됨');
  // 후행 Task는 검수된 commit에서 시작한다
  const b = execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'B', base_ref: sha } });
  assert.ok(b.ok, !b.ok ? b.message : '');
  const bl = JSON.parse((s.db.prepare("SELECT payload FROM baselines WHERE baseline_id = 'B-r1-b'").get() as any).payload);
  assert.equal(bl.base_ref, acc.commit, '후행 Task의 기준 commit은 검수된 결과 commit');
  assert.ok(!recordAcceptance(s, 'A-r1-s1').ok, '이미 검수한 결과는 다시 검수하지 않는다');
  s.close();
});
