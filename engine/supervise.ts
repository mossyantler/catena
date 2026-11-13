// 감독 임대(6-10)와 감독 상실 복구(6-9).
// 실행 중인 Run마다 감독 프로세스 하나가 임대를 갖는다. 임대는 Run을 실행 중으로 바꾸는 명령(run.begin)에서 얻고,
// 감독하는 동안 renewLease로 연장한다. 감독 프로세스가 사라져 임대가 만료되면, 다음에 저장소를 연 Catena 프로세스가
// recoverExpired로 임대를 넘겨받아 6-9 순서로 정리한다: Ticket 취소 → 남은 프로세스 그룹 종료(시작 시각으로 같은
// 프로세스인지 확인) → worktree 격리 → 예약 정산 → Run을 실패(감독 상실)로. 넘겨받기는 트랜잭션 안의 조건부 갱신이라
// 여러 프로세스가 동시에 정리하지 않는다. Run 상태를 바꾸는 일은 명령 계층을 거쳐 이벤트와 명령 기록을 남긴다(0-9).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { foldAll } from '../tools/readmodel.ts';
import { execute, HANDLERS, Refusal } from './commands.ts';
import type { Store } from './store.ts';

export type Holder = { pid: number; started_at: string; host: string };
export type Proc = { pgid: number; started_at: string };
/** 운영체제의 프로세스를 보는 창구. 시험에서는 바꿔 끼운다. */
export type Procs = { startTime: (pid: number) => string | undefined; groupAlive: (pgid: number) => boolean; killGroup: (pgid: number) => boolean };

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const realProcs: Procs = {
  // 프로세스 ID는 재사용되므로 시작 시각을 함께 본다(6-9 ②)
  startTime: pid => { try { return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || undefined; } catch { return undefined; } },
  groupAlive: pgid => { try { process.kill(-pgid, 0); return true; } catch { return false; } },
  // SIGTERM 뒤 1초 안에 끝나지 않으면 SIGKILL. 끝났는지 확인한 결과를 돌려준다
  killGroup: pgid => {
    const send = (sig: NodeJS.Signals) => { try { process.kill(-pgid, sig); } catch { /* 이미 끝났다 */ } };
    send('SIGTERM');
    for (let i = 0; i < 20 && realProcs.groupAlive(pgid); i++) pause(50);
    if (realProcs.groupAlive(pgid)) send('SIGKILL');
    for (let i = 0; i < 20 && realProcs.groupAlive(pgid); i++) pause(50);
    return !realProcs.groupAlive(pgid);
  },
};
export const me = (): Holder => ({ pid: process.pid, started_at: realProcs.startTime(process.pid) ?? '', host: hostname() });

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };
const same = (a: Holder, b: Holder) => a.pid === b.pid && a.started_at === b.started_at && a.host === b.host;
const leaseOf = (s: Store, run_id: string) => {
  const row = s.db.prepare('SELECT holder, expires_at FROM run_leases WHERE run_id = ?').get(run_id) as { holder: string; expires_at: string } | undefined;
  return row && { holder: JSON.parse(row.holder) as Holder, expires_at: row.expires_at };
};
const runRow = (s: Store, run_id: string) => s.db.prepare('SELECT state, payload FROM runs WHERE run_id = ?').get(run_id) as { state: string; payload: string } | undefined;
const until = (ttlMs: number) => new Date(Date.now() + ttlMs).toISOString();
const expired = (iso: string) => Date.parse(iso) <= Date.now();

// Run을 실행 중으로 바꾸고 감독 임대를 얻는다(같은 트랜잭션, 6-10).
HANDLERS['run.begin'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder, ttl_ms } = cmd.args;
    const run = runRow(s, run_id);
    if (!run) throw new Refusal('대상 없음', `Run ${run_id}을(를) 찾을 수 없다`);
    if (run.state !== '대기') throw new Refusal('규칙 위반', `대기가 아닌 Run ${run_id}(${run.state})`);
    const ticket = s.db.prepare('SELECT status FROM tickets WHERE run_id = ?').get(run_id) as { status: string } | undefined;
    if (ticket?.status !== '유효') throw new Refusal('규칙 위반', `유효한 Ticket이 없다 ${run_id}`);
    if (leaseOf(s, run_id)) throw new Refusal('규칙 위반', `이미 감독 중인 Run ${run_id}`);
    s.db.prepare('INSERT INTO run_leases VALUES (?, ?, ?)').run(run_id, JSON.stringify(holder), until(ttl_ms));
    s.db.prepare("UPDATE runs SET state = '실행 중' WHERE run_id = ?").run(run_id);
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '실행 중' } });
  },
};

