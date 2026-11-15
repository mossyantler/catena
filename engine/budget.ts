// 예산과 사용 한도(T24, 5-1, 5-6, 5-7, A-3): 예약액이나 프로젝트 예산이 바닥나거나 Runner가 사용 한도 신호를 보내면,
// 새 단계를 시작하지 않고 Run을 다음 단계 경계에서 멈춘다(일시 중단). 진행 중인 호출은 끊지 않는다(5-6).
// 멈춘 Run은 자원이 회복돼도 이어서 실행하지 않는다(재개는 확장). 사용자가 취소하고 새 Run으로 다시 시작한다.
import { budgetLeft, execute, HANDLERS, Refusal, spentUsd } from './commands.ts';
import { holds, type Holder } from './supervise.ts';
import type { Store } from './store.ts';

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };

HANDLERS['run.pause'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder, reason, action } = cmd.args;
    if (!holds(s, run_id, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`);
    const r = s.db.prepare('SELECT task_id, state, payload FROM runs WHERE run_id = ?').get(run_id) as { task_id: string; state: string; payload: string };
    if (r.state !== '실행 중') throw new Refusal('규칙 위반', `실행 중이 아닌 Run ${run_id}(${r.state})`);
    s.db.prepare("UPDATE runs SET state = '일시 중단', payload = ? WHERE run_id = ?").run(JSON.stringify({ ...JSON.parse(r.payload), paused: reason }), run_id);
    s.db.prepare('DELETE FROM run_leases WHERE run_id = ?').run(run_id);
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '일시 중단', reason } });
    emit({ type: 'wait.raised', subject: r.task_id, issuer: 'Resource', payload: { wait_id: `W-${run_id}-resource`, wait_type: 'resource', target_id: r.task_id,
      resolve_condition: reason === '사용 한도 소진' ? '사용 한도가 회복됨' : '예산 여유가 생김', action: { actor: '사용자', text: action, screen: 'Task 상세' } } });
  },
};

/** 단계 경계의 확인. 소진됐으면 Run을 멈추고 그 이유를 돌려준다. limit: 이번 단계에서 Runner가 보낸 사용 한도 신호. */
export function stopIfExhausted(s: Store, run_id: string, holder: Holder, limit?: boolean): string | undefined {
  const t = s.db.prepare('SELECT payload FROM tickets WHERE run_id = ?').get(run_id) as { payload: string };
  const reserved = JSON.parse(t.payload).reservation?.budget_usd;
  const reason = limit ? '사용 한도 소진'
    : typeof reserved === 'number' && spentUsd(s, run_id) >= reserved ? '예약 소진'
    : (budgetLeft(s) ?? 1) <= 0 ? '예산 소진' : undefined;
  if (!reason) return undefined;
  const action = reason === '사용 한도 소진' ? '사용 한도가 회복되면 이 실행을 취소하고 새로 시작' : '예산을 늘린 뒤 이 실행을 취소하고 새로 시작';
  const r = execute(s, { command: 'run.pause', principal: SYSTEM, channel: 'runner', args: { run_id, holder, reason, action } });
  if (!r.ok) throw new Error(`run.pause: ${r.reason} ${r.message}`);
  return reason;
}
