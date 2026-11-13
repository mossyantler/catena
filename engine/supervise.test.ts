// 감독 임대와 감독 상실 복구 시험(T17): 감독 프로세스를 강제 종료하면 임대 만료 뒤 남은 프로세스가 정리되고
// 같은 Task를 새 Run으로 다시 시도할 수 있다(C1, Engine 인수 기준 8). 프로세스 ID가 재사용돼도 다른 프로세스를
// 죽이지 않고, 두 프로세스가 동시에 정리하지 않는다(C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, realProcs, recordProcess, recoverExpired, renewLease, type Holder } from './supervise.ts';
import { card, foldAll } from '../tools/readmodel.ts';

const human = { kind: 'human' as const, id: 'user' };
const PLAN = { project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [{ id: 'A', name: 'A', phase: 'P1', goal: 'A', outputs: { out: '코드' }, conditions: [{ id: 'A-C1', method: 'auto', slot: 'out', text: '시험' }] }] };
const here = (f: string) => JSON.stringify(new URL(f, import.meta.url).pathname);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const row = (s: Store, sql: string, ...v: string[]) => s.db.prepare(sql).get(...v) as any;
const fake: Holder = { pid: 1, started_at: '사라진 감독', host: 'test' };

function started(budget?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'catena-sup-'));
  const s = openStore(dir);
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: PLAN } }).ok);
  const r = execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: 'base0', budget_usd: budget } });
  assert.ok(r.ok, !r.ok ? r.message : '');
  return { dir, s };
}
const agent = () => { const p = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' }); p.unref(); return p.pid!; };

test('C1: 감독 프로세스를 강제 종료하면 임대 만료 뒤 남은 프로세스가 정리되고 같은 Task를 새 Run으로 다시 시도할 수 있다(Engine 인수 기준 8)', async () => {
  const { dir, s } = started(2);
  // 감독 프로세스: Run을 실행 중으로 바꾸고 임대를 얻은 뒤, Agent 대신 sleep을 새 프로세스 그룹으로 띄워 기록하고 임대를 연장한다
  const supervisor: ChildProcess = spawn(process.execPath, ['--input-type=module', '-e', `
    import { openStore } from ${here('./store.ts')};
    import { beginRun, me, realProcs, recordProcess, renewLease } from ${here('./supervise.ts')};
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    const s = openStore(${JSON.stringify(dir)});
    const self = me();
    const r = beginRun(s, 'A-r1', self, 1000);
    if (!r.ok) { console.error(r.message); process.exit(2); }
    const a = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' }); a.unref();
    recordProcess(s, 'A-r1', self, { pgid: a.pid, started_at: realProcs.startTime(a.pid) });
    writeFileSync(${JSON.stringify(dir)} + '/agent.pid', String(a.pid));
    setInterval(() => renewLease(s, 'A-r1', self, 1000), 200);`], { stdio: ['ignore', 'ignore', 'inherit'] });
  const pidFile = join(dir, 'agent.pid');
  for (const until = Date.now() + 20_000; !existsSync(pidFile); await sleep(10)) if (Date.now() > until) throw new Error('감독 프로세스가 Agent를 띄우지 못했다');
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.equal(row(s, "SELECT state FROM runs WHERE run_id = 'A-r1'").state, '실행 중');
  assert.deepEqual(recoverExpired(s), [], '감독이 살아 있는 동안에는 정리하지 않는다');

  supervisor.kill('SIGKILL');
  await new Promise(r => supervisor.on('close', r));
  assert.ok(alive(pid), '감독이 강제 종료돼도 Agent 프로세스는 남아 있다');
  await sleep(1300); // 임대(1초)가 만료되기를 기다린다
  assert.deepEqual(recoverExpired(s), [{ run_id: 'A-r1', process: '종료함' }]);
  assert.ok(!alive(pid), '남은 프로세스 그룹을 끝냈다');

  assert.equal(row(s, "SELECT state FROM runs WHERE run_id = 'A-r1'").state, '실패');
  assert.equal(row(s, "SELECT status FROM tickets WHERE run_id = 'A-r1'").status, '취소');
  assert.equal(row(s, "SELECT COUNT(*) AS n FROM run_leases").n, 0);
  const evs = s.events();
  assert.deepEqual(evs.filter(e => e.type === 'run.state_changed').map(e => [e.payload.to, e.payload.reason ?? null]), [['실행 중', null], ['실패', '감독 상실']]);
  assert.deepEqual(evs.filter(e => e.type === 'usage.recorded').map(e => [e.payload.cost_usd, e.payload.reliability]), [[2, '알 수 없음']], '예약은 전액 사용, 신뢰도 알 수 없음으로 정산(6-9 ④)');
  assert.equal(card(foldAll(evs, s.refCheck), 'A').exec, '실패');

  const retry = execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: 'base0' } });
  assert.ok(retry.ok, !retry.ok ? retry.message : '');
  assert.deepEqual({ ...row(s, "SELECT run_id, attempt, state FROM runs WHERE run_id = 'A-r2'") }, { run_id: 'A-r2', attempt: 2, state: '대기' });
  s.close();
});

