// Agent 결과 검사 시험(T21). C1: 필수 검사가 실행되지 않았거나 skip됐거나 검증 정의가 계약과 다르면 검수가 거부된다
// (Engine 인수 기준 3). C2: Agent가 "테스트 통과"라고 보고해도 검수 근거(EvidenceBundle) 없이는 검수되지 않는다(기준 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, me } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { runCheckNode } from './verify.ts';
import { foldAll, type Event } from '../tools/readmodel.ts';

const FAKE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
// A-C1: 검사 파일(checks/test.sh)로 hello.txt를 확인한다. A-C2: 검사 방법이 없는 자동 조건
const CHECK = { command: 'sh checks/test.sh', files: ['checks/test.sh'] };
const plan = (conds: any[]) => ({ project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [{ id: 'A', name: 'A', phase: 'P1', goal: '인사 파일을 만든다', outputs: { out: '코드' }, conditions: conds }] });
const C1 = { id: 'A-C1', method: 'auto', slot: 'out', text: '인사 파일이 있다', verify: CHECK };
const C2 = { id: 'A-C2', method: 'auto', slot: 'out', text: '검사 방법을 적지 않은 조건' };

async function submitted(conds: any[], edits: object = {}) {
  const base = mkdtempSync(join(tmpdir(), 'catena-verify-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'checks'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'checks', 'test.sh'), 'test -f hello.txt && grep -q 안녕 hello.txt && echo 인사 파일 확인\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: plan(conds) } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: sha } }).ok);
  const holder = me();
  assert.ok(beginRun(s, 'A-r1', holder, 30_000).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok'; // Agent는 "모든 테스트를 통과했습니다"라고 보고한다
  process.env.FAKE_CLAUDE_EDITS = JSON.stringify(edits);
  delete process.env.FAKE_CLAUDE_ARGS;
  try { await runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 }); }
  finally { delete process.env.FAKE_CLAUDE_EDITS; }
  return { repo, s, holder };
}
// 검수 기록 이벤트를 하나 덧붙여 접는다(검수 명령은 T22). 규칙을 어기면 E7로 거부된다
const accept = (evs: Event[], payload: any) => [...evs, { ...evs.at(-1)!, seq: evs.length + 1, event_id: `acc-${evs.length}`, type: 'acceptance.recorded', subject: 'A',
  issuer: 'Validation & Acceptance', payload: { acceptance_id: 'ACC-1', scope: 'slot', task_id: 'A', slot: 'out', submission_id: 'A-r1-s1', ...payload } }];

