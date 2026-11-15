// 워크플로우 템플릿 실행(T23, 3-2, 6-2, 6-3, 6-5): 내장 템플릿 '구현 → 자동 검사 → 실패 시 수정(상한 N회) → 사용자 승인'을
// 순차로 돈다. 검사가 상한만큼 실패하면 Run을 실패로 닫고 decision 대기를 낸다. 통과하면 사용자 확인 조건이 있을 때만 승인을 기다리고,
// 같은 결과(제출 기록)로 검수를 기록한 뒤 Run을 종료한다. 상태 전이는 6-3 전이표(E5)를 따르고, 읽기 모델이 다시 확인한다.
import { foldAll } from '../tools/readmodel.ts';
import { execute, HANDLERS, Refusal, spentUsd, TEMPLATES } from './commands.ts';
import { beginRun, holds, renewLease, type Holder } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { runCheckNode, type Checked } from './verify.ts';
import { recordAcceptance, requestApproval } from './accept.ts';
import type { Store } from './store.ts';

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };
const ok = (r: ReturnType<typeof execute>, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason} ${r.message}`); return r; };

// Run을 종료로 닫는다(검수까지 끝났을 때). 예약은 기록된 사용량으로 정산한다
HANDLERS['run.finish'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder } = cmd.args;
    if (!holds(s, run_id, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`);
    const t = s.db.prepare('SELECT ticket_id, payload FROM tickets WHERE run_id = ?').get(run_id) as { ticket_id: string; payload: string };
    const ticket = { ...JSON.parse(t.payload), status: '정산 완료', settlement: { charged_usd: spentUsd(s, run_id), reliability: '추정값', reason: '종료' } };
    s.db.prepare("UPDATE tickets SET status = '정산 완료', payload = ? WHERE ticket_id = ?").run(JSON.stringify(ticket), t.ticket_id);
    s.db.prepare("UPDATE runs SET state = '종료' WHERE run_id = ?").run(run_id);
    s.db.prepare('DELETE FROM run_leases WHERE run_id = ?').run(run_id);
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '종료' } });
  },
};

export type WorkflowResult = { outcome: '검수' | '실패' | '취소' | '일시 중단' | '중단'; reason?: string; iterations: number; submission_id?: string };

const failRun = (s: Store, run_id: string, holder: Holder, reason: string, action: string) =>
  ok(execute(s, { command: 'run.fail', principal: SYSTEM, channel: 'runner', args: { run_id, holder, reason, action } }), 'run.fail');
const repairNote = (checks: Checked[], s: Store) => {
  const m = foldAll(s.events(), s.refCheck);
  return ['이전 결과가 검사를 통과하지 못했다. 같은 작업 디렉터리에서 고친다.',
    ...checks.filter(c => c.result !== '통과').map(c => `- ${c.condition_id}: ${c.result}${m.evidence.get(c.evidence_id)?.raw_log_ref ? ` (검사 로그 ${m.evidence.get(c.evidence_id).raw_log_ref.id})` : ''}`)].join('\n');
};

