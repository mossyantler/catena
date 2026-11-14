// 승인과 검수(T22, 7-5, 7-8, 9-3, 9-4, 9-10): 사용자 확인 조건은 같은 결과(제출 기록)에 대한 승인 요청으로 묻고,
// 승인과 반려는 대화형 CLI에서만 받는다. 검수는 같은 제출 기록의 통과한 검수 근거와 승인으로만 기록한다.
// 14-15(2026-11-14 결정): 같은 사용자 권한의 Agent가 대화형 채널을 흉내 내는 것은 막지 않고 한계로 둔다. 승인마다 그 사실을 남긴다.
import { foldAll } from '../tools/readmodel.ts';
import { execute, HANDLERS, Refusal } from './commands.ts';
import type { Store } from './store.ts';

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };
/** 승인을 받을 수 있는 채널(9-10). Integrated부터 Web UI가 더해진다. */
export const APPROVAL_CHANNELS = ['cli-tty'];
export const CHANNEL_NOTE = '같은 사용자 권한의 Agent도 이 채널을 흉내 낼 수 있다(14-15, 한계로 둠)';

const subOf = (s: Store, id: string) => {
  const row = s.db.prepare('SELECT payload FROM submissions WHERE submission_id = ?').get(id) as { payload: string } | undefined;
  return row && JSON.parse(row.payload);
};

// 사용자 확인 조건(human)을 그 결과에 대해 묻는다. 결과가 쓰기 범위에서 거부됐으면 묻지 않는다(E7)
HANDLERS['approval.request'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { submission_id } = cmd.args;
    const sub = subOf(s, submission_id);
    if (!sub) throw new Refusal('대상 없음', `제출 기록 ${submission_id}을(를) 찾을 수 없다`);
    const m = foldAll(s.events(), s.refCheck);
    const task = m.runs.get(sub.run_id).task;
    const condition_ids = m.contracts.get(task).conditions.filter((c: any) => c.required && c.method !== 'auto').map((c: any) => c.condition_id);
    if (!condition_ids.length) throw new Refusal('규칙 위반', `${task}에는 사용자 확인 조건이 없다. 자동 조건만 있으면 승인 없이 검수한다(7-4)`);
    const n = (s.db.prepare('SELECT COUNT(*) AS n FROM approval_requests').get() as { n: number }).n;
    const approval_id = `${submission_id}-a${n + 1}`;
    const req = { approval_id, kind: '검수', submission_id, condition_ids };
    s.db.prepare('INSERT INTO approval_requests VALUES (?, ?)').run(approval_id, JSON.stringify(req));
    emit({ type: 'approval.requested', subject: submission_id, issuer: 'Policy', payload: req });
  },
};

// 승인·반려는 사람만, 대화형 채널에서만(9-10). 비대화형 실행(--json, 파이프)과 Runner 안에서 온 요청은 거부한다
HANDLERS['approval.decide'] = {
  principals: ['human'],
  run: (s, cmd, _p, emit) => {
    const { approval_id, decision, comment } = cmd.args ?? {};
    if (!APPROVAL_CHANNELS.includes(cmd.channel)) throw new Refusal('권한 거부', `승인은 대화형 CLI에서만 받는다(9-10). 이 요청의 채널: ${cmd.channel}`);
    const req = s.db.prepare('SELECT payload FROM approval_requests WHERE approval_id = ?').get(approval_id) as { payload: string } | undefined;
    if (!req) throw new Refusal('대상 없음', `승인 요청 ${approval_id}을(를) 찾을 수 없다`);
    if (!['승인', '반려'].includes(decision)) throw new Refusal('규칙 위반', '결정은 승인 또는 반려다');
    if (decision === '반려' && !String(comment ?? '').trim()) throw new Refusal('규칙 위반', '반려할 때는 이유를 적는다');
    const d = { approval_id, decision, comment: comment ?? '', channel: cmd.channel, channel_note: CHANNEL_NOTE, decided_by: cmd.principal };
    try { s.db.prepare('INSERT INTO approval_decisions VALUES (?, ?)').run(approval_id, JSON.stringify(d)); }
    catch { throw new Refusal('규칙 위반', `이미 결정한 승인 요청 ${approval_id}`); }
    emit({ type: 'approval.decided', subject: JSON.parse(req.payload).submission_id, issuer: 'Policy', payload: d });
  },
};