test('T21-C1: 새 checkout에서 Task 명세의 검사 방법으로 검사하고, 검사 방법이 없는 필수 조건은 미실행으로 남아 검수가 거부된다', async () => {
  const { repo, s, holder } = await submitted([C1, C2]);
  const checks = await runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder, submission_id: 'A-r1-s1' });
  assert.deepEqual(checks.map(c => [c.condition_id, c.result]), [['A-C1', '통과'], ['A-C2', '미실행']]);
  const m = foldAll(s.events(), s.refCheck);
  const e1 = m.evidence.get(checks[0].evidence_id);
  assert.deepEqual(e1.verifier_ref, m.contracts.get('A').conditions[0].verifier_ref, '검증 정의는 Task 명세에 고정된 것');
  assert.deepEqual([e1.collected_via, e1.verifier, e1.target_ref.commit.length], ['직접 실행', 'runner', 40]);
  assert.equal(s.refCheck(e1.raw_log_ref), undefined, '검사 로그 원문이 저장소에 있다');
  assert.ok(!existsSync(join(s.dir, 'checks', checks[0].evidence_id)), '검사용 checkout은 지운다');
  assert.ok(!git(repo, 'worktree', 'list').includes('checks'), 'git worktree 목록에도 남지 않는다');
  assert.equal(m.nodeLog.at(-1).node, 'check');
  assert.equal(m.nodeLog.at(-1).result, '실패', '필수 조건 하나가 미실행이면 검사 노드는 실패');

  const evs = s.events();
  const both = { condition_ids: ['A-C1', 'A-C2'] };
  assert.throws(() => foldAll(accept(evs, { ...both, evidence_ids: [checks[0].evidence_id] }), s.refCheck), /E7.*A-C2/, '미실행 조건은 검수 근거가 없다');
  assert.throws(() => foldAll(accept(evs, { ...both, evidence_ids: checks.map(c => c.evidence_id) }), s.refCheck), /E7/, '미실행 결과는 근거가 되지 않는다');
  // skip된 검사와, 계약과 다른 검증 정의로 실행한 통과 결과도 근거가 되지 않는다
  const fake = (id: string, extra: object) => ({ ...evs.at(-1)!, seq: evs.length + 1, event_id: id, type: 'evidence.recorded', subject: 'A-r1-s1', issuer: 'Validation & Acceptance',
    payload: { evidence_id: id, condition_id: 'A-C1', submission_id: 'A-r1-s1', raw_log_ref: e1.raw_log_ref, ...extra } });
  const skip = [...evs, fake('E-skip', { result: 'skip', verifier_ref: e1.verifier_ref })];
  assert.throws(() => foldAll(accept(skip, { condition_ids: ['A-C1'], evidence_ids: ['E-skip'] }), s.refCheck), /E7.*통과 결과가 아니다/, 'skip된 검사는 근거가 되지 않는다');
  const other = [...evs, fake('E-other', { result: '통과', verifier_ref: e1.raw_log_ref })];
  assert.throws(() => foldAll(accept(other, { condition_ids: ['A-C1'], evidence_ids: ['E-other'] }), s.refCheck), /E7.*검증 정의가 계약과 다르다/);
  s.close();
});

test('T21-C1: Agent가 검사 파일을 바꾸면 결과 기록 단계에서 거부되어 검사도 검수도 하지 않는다', async () => {
  const { s, holder } = await submitted([C1], { write: { 'checks/test.sh': 'exit 0\n' } });
  const m = foldAll(s.events(), s.refCheck);
  assert.deepEqual([m.submissions.get('A-r1-s1').scope_check, m.submissions.get('A-r1-s1').rejected_paths], ['거부', ['checks/test.sh']]);
  assert.equal(m.runs.get('A-r1').reason, '쓰기 범위');
  await assert.rejects(runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder, submission_id: 'A-r1-s1' }), /감독 임대|거부/);
  s.close();
});

test('T21-C2: Agent가 "테스트 통과"라고 보고해도 검수 근거 없이는, 또 검사가 실패하면 검수되지 않는다. 통과한 근거로만 검수된다', async () => {
  const { s, holder } = await submitted([C1]);
  assert.ok(s.events().some(e => e.type === 'agent.activity' && /테스트를 통과/.test(e.payload.summary) && e.payload.source === 'Agent 보고'));
  const evs = s.events();
  assert.throws(() => foldAll(accept(evs, { condition_ids: ['A-C1'], evidence_ids: [] }), s.refCheck), /E7.*A-C1의 증거 없음/, 'Agent 보고만으로는 검수되지 않는다');
  const [c] = await runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder, submission_id: 'A-r1-s1' });
  assert.equal(c.result, '통과');
  const m = foldAll(accept(s.events(), { condition_ids: ['A-C1'], evidence_ids: [c.evidence_id] }), s.refCheck);
  assert.ok(m.slotAccepted.has('A/out'), '같은 제출 기록, 같은 검증 정의로 통과한 근거로는 검수된다(auto 조건만이라 승인 없이, v0.10.2)');
  s.close();

  // 검사가 실패하는 결과: hello.txt가 없다
  const f = await submitted([{ ...C1, verify: { command: 'test -f 없는파일', files: [] } }]);
  const [x] = await runCheckNode(f.s, { run_id: 'A-r1', iteration: 1, holder: f.holder, submission_id: 'A-r1-s1' });
  assert.equal(x.result, '실패');
  assert.throws(() => foldAll(accept(f.s.events(), { condition_ids: ['A-C1'], evidence_ids: [x.evidence_id] }), f.s.refCheck), /E7/);
  f.s.close();
});
