// Catena 읽기 모델과 검사 규칙 (core spec B-7, ExecutionEvent).
// 이벤트를 seq 순서로 접어(fold) 화면용 읽기 모델을 만들고, 같은 과정에서 검사 규칙 E1~E11을 확인한다.
// 실행 환경에 의존하지 않는다: Node(tools/fold.ts)와 브라우저(prototype/, 타입만 지워서 씀)가 같은 코드를 쓴다.

export type Ref = { kind: string; id: string; version: number };
type Actor = { kind: string; role?: string; instance: string };
export type Event = {
  event_id: string; seq: number; schema_version: number; occurred_at: string; origin: string;
  dataset_id?: string; type: string; subject: string; actor: Actor; issuer: string; caused_by?: string; payload: any;
};
export type Wait = {
  id: string; type: string; issuer: string; target: string; resolve: string; source?: string;
  action: { actor: string; text: string; screen: string }; raised_at: string; open: boolean; derived: boolean;
};

export const SUPPORTED_SCHEMA = [1];
export const STAGES = ['계획', '구현', '검증', '승인'];
export const CLOSED = ['분할됨', '통합됨', '취소됨', '닫힘'];
const RUN_NEXT: Record<string, string[]> = {
  '대기': ['실행 중', '취소'],
  '실행 중': ['일시 중단', '결과 불명', '실패', '종료', '취소'],
  '일시 중단': ['실행 중', '취소'],
  '결과 불명': ['실행 중', '실패', '종료'],
  '실패': [], '종료': [], '취소': [],
};
const EVENT_WAIT_TYPES = ['decision', 'resource', 'external', 'migration', 'revalidation']; // dependency·approval은 계산한다

export class RuleError extends Error {}
const fail = (rule: string, msg: string): never => { throw new RuleError(`${rule}: ${msg}`); };
const need = (ok: unknown, rule: string, msg: string) => { if (!ok) fail(rule, msg); };

// 처리 규칙 1~3, E1, E10: 줄 단위로 읽은 이벤트에서 중복을 걸러 내고 순서와 출처 선언을 확인한다.
export function checkStream(manifest: any, lines: string[]): Event[] {
  need(SUPPORTED_SCHEMA.includes(manifest.schema_version), 'E10', `지원하지 않는 schema_version ${manifest.schema_version}`);
  const byId = new Map<string, string>();
  const seqs = new Set<number>();
  const events: Event[] = [];
  for (const line of lines) {
    const e: Event = JSON.parse(line);
    const canon = JSON.stringify(e);
    if (byId.has(e.event_id)) {
      need(byId.get(e.event_id) === canon, 'E1', `같은 event_id에 다른 내용 ${e.event_id}`);
      continue; // 같은 내용의 중복은 무시
    }
    need(!seqs.has(e.seq), 'E1', `같은 seq ${e.seq}에 다른 이벤트`);
    need(e.seq === events.length + 1, 'E1', `seq 빈틈: ${events.length + 1} 기대, ${e.seq} 받음`);
    need(e.origin === manifest.origin && e.dataset_id === manifest.dataset_id && e.schema_version === manifest.schema_version, 'E10', `seq ${e.seq}의 출처 선언이 묶음과 다르다`);
    byId.set(e.event_id, canon);
    seqs.add(e.seq);
    events.push(e);
  }
  return events;
}

// 이벤트 payload 안의 원문 참조를 모두 모은다(미리 내려받아 해시를 확인할 때 쓴다).
export function refsOf(events: Event[]): Ref[] {
  const out: Ref[] = [];
  const walk = (v: any) => {
    if (!v || typeof v !== 'object') return;
    if (v.kind === 'artifact' && typeof v.id === 'string') { out.push(v); return; }
    for (const x of Object.values(v)) walk(x);
  };
  for (const e of events) walk(e.payload);
  return out;
}

export function emptyModel() {
  return {
    project: undefined as any,
    nodes: new Map<string, any>(),           // node_id -> {id, parent, kind, name, order, phase, lifecycle}
    contracts: new Map<string, any>(),       // task_id -> payload
    deps: [] as any[],                       // {from, to, at}
    workflows: new Map<string, any>(),       // task_id -> {nodes: Map, edges}
    milestones: new Map<string, any>(),
    runs: new Map<string, any>(),            // run_id -> {id, task, attempt, state, active: Map<node, iteration>, reason}
    nodeLog: [] as any[],                    // {run, task, node, iteration, actor, started, finished, result}
    submissions: new Map<string, any>(),
    evidence: new Map<string, any>(),
    latestEvidence: new Map<string, string>(), // task/condition -> result
    approvals: new Map<string, any>(),
    acceptances: [] as any[],
    slotAccepted: new Set<string>(),         // task/slot
    condAccepted: new Set<string>(),         // task/condition
    taskAccepted: new Set<string>(),
    waits: new Map<string, Wait>(),
    activities: [] as any[],
    usage: [] as any[],                      // {task, run, node, cost, reliability}
    lastAt: '',
  };
}
export type Model = ReturnType<typeof emptyModel>;