// 감독을 잃은 Run을 정리한다(6-9 ①③④⑤). 넘겨받은 임대를 가진 프로세스만 한다. 프로세스 종료(②)는 이 명령 전에 끝낸다.
HANDLERS['run.lost'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder, cleanup } = cmd.args;
    const lease = leaseOf(s, run_id);
    if (!lease || !same(lease.holder, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`);
    const run = runRow(s, run_id)!;
    const t = s.db.prepare('SELECT ticket_id, payload FROM tickets WHERE run_id = ?').get(run_id) as { ticket_id: string; payload: string };
    const ticket = JSON.parse(t.payload);
    const budget = ticket.reservation?.budget_usd;
    ticket.status = '취소';
    ticket.settlement = { charged_usd: typeof budget === 'number' ? budget : null, reliability: '알 수 없음', reason: '감독 상실' };
    s.db.prepare("UPDATE tickets SET status = '취소', payload = ? WHERE ticket_id = ?").run(JSON.stringify(ticket), t.ticket_id);
    const m = foldAll(s.events(), s.refCheck);
    for (const [node_id, iteration] of m.runs.get(run_id)?.active ?? []) emit({ type: 'node.finished', subject: run_id, issuer: 'Execution', payload: { run_id, node_id, iteration, result: '중단' } });
    if (typeof budget === 'number') emit({ type: 'usage.recorded', subject: run_id, issuer: 'Resource', payload: { run_id, cost_usd: budget, reliability: '알 수 없음' } });
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '실패', reason: '감독 상실' } });
    const payload = { ...JSON.parse(run.payload), lost: cleanup, worktree_quarantined: Boolean(JSON.parse(run.payload).worktree) };
    s.db.prepare("UPDATE runs SET state = '실패', payload = ? WHERE run_id = ?").run(JSON.stringify(payload), run_id);
    s.db.prepare('DELETE FROM run_leases WHERE run_id = ?').run(run_id);
  },
};

/** 대기 중인 Run을 실행 중으로 바꾸고 감독 임대를 얻는다. */
export const beginRun = (s: Store, run_id: string, holder: Holder, ttlMs: number) =>
  execute(s, { command: 'run.begin', principal: SYSTEM, channel: 'runner', args: { run_id, holder, ttl_ms: ttlMs } });

/** 임대를 가진 프로세스가 띄운 프로세스 그룹과 그 시작 시각을 Run에 기록한다(6-10, A-2). */
export function recordProcess(s: Store, run_id: string, holder: Holder, proc: Proc): boolean {
  return s.tx(() => {
    const lease = leaseOf(s, run_id);
    if (!lease || !same(lease.holder, holder)) return false;
    const run = runRow(s, run_id)!;
    s.db.prepare('UPDATE runs SET payload = ? WHERE run_id = ?').run(JSON.stringify({ ...JSON.parse(run.payload), process: proc }), run_id);
    return true;
  });
}

/** 임대를 연장한다. 이미 넘겨받혔거나 만료됐으면 false: 감독을 멈춰야 한다. */
export function renewLease(s: Store, run_id: string, holder: Holder, ttlMs: number): boolean {
  return s.tx(() => {
    const lease = leaseOf(s, run_id);
    if (!lease || !same(lease.holder, holder) || expired(lease.expires_at)) return false;
    s.db.prepare('UPDATE run_leases SET expires_at = ? WHERE run_id = ?').run(until(ttlMs), run_id);
    return true;
  });
}

export type Recovery = { run_id: string; process: '종료함' | '이미 없음' | '기록 없음' | '다른 프로세스(시작 시각 다름)' | '종료 실패' };

/** 만료된 임대를 넘겨받아 6-9 순서로 정리한다. 저장소를 여는 Catena 프로세스가 부른다. */
export function recoverExpired(s: Store, self: Holder = me(), procs: Procs = realProcs, ttlMs = 30_000): Recovery[] {
  const out: Recovery[] = [];
  const rows = s.db.prepare('SELECT run_id FROM run_leases').all() as { run_id: string }[];
  for (const { run_id } of rows) {
    // 넘겨받기: 트랜잭션 안에서 아직 만료 상태일 때만 holder를 바꾼다. 동시에 부른 다른 프로세스는 이미 바뀐 임대를 본다
    const claimed = s.tx(() => {
      const lease = leaseOf(s, run_id);
      if (!lease || !expired(lease.expires_at)) return undefined;
      s.db.prepare('UPDATE run_leases SET holder = ?, expires_at = ? WHERE run_id = ?').run(JSON.stringify(self), until(ttlMs), run_id);
      return JSON.parse(runRow(s, run_id)!.payload) as { process?: Proc; worktree?: string };
    });
    if (!claimed) continue;
    const proc = claimed.process;
    let state: Recovery['process'];
    if (!proc) state = '기록 없음';
    else if (!procs.groupAlive(proc.pgid)) state = '이미 없음';
    else {
      // 그룹 리더가 살아 있는데 시작 시각이 다르면 ID가 재사용된 다른 프로세스다: 죽이지 않는다.
      // 리더만 끝나고 그룹이 남았다면 그룹이 있는 동안 그 ID는 재사용되지 않으므로 우리 그룹이다.
      const st = procs.startTime(proc.pgid);
      state = st !== undefined && st !== proc.started_at ? '다른 프로세스(시작 시각 다름)' : procs.killGroup(proc.pgid) ? '종료함' : '종료 실패';
    }
    const r = execute(s, { command: 'run.lost', principal: SYSTEM, channel: 'runner', args: { run_id, holder: self, cleanup: { process: state, worktree_exists: Boolean(claimed.worktree && existsSync(claimed.worktree)) } } });
    if (!r.ok) throw new Error(`감독 상실 정리 실패 ${run_id}: ${r.message}`);
    out.push({ run_id, process: state });
  }
  return out;
}
