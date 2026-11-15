// 백그라운드 Orchestrator(T32, C-12 serve, 6-10): 전경 `catena run`과 같은 워크플로우 감독(runWorkflow)을 배경에서 돈다.
// 다른 인터페이스(CLI `run --detach`, 화면)가 착수를 요청해 `대기`로 남긴 Run을 만든 순서대로 하나씩 감독한다(Engine MVP 제약: 병렬 실행 없음).
// 감독 소유권은 감독 임대로만 정한다. serve가 강제 종료되면 임대가 만료된 뒤 다음 Catena 프로세스(다른 serve, CLI)가
// 남은 Agent 프로세스를 정리하고 Run을 실패(감독 상실)로 닫는다(6-9, Engine 인수 기준 8).
import { me, recoverExpired } from './supervise.ts';
import { runWorkflow } from './workflow.ts';
import type { Store } from './store.ts';

export type ServeOptions = { log: (msg: string) => void; command?: string[]; ttlMs?: number; pollMs?: number; stop?: () => boolean };

/** stop()이 참이 될 때까지 대기 중인 Run을 감독한다. 시작하지 못한 Run은 한 번만 알리고 건너뛴다. */
export async function serve(s: Store, o: ServeOptions) {
  const ttl = o.ttlMs ?? 30_000;
  const skipped = new Set<string>();
  o.log(`serve 시작(pid ${process.pid}). 대기 중인 Run을 감독한다`);
  while (!o.stop?.()) {
    for (const r of recoverExpired(s)) o.log(`${r.run_id}: 감독을 잃은 Run을 정리했다(${r.process})`);
    const next = (s.db.prepare("SELECT run_id FROM runs WHERE state = '대기' ORDER BY rowid").all() as { run_id: string }[]).find(r => !skipped.has(r.run_id));
    if (!next) { await new Promise(r => setTimeout(r, o.pollMs ?? 1000)); continue; }
    o.log(`${next.run_id}: 감독 시작`);
    try {
      const r = await runWorkflow(s, { run_id: next.run_id, holder: me(), command: o.command, ttlMs: ttl, tickMs: Math.min(1000, ttl / 3), pollMs: o.pollMs, log: m => o.log(`${next.run_id}: ${m}`) });
      o.log(`${next.run_id}: ${r.outcome}${r.reason ? ` (${r.reason})` : ''} · 회차 ${r.iterations}`);
    } catch (err) {
      skipped.add(next.run_id);
      o.log(`${next.run_id}: 감독하지 못했다 — ${(err as Error).message}`);
    }
  }
}