// refCheck: 원문을 찾지 못하거나 해시가 다르면 오류 문구, 맞으면 undefined
export function apply(m: Model, e: Event, refCheck: (r: Ref) => string | undefined) {
  const p = e.payload;
  m.lastAt = e.occurred_at;
  const ref = (r: Ref | undefined, optional = false) => {
    if (r === undefined && optional) return;
    need(r && r.kind === 'artifact' && /^sha256:[0-9a-f]{64}$/.test(r.id) && r.version === 1, 'E9', `참조 형식 오류 ${JSON.stringify(r)}`);
    const err = refCheck(r!);
    need(!err, 'E9', `${err} ${r!.id}`);
  };
  const task = (id: string, rule = 'E2') => {
    const n = m.nodes.get(id);
    need(n, rule, `없는 노드 ${id}`);
    need(n.kind === 'task', 'E3', `${id}는 Task가 아니다`);
    return n;
  };
  const hasRun = (taskId: string) => [...m.runs.values()].some(r => r.task === taskId);
  const runOf = (id: string) => { const r = m.runs.get(id); need(r, 'E2', `없는 Run ${id}`); return r; };
  const activeNode = (run: any, nodeId: string, iteration: number) =>
    need(run.active.get(nodeId) === iteration, 'E5', `${run.id}의 ${nodeId}(${iteration}회차)가 실행 중이 아니다`);
  const openWait = (w: Omit<Wait, 'open'>) => m.waits.set(w.id, { ...w, open: true });

  switch (e.type) {
    case 'project.defined':
      need(!m.project, 'E2', 'project.defined가 두 번 나왔다');
      m.project = p;
      break;

    case 'wbs_node.created': {
      need(!m.nodes.has(p.node_id), 'E2', `노드 ID 중복 ${p.node_id}`);
      if (p.parent_id) {
        const parent = m.nodes.get(p.parent_id);
        need(parent, 'E2', `부모 노드 없음 ${p.parent_id}`);
        need(parent.kind === 'summary', 'E3', `부모 ${p.parent_id}가 요약 노드가 아니다`);
        need(!CLOSED.includes(parent.lifecycle), 'E11', `닫힌 부모 ${p.parent_id}`);
      }
      need(['summary', 'task'].includes(p.kind), 'E3', `노드 종류 오류 ${p.kind}`);
      if (p.phase_id) {
        need(p.kind === 'task', 'E3', `Phase는 Task에만 붙는다 (${p.node_id})`);
        need(m.project.phases.some((ph: any) => ph.phase_id === p.phase_id), 'E2', `없는 Phase ${p.phase_id}`);
      }
      m.nodes.set(p.node_id, { id: p.node_id, parent: p.parent_id ?? undefined, kind: p.kind, name: p.name, order: p.order,
        phase: p.phase_id, lifecycle: p.kind === 'task' ? '계획 중' : '활성', closedReason: undefined });
      break;
    }

    case 'wbs_node.closed': {
      const n = m.nodes.get(p.node_id);
      need(n, 'E2', `없는 노드 ${p.node_id}`);
      need(!CLOSED.includes(n.lifecycle), 'E11', `이미 닫힌 노드 ${p.node_id}`);
      need(n.kind === 'task' ? p.lifecycle === '취소됨' : p.lifecycle === '닫힘', 'E11', `닫힘 값 오류 ${p.lifecycle}`);
      need(n.kind !== 'task' || !hasRun(n.id), 'E11', `Run이 생긴 Task는 잠겨 취소할 수 없다 (${n.id})`);
      n.lifecycle = p.lifecycle;
      n.closedReason = p.reason;
      break;
    }

    case 'contract.confirmed': {
      const n = task(p.task_id);
      need(!CLOSED.includes(n.lifecycle), 'E11', `닫힌 Task ${p.task_id}`);
      need(!hasRun(p.task_id), 'E11', `Run이 생긴 Task의 계약은 바꿀 수 없다 (${p.task_id})`);
      ref(p.contract_ref);
      const outs = new Set(p.output_slots.map((s: any) => s.name));
      const ids = new Set();
      for (const c of p.conditions) {
        need(!ids.has(c.condition_id), 'E4', `조건 ID 중복 ${c.condition_id}`); ids.add(c.condition_id);
        need(!c.slot || outs.has(c.slot), 'E4', `조건 ${c.condition_id}의 슬롯 ${c.slot}이 계약에 없다`);
        need(['auto', 'review', 'human'].includes(c.method), 'E4', `검증 방법 오류 ${c.method}`);
      }
      m.contracts.set(p.task_id, p);
      n.lifecycle = '활성';
      break;
    }

    case 'dependency.linked': {
      const to = task(p.to.task_id);
      need(!hasRun(to.id), 'E11', `Run이 생긴 Task의 의존은 바꿀 수 없다 (${to.id})`);
      const toC = m.contracts.get(to.id);
      need(toC, 'E2', `계약 없는 Task ${to.id}`);
      need(toC.input_slots.some((s: any) => s.name === p.to.slot), 'E4', `${to.id}에 입력 슬롯 ${p.to.slot} 없음`);
      if (p.from.external_ref) {
        ref(p.from.external_ref);
      } else {
        const from = task(p.from.task_id);
        const fromC = m.contracts.get(from.id);
        need(fromC, 'E2', `계약 없는 Task ${from.id}`);
        need(fromC.output_slots.some((s: any) => s.name === p.from.slot), 'E4', `${from.id}에 출력 슬롯 ${p.from.slot} 없음`);
        need(from.id !== to.id, 'E4', `자기 참조 ${to.id}`);
        need(!reaches(m, to.id, from.id), 'E4', `순환: ${from.id} → ${to.id}`);
      }
      need(!m.deps.some(d => d.to.task_id === to.id && d.to.slot === p.to.slot), 'E4', `입력 슬롯 ${to.id}.${p.to.slot}에 공급자가 둘이다`);
      m.deps.push({ ...p, at: e.occurred_at });
      break;
    }

    case 'workflow.bound': {
      task(p.task_id);
      need(!hasRun(p.task_id), 'E11', `Run이 생긴 Task의 Workflow는 바꿀 수 없다 (${p.task_id})`);
      ref(p.workflow_ref, true);
      const nodes = new Map<string, any>();
      for (const wn of p.nodes) {
        need(!nodes.has(wn.node_id), 'E3', `Workflow 노드 중복 ${wn.node_id}`);
        need(STAGES.includes(wn.stage), 'E3', `단계 종류 오류 ${wn.stage}`);
        need(['code', 'agent', 'human'].includes(wn.executor), 'E3', `실행 주체 오류 ${wn.executor}`);
        nodes.set(wn.node_id, wn);
      }
      for (const ed of p.edges) need(nodes.has(ed.from) && nodes.has(ed.to), 'E3', `없는 Workflow 노드를 잇는 엣지 ${ed.from}→${ed.to}`);
      m.workflows.set(p.task_id, { nodes, edges: p.edges });
      break;
    }

    case 'milestone.defined':
      for (const it of p.items) {
        task(it.task_id);
        need(!it.slot || m.contracts.get(it.task_id)?.output_slots.some((s: any) => s.name === it.slot), 'E2', `Milestone 항목 슬롯 없음 ${it.task_id}.${it.slot}`);
      }
      m.milestones.set(p.milestone_id, p);
      break;

    case 'run.created': {
      const n = task(p.task_id);
      need(n.lifecycle === '활성', 'E6', `활성이 아닌 Task ${p.task_id}`);
      need(m.contracts.has(p.task_id) && m.workflows.has(p.task_id), 'E2', `계약이나 Workflow 없는 Task ${p.task_id}`);
      need(!m.runs.has(p.run_id), 'E2', `Run ID 중복 ${p.run_id}`);
      need(![...m.runs.values()].some(r => r.task === p.task_id && r.attempt === p.attempt), 'E2', `시도 번호 중복 ${p.task_id}#${p.attempt}`);
      const missing = missingInputs(m, p.task_id);
      need(missing.length === 0, 'E6', `${p.task_id}의 필수 입력 미인수: ${missing.join(', ')}`);
      m.runs.set(p.run_id, { id: p.run_id, task: p.task_id, attempt: p.attempt, state: '대기', active: new Map(), created: e.occurred_at, reason: undefined });
      break;
    }

    case 'run.state_changed': {
      const r = runOf(p.run_id);
      need(RUN_NEXT[r.state]?.includes(p.to), 'E5', `Run 상태 전이 불가 ${r.state} → ${p.to}`);
      need(!['실패', '종료', '취소'].includes(p.to) || r.active.size === 0, 'E5', `실행 중인 노드가 남은 채 ${p.to}`);
      r.state = p.to;
      if (p.reason) r.reason = p.reason;
      break;
    }

    case 'node.started': {
      const r = runOf(p.run_id);
      need(r.state === '실행 중', 'E5', `${r.id}가 실행 중이 아닐 때 노드 시작`);
      need(m.workflows.get(r.task).nodes.has(p.node_id), 'E2', `Workflow에 없는 노드 ${p.node_id}`);
      need(!r.active.has(p.node_id), 'E5', `이미 실행 중인 노드 ${p.node_id}`);
      r.active.set(p.node_id, p.iteration);
      m.nodeLog.push({ run: r.id, task: r.task, node: p.node_id, iteration: p.iteration, actor: e.actor, started: e.occurred_at, profile: p.profile });
      break;
    }

    case 'node.finished': {
      const r = runOf(p.run_id);
      activeNode(r, p.node_id, p.iteration);
      need(['성공', '실패', '중단'].includes(p.result), 'E5', `노드 결과 오류 ${p.result}`);
      r.active.delete(p.node_id);
      const entry = m.nodeLog.findLast(x => x.run === r.id && x.node === p.node_id && x.iteration === p.iteration);
      entry.finished = e.occurred_at;
      entry.result = p.result;
      break;
    }

    case 'agent.activity': {
      const r = runOf(p.run_id);
      activeNode(r, p.node_id, p.iteration);
      need(['도구 호출', '메시지', '위임', '판단'].includes(p.kind), 'E5', `활동 종류 오류 ${p.kind}`);
      need(['시스템 기록', 'Agent 보고'].includes(p.source), 'E5', `활동 출처 오류 ${p.source}`);
      need(p.kind !== '위임' || p.to_instance, 'E5', '위임 활동에 to_instance가 없다');
      ref(p.raw_ref, true);
      m.activities.push({ ...p, task: r.task, actor: e.actor, at: e.occurred_at });
      break;
    }

    case 'submission.created': {
      const r = runOf(p.run_id);
      need(r.active.has(p.node_id), 'E5', `실행 중이 아닌 노드의 제출 ${p.node_id}`);
      need(!m.submissions.has(p.submission_id), 'E2', `제출 기록 ID 중복 ${p.submission_id}`);
      const outs = m.contracts.get(r.task).output_slots.map((s: any) => s.name);
      for (const s of p.slots) {
        need(outs.includes(s.output_slot), 'E4', `계약에 없는 출력 슬롯 ${s.output_slot}`);
        ref(s.artifact_ref, true);
      }
      ref(p.diff_ref);
      need(['통과', '거부'].includes(p.scope_check), 'E5', `scope_check 오류 ${p.scope_check}`);
      m.submissions.set(p.submission_id, { ...p, task: r.task, at: e.occurred_at, iteration: r.active.get(p.node_id) });
      break;
    }

    case 'evidence.recorded': {
      const s = m.submissions.get(p.submission_id);
      need(s, 'E2', `없는 제출 기록 ${p.submission_id}`);
      need(s.scope_check === '통과', 'E7', `쓰기 범위 검사에서 거부된 제출 기록은 검증하지 않는다 (${s.submission_id})`);
      need(m.contracts.get(s.task).conditions.some((c: any) => c.condition_id === p.condition_id), 'E2', `계약에 없는 조건 ${p.condition_id}`);
      need(['통과', '실패', 'skip', '미실행'].includes(p.result), 'E7', `검증 결과 오류 ${p.result}`);
      ref(p.raw_log_ref);
      ref(p.verifier_ref, true);
      m.evidence.set(p.evidence_id, { ...p, task: s.task, at: e.occurred_at });
      m.latestEvidence.set(`${s.task}/${p.condition_id}`, p.result);
      break;
    }

    case 'approval.requested': {
      need(!m.approvals.has(p.approval_id), 'E2', `승인 ID 중복 ${p.approval_id}`);
      let target = e.subject;
      if (p.submission_id) {
        const s = m.submissions.get(p.submission_id);
        need(s, 'E2', `없는 제출 기록 ${p.submission_id}`);
        need(s.scope_check === '통과', 'E7', `거부된 제출 기록에 승인 요청 ${p.submission_id}`);
        target = s.task;
      }
      m.approvals.set(p.approval_id, { ...p, task: target, requested: e.occurred_at });
      openWait({ id: `approval:${p.approval_id}`, type: 'approval', issuer: e.issuer, target, resolve: `승인 ${p.approval_id} 결정`,
        action: { actor: '사용자', text: p.submission_id ? `제출 기록 ${p.submission_id} 승인 또는 반려` : `${p.kind} 승인 또는 반려`, screen: '승인 화면' },
        raised_at: e.occurred_at, derived: true, source: p.approval_id });
      break;
    }

    case 'approval.decided': {
      const a = m.approvals.get(p.approval_id);
      need(a, 'E2', `없는 승인 ${p.approval_id}`);
      need(!a.decision, 'E8', `이미 결정된 승인 ${p.approval_id}`);
      need(['승인', '반려'].includes(p.decision), 'E7', `결정 값 오류 ${p.decision}`);
      need(e.actor.kind === 'human', 'E7', '승인은 사람이 결정한다');
      a.decision = p.decision;
      a.comment = p.comment;
      a.decided = e.occurred_at;
      m.waits.get(`approval:${p.approval_id}`)!.open = false;
      break;
    }

    case 'acceptance.recorded': {
      const n = task(p.task_id);
      const c = m.contracts.get(n.id);
      const s = m.submissions.get(p.submission_id);
      need(s && s.task === n.id && s.scope_check === '통과', 'E7', `인수 대상 제출 기록 오류 ${p.submission_id}`);
      const a = m.approvals.get(p.approval_id);
      need(a && a.decision === '승인' && a.submission_id === p.submission_id, 'E7', `승인 ${p.approval_id}이 같은 제출 기록의 '승인'이 아니다`);
      const ev = p.evidence_ids.map((id: string) => m.evidence.get(id));
      need(ev.every((x: any) => x && x.submission_id === p.submission_id && x.result === '통과'), 'E7', '증거가 같은 제출 기록의 통과 결과가 아니다');
      const conds = p.condition_ids.map((id: string) => c.conditions.find((x: any) => x.condition_id === id));
      need(conds.every(Boolean), 'E7', '계약에 없는 조건');
      for (const cd of conds) {
        if (cd.method === 'auto') need(ev.some((x: any) => x.condition_id === cd.condition_id), 'E7', `자동 조건 ${cd.condition_id}의 증거 없음`);
        else need(a.condition_ids.includes(cd.condition_id), 'E7', `사람 조건 ${cd.condition_id}이 승인 범위에 없음`);
      }
      const scoped = (slot?: string) => c.conditions.filter((x: any) => x.required && (x.slot ?? null) === (slot ?? null)).map((x: any) => x.condition_id);
      if (p.scope === 'slot') {
        need(c.output_slots.some((x: any) => x.name === p.slot), 'E7', `없는 슬롯 ${p.slot}`);
        need(!m.slotAccepted.has(`${n.id}/${p.slot}`), 'E7', `이미 인수된 슬롯 ${n.id}.${p.slot}`);
        need(conds.every((x: any) => x.slot === p.slot) && scoped(p.slot).every((id: string) => p.condition_ids.includes(id)), 'E7', `슬롯 ${p.slot}의 필수 조건을 모두 덮지 않는다`);
        m.slotAccepted.add(`${n.id}/${p.slot}`);
      } else {
        need(p.scope === 'task', 'E7', `인수 범위 오류 ${p.scope}`);
        need(!m.taskAccepted.has(n.id), 'E7', `이미 인수된 Task ${n.id}`);
        need(c.output_slots.filter((x: any) => x.required).every((x: any) => m.slotAccepted.has(`${n.id}/${x.name}`)), 'E7', '필수 출력 슬롯이 모두 인수되지 않았다');
        need(conds.every((x: any) => !x.slot) && scoped().every((id: string) => p.condition_ids.includes(id)), 'E7', 'Task 조건을 모두 덮지 않는다');
        m.taskAccepted.add(n.id);
      }
      for (const id of p.condition_ids) m.condAccepted.add(`${n.id}/${id}`);
      m.acceptances.push({ ...p, at: e.occurred_at });
      break;
    }

    case 'wait.raised':
      need(EVENT_WAIT_TYPES.includes(p.wait_type), 'E8', `${p.wait_type} 대기 사유는 이벤트로 발행하지 않고 계산한다`);
      need(!m.waits.has(p.wait_id), 'E2', `대기 사유 ID 중복 ${p.wait_id}`);
      need(m.nodes.has(p.target_id), 'E2', `없는 대상 ${p.target_id}`);
      need(['사용자', '시스템', 'Agent', '외부'].includes(p.action.actor), 'E8', `해소 행동 주체 오류 ${p.action.actor}`);
      openWait({ id: p.wait_id, type: p.wait_type, issuer: e.issuer, target: p.target_id, resolve: p.resolve_condition,
        action: p.action, raised_at: e.occurred_at, derived: false });
      break;

    case 'wait.resolved': {
      const w = m.waits.get(p.wait_id);
      need(w && w.open && !w.derived, 'E8', `열린 대기 사유가 아니다 ${p.wait_id}`);
      w!.open = false;
      break;
    }

    case 'usage.recorded': {
      const r = runOf(p.run_id);
      need(typeof p.cost_usd === 'number' && ['보고값', '추정값', '알 수 없음'].includes(p.reliability), 'E2', '사용량 형식 오류');
      m.usage.push({ task: r.task, run: r.id, node: p.node_id, cost: p.cost_usd, reliability: p.reliability });
      break;
    }

    default:
      fail('E2', `알 수 없는 이벤트 유형 ${e.type}`);
  }
}