// 검수 기록(7-5): 결과 항목마다 그 항목의 필수 조건이 모두 같은 제출 기록의 근거(자동: 통과한 검수 근거, 사용자 확인: 승인)로
// 덮이면 결과 항목을 검수하고, 결과 항목이 모두 검수되고 Task 조건도 덮이면 Task를 검수한다. 규칙은 읽기 모델(E7)이 다시 확인한다
HANDLERS['acceptance.record'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { submission_id } = cmd.args;
    const sub = subOf(s, submission_id);
    if (!sub) throw new Refusal('대상 없음', `제출 기록 ${submission_id}을(를) 찾을 수 없다`);
    const m = foldAll(s.events(), s.refCheck);
    const run = m.runs.get(sub.run_id);
    const task_id = run.task;
    const c = m.contracts.get(task_id);
    const baseline_id = JSON.parse((s.db.prepare('SELECT payload FROM runs WHERE run_id = ?').get(sub.run_id) as { payload: string }).payload).baseline_id;
    const passed = [...m.evidence.values()].filter((e: any) => e.submission_id === submission_id && e.result === '통과');
    const approval = [...m.approvals.values()].find((a: any) => a.submission_id === submission_id && a.decision === '승인');
    const covered = (cd: any) => cd.method === 'auto'
      ? passed.some((e: any) => e.condition_id === cd.condition_id && (!cd.verifier_ref || e.verifier_ref?.id === cd.verifier_ref.id))
      : Boolean(approval?.condition_ids.includes(cd.condition_id));
    const record = (scope: 'slot' | 'task', slot?: string) => {
      const conds = c.conditions.filter((x: any) => x.required && (x.slot ?? null) === (slot ?? null));
      if (!conds.every(covered)) return false;
      const condition_ids = conds.map((x: any) => x.condition_id);
      const evidence_ids = passed.filter((e: any) => condition_ids.includes(e.condition_id)).map((e: any) => e.evidence_id);
      const needsApproval = conds.some((x: any) => x.method !== 'auto');
      const acceptance_id = `${submission_id}-${scope === 'slot' ? slot : 'task'}`;
      // 검수 기록에서 Baseline, 근거, 승인, 고정된 commit을 따라갈 수 있다(Engine 인수 기준 6, 7)
      const p = { acceptance_id, scope, task_id, ...(slot ? { slot } : {}), submission_id, condition_ids, evidence_ids,
        ...(needsApproval ? { approval_id: approval.approval_id } : {}), baseline_id, contract_ref: c.contract_ref, commit: sub.commit };
      s.db.prepare('INSERT INTO acceptances VALUES (?, ?, ?)').run(acceptance_id, task_id, JSON.stringify(p));
      emit({ type: 'acceptance.recorded', subject: task_id, issuer: 'Validation & Acceptance', payload: p });
      return true;
    };
    const slots = c.output_slots.filter((o: any) => o.required && !m.slotAccepted.has(`${task_id}/${o.name}`)).map((o: any) => o.name);
    if (!slots.length && m.taskAccepted.has(task_id)) throw new Refusal('규칙 위반', `이미 검수한 Task ${task_id}`);
    const done = slots.filter((x: string) => record('slot', x));
    if (!done.length && slots.length) throw new Refusal('규칙 위반', `검수할 수 있는 결과 항목이 없다: 같은 제출 기록 ${submission_id}의 통과한 검수 근거와 승인이 조건을 덮지 않는다`);
    if (done.length === slots.length && !m.taskAccepted.has(task_id)) record('task');
  },
};

export const requestApproval = (s: Store, submission_id: string) =>
  execute(s, { command: 'approval.request', principal: SYSTEM, channel: 'runner', args: { submission_id } });
export const recordAcceptance = (s: Store, submission_id: string) =>
  execute(s, { command: 'acceptance.record', principal: SYSTEM, channel: 'runner', args: { submission_id } });
