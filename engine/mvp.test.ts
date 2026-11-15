// Engine MVP 검수 시험 묶음(T25-C1, 13장 Engine MVP 검수 기준): 슬롯으로 이어진 A(Claude Code) → B(Codex)를
// 가짜 CLI로 끝까지 돌리며 기준 1, 6, 7, 9, 12, 14를 한 공정에서 확인한다. 나머지 기준을 확인하는 시험은
// docs/engine-mvp-report.md의 대응표에 있다. 실제 CLI로 돌린 결과도 그 문서에 적는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { me } from './supervise.ts';
import { runWorkflow } from './workflow.ts';
import { card, foldAll } from '../tools/readmodel.ts';

const fake = (name: string) => [process.execPath, new URL(`./fixtures/${name}`, import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const plan = {
  project: { project_id: 'mvp', name: 'Engine MVP 시험' }, phases: [{ id: 'P1', name: '구현' }], milestones: [{ id: 'M1', name: '완성', items: ['B'] }],
  wbs: [
    { id: 'A', name: '인사 파일 구현', phase: 'P1', agent: 'claude-code', goal: '인사 파일을 만든다', outputs: { greet: '코드' },
      conditions: [{ id: 'A-C1', method: 'auto', slot: 'greet', text: '인사 파일이 있다', verify: { command: 'test -f hello.txt' } }] },
    { id: 'B', name: '인사 확인 구현', phase: 'P1', agent: 'codex', goal: '인사 파일을 확인한다', inputs: { greet: 'A.greet' }, outputs: { check: '코드' },
      conditions: [
        { id: 'B-C1', method: 'auto', slot: 'check', text: '인사 내용이 맞다', verify: { command: 'grep -q 안녕 hello.txt' } },
        { id: 'B-C2', method: 'human', slot: 'check', text: '사용자가 결과를 확인한다' }] },
  ],
};
const start = (s: any, task_id: string, base_ref?: string) => execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id, base_ref } });
async function until(f: () => boolean) { for (const t = Date.now() + 10_000; !f(); await new Promise(r => setTimeout(r, 20))) if (Date.now() > t) throw new Error('기다리던 상태가 오지 않았다'); }

