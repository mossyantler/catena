// ExecutionEvent 형식 버전 1(명세 v0.10.9에서 확정, T07): 유형마다 필수·선택 payload 필드와 열거형 값.
// Engine은 명령이 발행하는 이벤트를 이것으로 확인하고(commands.ts), 시험은 시나리오 묶음과 계획 이벤트를 확인한다(T34).
// 필드 안의 구조(슬롯, 조건, 노드 등)는 읽기 모델의 검사 규칙(E2~E11)이 본다. 실행 환경에 의존하지 않는다.
type Spec = { req: string[]; opt?: string[]; enums?: Record<string, string[]> };

export const FORMAT_V1: Record<string, Spec> = {
  'project.defined': { req: ['project_id', 'name', 'phases'] },
  'wbs_node.created': { req: ['node_id', 'kind', 'name', 'order'], opt: ['parent_id', 'phase_id'], enums: { kind: ['summary', 'task'] } },
  'wbs_node.closed': { req: ['node_id', 'lifecycle', 'reason'], enums: { lifecycle: ['취소됨', '닫힘'] } },
  'contract.confirmed': { req: ['task_id', 'contract_ref', 'goal', 'input_slots', 'output_slots', 'conditions'], opt: ['agent', 'write_scope'], enums: { agent: ['claude-code', 'codex'] } },
  'dependency.linked': { req: ['from', 'to'] },
  'workflow.bound': { req: ['task_id', 'nodes', 'edges'], opt: ['workflow_ref'] },
  'milestone.defined': { req: ['milestone_id', 'name', 'items'] },
  'run.created': { req: ['run_id', 'task_id', 'attempt'], opt: ['runner_ref', 'requested_by'] },
  'run.state_changed': { req: ['run_id', 'to'], opt: ['reason'], enums: { to: ['대기', '실행 중', '일시 중단', '결과 불명', '실패', '종료', '취소'] } },
  'node.started': { req: ['run_id', 'node_id', 'iteration'], opt: ['profile'] },
  'node.finished': { req: ['run_id', 'node_id', 'iteration', 'result'], enums: { result: ['성공', '실패', '중단'] } },
  'agent.activity': { req: ['run_id', 'node_id', 'iteration', 'kind', 'summary', 'source'], opt: ['to_instance', 'raw_ref'],
    enums: { kind: ['도구 호출', '메시지', '위임', '판단'], source: ['시스템 기록', 'Agent 보고'] } },
  'submission.created': { req: ['submission_id', 'run_id', 'node_id', 'slots', 'scope_check', 'diff_ref'], opt: ['rejected_paths'], enums: { scope_check: ['통과', '거부'] } },
  'evidence.recorded': { req: ['evidence_id', 'condition_id', 'submission_id', 'result', 'raw_log_ref'], opt: ['verifier_ref', 'verifier', 'collected_via', 'target_ref', 'environment'],
    enums: { result: ['통과', '실패', 'skip', '미실행'] } },
  'approval.requested': { req: ['approval_id', 'kind', 'condition_ids'], opt: ['submission_id'], enums: { kind: ['품질', '계획', '외부 실행', '예산'] } },
  'approval.decided': { req: ['approval_id', 'decision'], opt: ['comment', 'channel', 'channel_note', 'decided_by'], enums: { decision: ['승인', '반려'] } },
  'acceptance.recorded': { req: ['acceptance_id', 'scope', 'task_id', 'submission_id', 'condition_ids', 'evidence_ids'], opt: ['slot', 'approval_id', 'baseline_id', 'contract_ref', 'commit'],
    enums: { scope: ['slot', 'task'] } },
  'wait.raised': { req: ['wait_id', 'wait_type', 'target_id', 'resolve_condition', 'action'] },
  'wait.resolved': { req: ['wait_id'], opt: ['note'] },
  'usage.recorded': { req: ['run_id', 'cost_usd', 'reliability'], opt: ['node_id', 'tokens', 'billing'],
    enums: { reliability: ['보고값', '추정값', '알 수 없음'], billing: ['API', '구독', '알 수 없음'] } },
};
const ACTOR_KINDS = ['human', 'agent', 'code', 'system'];

/** 이벤트 하나가 형식 버전 1에 맞지 않는 곳. 맞으면 빈 배열이다. */
export function formatErrors(e: { type: string; actor?: any; payload?: any }): string[] {
  const f = FORMAT_V1[e.type];
  if (!f) return [`형식에 없는 유형 ${e.type}`];
  const errs: string[] = [];
  if (!ACTOR_KINDS.includes(e.actor?.kind) || typeof e.actor?.instance !== 'string') errs.push(`actor ${JSON.stringify(e.actor)}`);
  const p = e.payload ?? {};
  for (const k of f.req) if (p[k] === undefined) errs.push(`필수 필드 ${k} 없음`);
  for (const k of Object.keys(p)) if (!f.req.includes(k) && !f.opt?.includes(k)) errs.push(`형식에 없는 필드 ${k}`);
  for (const [k, vs] of Object.entries(f.enums ?? {})) if (p[k] !== undefined && !vs.includes(p[k])) errs.push(`${k} 값 ${p[k]}`);
  return errs;
}
