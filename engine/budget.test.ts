// 예산과 사용 한도 시험(T24-C1, Engine 인수 기준 5): 예산 상한에 닿으면 새 호출(새 단계)과 신규 착수가 거부되고,
// Run은 다음 단계 경계에서 멈춘다. 사용량은 신뢰도·과금 방식과 함께 기록한다(5-7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { budgetLeft, execute, spentUsd } from './commands.ts';
import { beginRun, me } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { runCheckNode } from './verify.ts';
import { foldAll, waitsOf } from '../tools/readmodel.ts';

const FAKE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const task = (id: string) => ({ id, name: id, phase: 'P1', goal: `${id}를 만든다`, outputs: { out: '코드' }, conditions: [{ id: `${id}-C1`, method: 'auto', slot: 'out', text: '시험' }] });
const PLAN = { project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [], wbs: [task('A'), task('B')] };

function project(budget_usd?: number) {
  const base = mkdtempSync(join(tmpdir(), 'catena-budget-'));
  const repo = join(base, 'repo');
  execFileSync('mkdir', [repo]);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험 저장소\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: PLAN } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo, budget_usd } }).ok);
  return { s, sha: git(repo, 'rev-parse', 'HEAD'), base };
}
const start = (s: any, task_id: string, sha: string, budget_usd?: number) => execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id, base_ref: sha, budget_usd } });
async function step(s: any, env: Record<string, string>, argsFile?: string) {
  const holder = me();
  assert.ok(beginRun(s, 'A-r1', holder, 30_000).ok);
  Object.assign(process.env, { FAKE_CLAUDE_MODE: 'ok', ...env });
  if (argsFile) process.env.FAKE_CLAUDE_ARGS = argsFile; else delete process.env.FAKE_CLAUDE_ARGS;
  try { return { holder, r: await runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder, command: FAKE, tickMs: 50 }) }; }
  finally { for (const k of Object.keys(env)) delete process.env[k]; }
}

test('T24-C1: 예산 상한을 넘는 예약은 신규 착수가 거부되고, 상한이 있으면 Run마다 예약액이 필요하다', () => {
  const { s, sha } = project(1);
  assert.ok(start(s, 'A', sha, 0.6).ok);
  assert.equal(budgetLeft(s), 0.4, '정산되지 않은 예약은 남은 예산에서 뺀다');
  const over = start(s, 'B', sha, 0.6);
  assert.ok(!over.ok && over.reason === '규칙 위반' && /예산 상한/.test(over.message), '남은 예산보다 큰 예약은 시작할 수 없다');
  assert.equal((s.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE task_id = 'B'").get() as any).n, 0, '거부된 착수는 아무것도 남기지 않는다');
  const none = start(s, 'B', sha);
  assert.ok(!none.ok && /예약액/.test(none.message));
  assert.ok(start(s, 'B', sha, 0.4).ok);
  s.close();
});

test('T24-C1: Run이 예약액을 다 쓰면 다음 단계 경계에서 멈추고 새 단계를 시작하지 않는다. Runner에는 예약보다 낮은 한도를 준다', async () => {
  const { s, sha, base } = project(5);
  assert.ok(start(s, 'A', sha, 0.1).ok);
  const argsFile = join(base, 'args.json');
  // API 키 인증: Runner가 보고한 비용 $0.12(추정값)가 예약 $0.10을 넘는다
  const { holder, r } = await step(s, { FAKE_CLAUDE_KEYSOURCE: 'ANTHROPIC_API_KEY' }, argsFile);
  assert.ok(JSON.parse(readFileSync(argsFile, 'utf8')).argv.join(' ').includes('--max-budget-usd 0.09'), '진행 중인 호출은 Runner 한도(예약의 90%)로 묶는다');
  assert.equal(r.result, '성공', '진행 중이던 단계는 끊지 않고 끝까지 확인한다');
  assert.equal(r.paused, '예약 소진');
  const m = foldAll(s.events(), s.refCheck);
  assert.deepEqual([m.runs.get('A-r1').state, m.runs.get('A-r1').reason], ['일시 중단', '예약 소진']);
  const w = waitsOf(m, 'A').find((x: any) => x.type === 'resource');
  assert.ok(w && w.action.actor === '사용자', '사용자가 할 일이 있는 자원 대기 사유');
  const u = m.usage.find((x: any) => x.run === 'A-r1');
  assert.deepEqual([u.cost, u.reliability, u.billing], [0.12, '추정값', 'API']);
  assert.equal(spentUsd(s, 'A-r1'), 0.12);
  assert.equal((s.db.prepare('SELECT COUNT(*) AS n FROM run_leases').get() as any).n, 0);
  await assert.rejects(runAgentNode(s, { run_id: 'A-r1', node_id: 'work', iteration: 2, holder, command: FAKE }), /실행 중인 Run이 아니다/, '새 단계(새 호출)는 시작하지 않는다');
  await assert.rejects(runCheckNode(s, { run_id: 'A-r1', iteration: 1, holder, submission_id: 'A-r1-s1' }), /감독 임대|멈췄다/);

  // 멈춘 Run은 사용자가 취소하고 새 Run으로 다시 시작한다
  const c = execute(s, { command: 'run.cancel', principal: human, channel: 'cli-tty', args: { run_id: 'A-r1' } });
  assert.ok(c.ok);
  assert.ok(!waitsOf(foldAll(s.events(), s.refCheck), 'A').some((x: any) => x.type === 'resource'), '취소하면 자원 대기 사유도 닫힌다');
  assert.ok(start(s, 'A', sha, 0.5).ok);
  s.close();
});

test('T24-C1: 구독 사용 한도 신호를 받으면 단계 경계에서 멈추고, 구독 사용량은 예산(금액)에 넣지 않는다', async () => {
  const { s, sha } = project(1);
  assert.ok(start(s, 'A', sha, 0.5).ok);
  const { r } = await step(s, { FAKE_CLAUDE_KEYSOURCE: 'none', FAKE_CLAUDE_RATE: 'rejected' });
  assert.equal(r.paused, '사용 한도 소진');
  const m = foldAll(s.events(), s.refCheck);
  assert.equal(m.usage.find((x: any) => x.run === 'A-r1').billing, '구독');
  assert.equal(spentUsd(s), 0, '구독 사용량은 청구액이 아니다(5-7)');
  assert.equal(waitsOf(m, 'A').find((x: any) => x.type === 'resource')?.resolve, '사용 한도가 회복됨');
  s.close();
});