// 원본 의존에서 a에서 b로 가는 경로가 있는가
function reaches(m: Model, a: string, b: string): boolean {
  const seen = new Set<string>();
  const stack = [a];
  while (stack.length) {
    const x = stack.pop()!;
    if (x === b) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    for (const d of m.deps) if (d.from.task_id === x) stack.push(d.to.task_id);
  }
  return false;
}

// 1-4: 인수되지 않은 필수 입력 슬롯
function missingInputs(m: Model, taskId: string): string[] {
  const c = m.contracts.get(taskId);
  return c.input_slots.filter((s: any) => s.required).filter((s: any) => {
    const d = m.deps.find(x => x.to.task_id === taskId && x.to.slot === s.name);
    if (!d) return true;
    return !d.from.external_ref && !m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`);
  }).map((s: any) => s.name);
}

// ---- 읽기 모델에서 계산하는 화면 값 (ExecutionEvent의 읽기 모델 계산) ----

export function waitsOf(m: Model, taskId: string): Wait[] {
  const ws = [...m.waits.values()].filter(w => w.open && w.target === taskId);
  const n = m.nodes.get(taskId);
  const ranAlready = [...m.runs.values()].some(r => r.task === taskId);
  if (n.lifecycle === '활성' && !ranAlready) {
    for (const s of m.contracts.get(taskId).input_slots.filter((x: any) => x.required)) {
      const d = m.deps.find(x => x.to.task_id === taskId && x.to.slot === s.name);
      if (!d) {
        ws.push({ id: `dep:${taskId}/${s.name}`, type: 'dependency', issuer: 'Planning', target: taskId, resolve: `${s.name} 슬롯의 공급 Task 연결`,
          action: { actor: '사용자', text: `${s.name} 슬롯을 공급할 Task 연결`, screen: 'Task 상세' }, raised_at: '', open: true, derived: true });
      } else if (!d.from.external_ref && !m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)) {
        const src = m.nodes.get(d.from.task_id).name;
        ws.push({ id: `dep:${taskId}/${s.name}`, type: 'dependency', issuer: 'Planning', target: taskId, resolve: `${src}의 ${d.from.slot} 슬롯 인수`,
          action: { actor: '시스템', text: `선행 Task "${src}" 진행`, screen: '선행 Task' }, raised_at: d.at, open: true, derived: true, source: d.from.task_id });
      }
    }
  }
  // 사용자가 해소할 수 있는 것을 먼저, 그다음 오래된 것
  return ws.sort((a, b) => Number(b.action.actor === '사용자') - Number(a.action.actor === '사용자') || a.raised_at.localeCompare(b.raised_at));
}

export function card(m: Model, taskId: string) {
  const n = m.nodes.get(taskId);
  const runs = [...m.runs.values()].filter(r => r.task === taskId).sort((a, b) => b.attempt - a.attempt);
  const run = runs[0];
  const exec = run ? run.state : '없음';
  const wf = m.workflows.get(taskId);
  const stages = run && run.state === '실행 중'
    ? STAGES.filter(st => [...run.active.keys()].some(k => wf.nodes.get(k).stage === st)) : [];
  const openApproval = [...m.approvals.values()].some(a => a.task === taskId && !a.decision);
  const acceptance = m.taskAccepted.has(taskId) ? '인수됨' : openApproval ? '검증 중' : '미인수';
  const waits = n.lifecycle === '활성' ? waitsOf(m, taskId) : [];
  let rep: string;
  if (n.lifecycle !== '활성') rep = n.lifecycle;
  else if (['대기', '실행 중', '일시 중단', '결과 불명'].includes(exec)) rep = exec;
  else if (acceptance === '검증 중' || acceptance === '재검증 필요') rep = acceptance;
  else if (exec === '실패') rep = '실패';
  else if (acceptance === '인수됨') rep = '인수됨';
  else if (waits.length) rep = '대기';
  else rep = '착수 가능';
  const conds = (m.contracts.get(taskId)?.conditions ?? []).filter((c: any) => c.required);
  const accepted = conds.filter((c: any) => m.condAccepted.has(`${taskId}/${c.condition_id}`)).length;
  const passed = conds.filter((c: any) => !m.condAccepted.has(`${taskId}/${c.condition_id}`) && m.latestEvidence.get(`${taskId}/${c.condition_id}`) === '통과').length;
  return { rep, stages, exec, acceptance, accepted, total: conds.length, passed, waits, run };
}

// 완료 조건 하나의 상태
export function conditionState(m: Model, taskId: string, condId: string): string {
  if (m.condAccepted.has(`${taskId}/${condId}`)) return '인수됨';
  const r = m.latestEvidence.get(`${taskId}/${condId}`);
  if (r === undefined) return '미검증';
  return r === '통과' ? '검증 통과(인수 대기)' : '검증 실패';
}

export function path(m: Model, id: string): string[] {
  const ids: string[] = [];
  for (let n = m.nodes.get(id); n; n = n.parent ? m.nodes.get(n.parent) : undefined) ids.unshift(n.id);
  return ids;
}

// node 아래(자신 포함)의 Task들
export function tasksUnder(m: Model, nodeId?: string, includeClosed = false): string[] {
  return [...m.nodes.values()].filter(n => n.kind === 'task' && (includeClosed || !CLOSED.includes(n.lifecycle))
    && (!nodeId || path(m, n.id).includes(nodeId))).map(n => n.id);
}

// parent(없으면 최상위)의 하위 노드 사이에 그릴 엣지. 한쪽이라도 요약 노드면 집계 엣지다.
// 하위 노드마다 범위 밖과 오가는 의존 수도 함께 센다.
export function edgesAt(m: Model, parent?: string, includeClosed = false) {
  const children = [...m.nodes.values()].filter(n => n.parent === parent && (includeClosed || !CLOSED.includes(n.lifecycle))).map(n => n.id);
  const childOf = (taskId: string) => {
    for (let n = m.nodes.get(taskId); n; n = n.parent ? m.nodes.get(n.parent) : undefined) if (children.includes(n.id)) return n.id;
  };
  const edges = new Map<string, { from: string; to: string; count: number; accepted: number; aggregated: boolean }>();
  const external = new Map<string, { in: number; out: number }>();
  const ext = (id: string) => { if (!external.has(id)) external.set(id, { in: 0, out: 0 }); return external.get(id)!; };
  for (const d of m.deps) {
    if (d.from.external_ref) continue;
    const a = childOf(d.from.task_id), b = childOf(d.to.task_id);
    if (a && !b) { ext(a).out++; continue; }
    if (!a && b) { ext(b).in++; continue; }
    if (!a || !b || a === b) continue;
    const key = `${a}>${b}`;
    const ed = edges.get(key) ?? { from: a, to: b, count: 0, accepted: 0,
      aggregated: m.nodes.get(a).kind === 'summary' || m.nodes.get(b).kind === 'summary' };
    ed.count++;
    if (m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)) ed.accepted++;
    edges.set(key, ed);
  }
  return { children, edges: [...edges.values()], external };
}

// 원본 의존 기준 선행·후행 Task
export function relations(m: Model, taskId: string) {
  const walk = (start: string, dir: 'up' | 'down') => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const x = stack.pop()!;
      for (const d of m.deps) {
        if (d.from.external_ref) continue;
        const [a, b] = dir === 'down' ? [d.from.task_id, d.to.task_id] : [d.to.task_id, d.from.task_id];
        if (a === x && !seen.has(b)) { seen.add(b); stack.push(b); }
      }
    }
    return seen;
  };
  return { ancestors: walk(taskId, 'up'), descendants: walk(taskId, 'down') };
}

// 5-4·C-1: 인수되지 않은 슬롯 때문에 직접 막고 있는 후행 Task 수
export function blocking(m: Model): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of tasksUnder(m)) {
    for (const w of waitsOf(m, id)) if (w.type === 'dependency' && w.source) out.set(w.source, (out.get(w.source) ?? 0) + 1);
  }
  return out;
}

// 대표 상태별 Task 수와 완료 조건 합계(상위 노드·Phase 집계, C-1)
export function aggregate(m: Model, ids: string[]) {
  const counts = new Map<string, number>();
  let acc = 0, tot = 0, ready = 0;
  for (const id of ids) {
    const c = card(m, id);
    counts.set(c.rep, (counts.get(c.rep) ?? 0) + 1);
    acc += c.accepted; tot += c.total;
    if (c.rep === '착수 가능') ready++;
  }
  return { counts, acc, tot, ready };
}

// C-10: 해소 행동의 주체가 사용자인 대기 사유, 오래된 것부터
export function inbox(m: Model) {
  return tasksUnder(m).flatMap(id => waitsOf(m, id).filter(w => w.action.actor === '사용자').map(w => ({ id, w })))
    .sort((a, b) => a.w.raised_at.localeCompare(b.w.raised_at));
}

// ids 사이의 원본 의존을 Task 쌍으로 묶은 엣지(C-1 화면 표현 규칙 1)
export function taskEdges(m: Model, ids: string[]) {
  const set = new Set(ids);
  const pairs = new Map<string, { from: string; to: string; count: number; accepted: number }>();
  for (const d of m.deps) {
    if (d.from.external_ref || !set.has(d.from.task_id) || !set.has(d.to.task_id)) continue;
    const k = `${d.from.task_id}>${d.to.task_id}`;
    const p = pairs.get(k) ?? { from: d.from.task_id, to: d.to.task_id, count: 0, accepted: 0 };
    p.count++;
    if (m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`)) p.accepted++;
    pairs.set(k, p);
  }
  return [...pairs.values()];
}