/** Run 하나를 워크플로우 끝까지 감독한다. 대기 중인 Run이면 시작(임대 획득)부터 한다. */
export async function runWorkflow(s: Store, o: { run_id: string; holder: Holder; command?: string[]; tickMs?: number; pollMs?: number; ttlMs?: number }): Promise<WorkflowResult> {
  const ttl = o.ttlMs ?? 30_000;
  let m = foldAll(s.events(), s.refCheck);
  const run = m.runs.get(o.run_id);
  if (!run) throw new Error(`Run ${o.run_id}을(를) 찾을 수 없다`);
  if (run.state === '대기') ok(beginRun(s, o.run_id, o.holder, ttl), 'run.begin');
  const wf = m.workflows.get(run.task);
  const approve = wf.nodes.has('approve');
  const limit = TEMPLATES[approve ? 'approve' : 'auto'].repair_limit;

  let note: string | undefined;
  let passed: string | undefined;
  let i = 1;
  for (; i <= limit; i++) {
    const step = await runAgentNode(s, { run_id: o.run_id, node_id: 'work', iteration: i, holder: o.holder, command: o.command, tickMs: o.tickMs, ttlMs: ttl, repair: note });
    if (step.cancelled) return { outcome: '취소', iterations: i };
    if (step.paused) return { outcome: '일시 중단', reason: step.paused, iterations: i };
    if (!step.submission) return { outcome: '중단', reason: '감독 임대를 잃음', iterations: i };
    if (step.submission.scope_check === '거부') return { outcome: '실패', reason: '쓰기 범위', iterations: i, submission_id: step.submission.submission_id };
    let checks: Checked[];
    try { checks = await runCheckNode(s, { run_id: o.run_id, iteration: i, holder: o.holder, submission_id: step.submission.submission_id }); }
    catch (err) {
      if (!holds(s, o.run_id, o.holder)) return { outcome: /멈췄다/.test((err as Error).message) ? '일시 중단' : '중단', reason: (err as Error).message, iterations: i };
      throw err;
    }
    if (checks.every(c => c.result === '통과')) { passed = step.submission.submission_id; break; }
    note = repairNote(checks, s);
  }
  if (!passed) {
    // 6-5: 상한에 닿으면 실패로 닫고 사용자가 새 시도나 취소를 고른다
    failRun(s, o.run_id, o.holder, `수정 반복 상한 ${limit}회 도달`, '실패한 검사 로그를 보고 다시 실행할지 결정');
    return { outcome: '실패', reason: `수정 반복 상한 ${limit}회 도달`, iterations: limit };
  }

  if (approve) {
    const req = ok(requestApproval(s, passed), 'approval.request');
    const approval_id = req.events[0].payload.approval_id;
    const ids = { run_id: o.run_id, node_id: 'approve', iteration: 1, holder: o.holder };
    ok(execute(s, { command: 'node.start', principal: SYSTEM, channel: 'runner', args: { ...ids, profile: { runtime: '사용자', model: '승인' } } }), 'node.start');
    // 사용자가 대화형 CLI(또는 검수표·화면)에서 결정할 때까지 기다린다. 기다리는 동안 감독 임대를 연장하고 취소 요청을 본다
    for (;;) {
      await new Promise(r => setTimeout(r, o.pollMs ?? 1000));
      if (!renewLease(s, o.run_id, o.holder, ttl)) return { outcome: '중단', reason: '감독 임대를 잃음', iterations: i, submission_id: passed };
      const row = s.db.prepare('SELECT state, payload FROM runs WHERE run_id = ?').get(o.run_id) as { state: string; payload: string };
      if (JSON.parse(row.payload).cancel_requested) {
        ok(execute(s, { command: 'node.finish', principal: SYSTEM, channel: 'runner', args: { ...ids, result: '중단' } }), 'node.finish');
        ok(execute(s, { command: 'run.cancelled', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, holder: o.holder } }), 'run.cancelled');
        return { outcome: '취소', iterations: i, submission_id: passed };
      }
      m = foldAll(s.events(), s.refCheck);
      const a = m.approvals.get(approval_id);
      if (!a?.decision) continue;
      ok(execute(s, { command: 'node.finish', principal: SYSTEM, channel: 'runner', args: { ...ids, result: a.decision === '승인' ? '성공' : '실패' } }), 'node.finish');
      if (a.decision === '반려') {
        failRun(s, o.run_id, o.holder, '반려', `반려 사유(${a.comment ?? ''})를 보고 다시 실행할지 결정`);
        return { outcome: '실패', reason: '반려', iterations: i, submission_id: passed };
      }
      break;
    }
  }
  ok(recordAcceptance(s, passed), 'acceptance.record');
  ok(execute(s, { command: 'run.finish', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, holder: o.holder } }), 'run.finish');
  return { outcome: '검수', iterations: i, submission_id: passed };
}
