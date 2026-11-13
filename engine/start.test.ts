// 착수 판정과 예약 시험(T16): 입력 슬롯이 인수되기 전에는 Run이 생기지 않는다(C1, Engine 인수 기준 1),
// 두 프로세스가 같은 Task의 착수를 동시에 요청해도 Run과 예약은 하나만 생긴다(C2, Engine 인수 기준 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './store.ts';
import { execute, type Command } from './commands.ts';
import { card, foldAll } from '../tools/readmodel.ts';

const human = { kind: 'human' as const, id: 'user' };
const task = (id: string, inputs?: Record<string, string>) => ({
  id, name: id, phase: 'P1', goal: id, inputs, outputs: { out: '코드' },
  conditions: [{ id: `${id}-C1`, method: 'auto', slot: 'out', text: '시험' }],
});
const PLAN = { project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], wbs: [task('A'), task('B', { in: 'A.out' })], milestones: [] };
const start = (task_id: string, args: object = {}, over: Partial<Command> = {}): Command =>
  ({ command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id, base_ref: 'base0', ...args }, ...over });
const n = (s: Store, t: string) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
const snap = (s: Store) => ({ events: n(s, 'events'), runs: n(s, 'runs'), tickets: n(s, 'tickets'), baselines: n(s, 'baselines'), commands: n(s, 'commands') });

function planned() {
  const dir = mkdtempSync(join(tmpdir(), 'catena-start-'));
  const s = openStore(dir);
  const r = execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: PLAN } });
  assert.ok(r.ok, !r.ok ? r.message : '');
  return { dir, s };
}

test('C1: 입력 슬롯이 인수되기 전에는 Run이 생기지 않는다(Engine 인수 기준 1)', () => {
  const { s } = planned();
  const before = snap(s);
  const blocked = execute(s, start('B'));
  assert.ok(!blocked.ok && blocked.reason === '규칙 위반' && /E6/.test(blocked.message), !blocked.ok ? blocked.message : '');
  assert.deepEqual(snap(s), before, 'Run, Ticket, Baseline, 이벤트(Workflow 묶기 포함)가 하나도 남지 않는다');

  const noBase = execute(s, start('A', { base_ref: undefined }));
  assert.ok(!noBase.ok && /base_ref/.test(noBase.message), '입력이 없는 Task는 기준 commit이 필요하다');
  assert.ok(!execute(s, start('A', {}, { principal: { kind: 'agent', id: 'claude' } })).ok, 'Agent는 착수를 요청하지 못한다');
  const missing = execute(s, start('Z'));
  assert.ok(!missing.ok && missing.reason === '대상 없음');
  assert.deepEqual(snap(s), before);

  const ok = execute(s, start('A', { model: 'claude-sonnet-5-5', budget_usd: 2 }));
  assert.ok(ok.ok, !ok.ok ? ok.message : '');
  assert.deepEqual(ok.events.map(e => e.type), ['workflow.bound', 'run.created']);
  const run = s.db.prepare("SELECT * FROM runs WHERE task_id = 'A'").get() as any;
  assert.deepEqual({ run_id: run.run_id, attempt: run.attempt, state: run.state }, { run_id: 'A-r1', attempt: 1, state: '대기' });
  const ticket = JSON.parse((s.db.prepare("SELECT payload FROM tickets WHERE run_id = 'A-r1'").get() as any).payload);
  assert.equal(ticket.status, '유효');
  assert.deepEqual(ticket.reservation, { budget_usd: 2, slots: 1, write_lock: null });
  assert.equal(ticket.profile.model, 'claude-sonnet-5-5');
  const baseline = JSON.parse((s.db.prepare('SELECT payload FROM baselines WHERE baseline_id = ?').get(ticket.baseline_id) as any).payload);
  assert.equal(baseline.base_ref, 'base0');
  assert.match(baseline.contract_ref.id, /^sha256:/);
  assert.match(baseline.workflow_ref.id, /^sha256:/);
  const m = foldAll(s.events(), s.refCheck);
  assert.equal(card(m, 'A').exec, '대기');

  const again = execute(s, start('A'));
  assert.ok(!again.ok && /끝나지 않은 Run/.test(again.message), 'Task마다 끝나지 않은 Run은 하나뿐이다');
  const stillBlocked = execute(s, start('B'));
  assert.ok(!stillBlocked.ok && /E6/.test(stillBlocked.message), 'A의 Run이 생겨도 슬롯이 인수되기 전에는 B를 착수하지 못한다');
  s.close();
});

test('C2: 여러 프로세스가 같은 Task의 착수를 동시에 요청해도 Run과 예약은 하나만 생긴다(Engine 인수 기준 10)', async () => {
  const { dir, s } = planned();
  s.close();
  const here = (f: string) => JSON.stringify(new URL(f, import.meta.url).pathname);
  const requester = (w: number) => `import { openStore } from ${here('./store.ts')};
    import { execute } from ${here('./commands.ts')};
    import { existsSync, writeFileSync } from 'node:fs';
    const s = openStore(${JSON.stringify(dir)});
    writeFileSync(${JSON.stringify(dir)} + '/ready-${w}', '');
    const pause = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(${JSON.stringify(dir)} + '/go')) Atomics.wait(pause, 0, 0, 1);
    const r = execute(s, { command: 'run.start', principal: { kind: 'human', id: 'user' }, channel: 'cli-batch', args: { task_id: 'A', base_ref: 'base0' } });
    s.close();
    process.stdout.write(JSON.stringify({ ok: r.ok, message: r.ok ? '' : r.message }));`;
  const outs: string[] = ['', '', '', ''];
  const runs = [0, 1, 2, 3].map(w => new Promise<number | null>(done => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', requester(w)], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', c => (outs[w] += c));
    p.on('close', done);
  }));
  while (readdirSync(dir).filter(f => f.startsWith('ready-')).length < 4) await new Promise(r => setTimeout(r, 5));
  writeFileSync(join(dir, 'go'), '');
  assert.deepEqual(await Promise.all(runs), [0, 0, 0, 0]);
  const results = outs.map(o => JSON.parse(o));
  assert.equal(results.filter(r => r.ok).length, 1, '하나만 성공한다');
  for (const r of results.filter(r => !r.ok)) assert.match(r.message, /끝나지 않은 Run/);

  const t = openStore(dir);
  assert.deepEqual({ runs: n(t, 'runs'), tickets: n(t, 'tickets'), baselines: n(t, 'baselines') }, { runs: 1, tickets: 1, baselines: 1 });
  assert.equal(t.events().filter(e => e.type === 'run.created').length, 1);
  // 명령 밖에서 직접 써도 저장소의 유일 제약이 끝나지 않은 두 번째 Run을 막는다(6-1)
  assert.throws(() => t.tx(() => t.db.exec("INSERT INTO runs VALUES ('A-r9', 'A', 9, '실행 중', '{}')")), /UNIQUE/);
  t.close();
});