// Q8: Run마다 Agent 단계가 몇 회차까지 갔는지(round)와 통과하지 못한 검사
export function rework(m: Model, taskId: string) {
  const wf = m.workflows.get(taskId);
  return [...m.runs.values()].filter(r => r.task === taskId).sort((a, b) => a.attempt - b.attempt).map(r => {
    const iters = m.nodeLog.filter(l => l.run === r.id && wf.nodes.get(l.node).executor === 'agent').map(l => l.iteration);
    const subs = new Set([...m.submissions.values()].filter(s => s.run_id === r.id).map(s => s.submission_id));
    const failed = [...m.evidence.values()].filter(e => subs.has(e.submission_id) && e.result !== '통과')
      .map(e => ({ evidence_id: e.evidence_id, condition_id: e.condition_id, result: e.result, submission_id: e.submission_id }));
    return { run_id: r.id, attempt: r.attempt, state: r.state, reason: r.reason, round: Math.max(0, ...iters), failed };
  });
}
export const hasRework = (m: Model, taskId: string) => rework(m, taskId).some(r => r.round > 1 || r.failed.length > 0);

// C-9: 최신 Run 기준 Workflow 노드 상태, 수행 주체와 profile, 반복 엣지의 회차
export function agentGraph(m: Model, taskId: string) {
  const wf = m.workflows.get(taskId);
  const run = [...m.runs.values()].filter(r => r.task === taskId).sort((a, b) => b.attempt - a.attempt)[0];
  const logs = run ? m.nodeLog.filter(x => x.run === run.id) : [];
  const nodes = [...wf.nodes.values()].map((wn: any) => {
    const ls = logs.filter(l => l.node === wn.node_id);
    const status = run?.state === '실행 중' && run.active.has(wn.node_id) ? '실행 중' : !ls.length ? '시작 전' : ls[ls.length - 1].result ?? '실행 중';
    const profiles = [...new Map(ls.filter(l => l.profile).map(l => [JSON.stringify(l.profile), l.profile])).values()];
    return { ...wn, status, runs: ls.length, instances: [...new Set(ls.map(l => l.actor.instance))], profiles };
  });
  const edges = wf.edges.map((e: any) => ({ ...e,
    loops: e.kind === '반복' ? Math.max(0, ...logs.filter(l => l.node === e.to).map(l => l.iteration - 1)) : 0 }));
  return { run, nodes, edges };
}