test('Engine MVP: A(Claude Code) → B(Codex)가 슬롯 게이트, 검사, 승인을 거쳐 검수까지 완주한다(기준 1, 6, 7, 9, 12, 14)', async () => {
  const base = mkdtempSync(join(tmpdir(), 'catena-mvp-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CODEX_MODE = 'ok';
  const go = (run_id: string, cli: string) => runWorkflow(s, { run_id, holder: me(), command: fake(cli), tickMs: 50, pollMs: 50 });

  // 기준 1: A의 결과 항목이 검수되기 전에는 B의 Run과 Ticket이 생기지 않는다(base_ref를 넘겨도)
  const early = start(s, 'B', git(repo, 'rev-parse', 'HEAD'));
  assert.ok(!early.ok && /E6/.test(early.message), '선행 Task 검수 전 착수 거부');
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM tickets t JOIN runs r USING (run_id) WHERE r.task_id = 'B'").get() as any).n, 0);

  // A: human 조건이 없으니 승인 없이 통과한 근거로 검수된다(기준 14)
  assert.ok(start(s, 'A', git(repo, 'rev-parse', 'HEAD')).ok);
  const a = await go('A-r1', 'fake-claude.mjs');
  assert.equal(a.outcome, '검수');
  let m = foldAll(s.events(), s.refCheck);
  assert.ok(!m.workflows.get('A').nodes.has('approve'), 'human 조건이 없는 Task에는 승인 노드가 없다');
  const accA = m.acceptances.find((x: any) => x.task_id === 'A' && x.scope === 'task');
  assert.ok(accA && !accA.approval_id);

  // B: 입력을 공급한 A의 제출 commit에서 시작하고, Codex로 실행하며, 승인을 기다린다
  assert.ok(start(s, 'B').ok);
  const b = go('B-r1', 'fake-codex.mjs');
  await until(() => Boolean(s.db.prepare('SELECT 1 FROM approval_requests').get()));
  const { approval_id } = s.db.prepare('SELECT approval_id FROM approval_requests').get() as { approval_id: string };
  assert.ok(execute(s, { command: 'approval.decide', principal: human, channel: 'cli-tty', args: { approval_id, decision: '승인', comment: '' } }).ok);
  assert.equal((await b).outcome, '검수');
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CODEX_MODE;

  m = foldAll(s.events(), s.refCheck);
  const runtimes = s.events().filter(e => e.type === 'node.started' && e.payload.node_id === 'work').map(e => [e.payload.run_id, e.payload.profile.runtime]);
  assert.deepEqual(runtimes, [['A-r1', 'claude-code'], ['B-r1', 'codex']], '한 공정에서 Task마다 다른 Agent 프로그램');
  const workers = s.events().filter(e => e.type === 'agent.activity').map(e => `${e.payload.run_id}:${e.actor.kind}/${e.actor.instance}`);
  assert.deepEqual([...new Set(workers)], ['A-r1:agent/claude-code', 'B-r1:agent/codex'], '활동은 그 Agent 프로그램이 한 일로 기록된다(Agent 그래프에 보인다)');
  const baseB = JSON.parse((s.db.prepare("SELECT payload FROM baselines WHERE baseline_id = 'B-r1-b'").get() as any).payload);
  assert.equal(baseB.base_ref, accA.commit, 'B는 A의 검수된 제출 commit에서 시작한다');
  assert.equal(card(m, 'A').acceptance, '인수됨');
  assert.equal(card(m, 'B').acceptance, '인수됨');

  // 기준 6, 7: 검수 기록마다 Baseline, 근거, 승인, commit을 따라가고, 모두 같은 제출 기록을 가리킨다
  for (const acc of m.acceptances) {
    assert.ok(s.db.prepare('SELECT 1 FROM baselines WHERE baseline_id = ?').get(acc.baseline_id), `${acc.acceptance_id} Baseline`);
    for (const id of acc.evidence_ids) assert.equal(m.evidence.get(id).submission_id, acc.submission_id, `${acc.acceptance_id} 근거 ${id}`);
    if (acc.approval_id) assert.equal(m.approvals.get(acc.approval_id).submission_id, acc.submission_id, `${acc.acceptance_id} 승인`);
    assert.equal(acc.contract_ref.id, m.contracts.get(acc.task_id).contract_ref.id);
    assert.equal(git(repo, 'rev-parse', `refs/catena/submissions/${acc.submission_id}`), acc.commit, '제출 commit이 저장소에 고정돼 있다');
  }
  assert.ok(m.acceptances.find((x: any) => x.task_id === 'B' && x.slot === 'check').approval_id, 'human 조건이 있는 Task는 승인으로 검수된다');
  // 검수 뒤 작업공간을 바꿔도 검수 대상(제출 commit)은 그대로다
  const wtA = JSON.parse((s.db.prepare("SELECT payload FROM runs WHERE run_id = 'A-r1'").get() as any).payload).worktree;
  writeFileSync(join(wtA, 'hello.txt'), '바뀜\n');
  assert.equal(git(repo, 'show', `${accA.commit}:hello.txt`), '안녕');

  // 기준 12: 상태 테이블과 이벤트를 접은 값이 같다. 기준 9: 발행한 이벤트 전체가 검사 규칙을 통과한다(위 foldAll)
  for (const r of s.db.prepare('SELECT run_id, state FROM runs').all() as any[]) assert.equal(m.runs.get(r.run_id).state, r.state, r.run_id);
  assert.deepEqual((s.db.prepare('SELECT acceptance_id FROM acceptances ORDER BY acceptance_id').all() as any[]).map(r => r.acceptance_id),
    m.acceptances.map((x: any) => x.acceptance_id).sort());
  assert.deepEqual([...m.runs.values()].map((r: any) => r.state), ['종료', '종료']);
  s.close();
});