test('C2: 프로세스 ID가 재사용된 다른 프로세스는 죽이지 않는다', async () => {
  const { s } = started();
  assert.ok(beginRun(s, 'A-r1', fake, 50).ok);
  const pid = agent();
  assert.ok(recordProcess(s, 'A-r1', fake, { pgid: pid, started_at: '기록된 시작 시각과 다름' }));
  await sleep(100);
  try {
    assert.deepEqual(recoverExpired(s), [{ run_id: 'A-r1', process: '다른 프로세스(시작 시각 다름)' }]);
    assert.ok(alive(pid), '같은 ID의 다른 프로세스를 죽이지 않았다');
    assert.equal(row(s, "SELECT state FROM runs WHERE run_id = 'A-r1'").state, '실패', 'Run은 감독 상실로 정리한다');
  } finally {
    realProcs.killGroup(pid);
  }
  s.close();
});

test('C2: 여러 프로세스가 동시에 정리를 시도해도 한 프로세스만 정리하고, 넘겨받힌 임대는 연장되지 않는다', async () => {
  const { dir, s } = started();
  assert.ok(beginRun(s, 'A-r1', fake, 50).ok);
  await sleep(100);
  const outs = ['', '', '', ''];
  const runs = [0, 1, 2, 3].map(w => new Promise<number | null>(done => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', `
      import { openStore } from ${here('./store.ts')};
      import { recoverExpired } from ${here('./supervise.ts')};
      import { existsSync, writeFileSync } from 'node:fs';
      const s = openStore(${JSON.stringify(dir)});
      writeFileSync(${JSON.stringify(dir)} + '/ready-${w}', '');
      const pause = new Int32Array(new SharedArrayBuffer(4));
      for (const until = Date.now() + 30_000; !existsSync(${JSON.stringify(dir)} + '/go'); Atomics.wait(pause, 0, 0, 1)) if (Date.now() > until) process.exit(3);
      process.stdout.write(JSON.stringify(recoverExpired(s)));
      s.close();`], { stdio: ['ignore', 'pipe', 'inherit'] });
    p.stdout.on('data', c => (outs[w] += c));
    p.on('close', done);
  }));
  for (const until = Date.now() + 20_000; readdirSync(dir).filter(f => f.startsWith('ready-')).length < 4; await sleep(5)) if (Date.now() > until) throw new Error('자식 프로세스가 준비 신호를 보내지 않았다');
  writeFileSync(join(dir, 'go'), '');
  assert.deepEqual(await Promise.all(runs), [0, 0, 0, 0]);
  assert.equal(outs.flatMap(o => JSON.parse(o)).length, 1, '정리한 프로세스는 하나');
  const lost = s.events().filter(e => e.type === 'run.state_changed' && e.payload.to === '실패');
  assert.equal(lost.length, 1);
  assert.equal(row(s, "SELECT COUNT(*) AS n FROM commands WHERE command = 'run.lost'").n, 1);
  assert.equal(renewLease(s, 'A-r1', fake, 1000), false, '사라진 감독은 임대를 다시 잡지 못한다');
  s.close();
});