// C-9 활동 기록: 최신 Run에서 노드 하나에 붙은 기록
export function nodeActivity(m: Model, taskId: string, nodeId: string) {
  const wn = m.workflows.get(taskId).nodes.get(nodeId);
  const run = [...m.runs.values()].filter(r => r.task === taskId).sort((a, b) => b.attempt - a.attempt)[0];
  if (!run) return { run, logs: [], acts: [], subs: [], evs: [], approvals: [], cost: 0 };
  const logs = m.nodeLog.filter(x => x.run === run.id && x.node === nodeId);
  return {
    run, logs,
    acts: m.activities.filter(a => a.run_id === run.id && a.node_id === nodeId),
    subs: [...m.submissions.values()].filter(s => s.run_id === run.id && s.node_id === nodeId),
    // 검사 노드의 증거는 노드가 실행된 시간 안에 기록된 것으로 묶는다
    evs: wn.executor === 'code' ? [...m.evidence.values()].filter(e => e.task === taskId && logs.some(l => e.at >= l.started && (!l.finished || e.at <= l.finished))) : [],
    approvals: wn.executor === 'human' ? [...m.approvals.values()].filter(a => a.task === taskId) : [],
    cost: m.usage.filter(u => u.run === run.id && u.node === nodeId).reduce((s, u) => s + u.cost, 0),
  };
}

// 처리 규칙 5: 묶음 전체를 검사한 뒤 at까지 접는다. 검사 실패면 RuleError를 던진다.
export function foldAll(events: Event[], refCheck: (r: Ref) => string | undefined, at?: number) {
  const full = emptyModel();
  for (const e of events) {
    try { apply(full, e, refCheck); } catch (err) {
      if (err instanceof RuleError) throw new RuleError(`seq ${e.seq} (${e.event_id}, ${e.type}) ${err.message}`);
      throw err;
    }
  }
  if (at === undefined || at >= events.length) return full;
  const m = emptyModel();
  for (const e of events.slice(0, at)) apply(m, e, refCheck);
  return m;
}
