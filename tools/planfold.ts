// Catena 제작 공정의 계획 파일을 읽기 모델로 접는다. Node(tools/plan.ts)와 화면(?data=catena)이 함께 쓴다.
// 계획을 계획 이벤트로 바꿔 검사 규칙(E2~E4, E9, E11)을 그대로 거치고, 사람 인수 기록을 더한다.
// 작업은 Catena가 시작한 Run이 아니므로(0-11) 실행·제출·인수 이벤트는 만들지 않는다. 이벤트는 메모리 안에서만 쓴다.
// readmodel.ts처럼 실행 환경에 의존하지 않는다. sha256은 호출하는 쪽이 넣는다(브라우저는 미리 계산해 둔다).
import { foldAll, waitsOf, type Event, type Model } from './readmodel.ts';

export type Sha = (text: string) => string; // 원문 → hex

// 계획 파일의 Task 하나를 contract.confirmed payload(원문 참조 제외)로 바꾼다. 슬롯과 조건은 모두 필수다(Engine MVP 제약).
function contractOf(t: any) {
  return {
    task_id: t.id, goal: t.goal,
    input_slots: Object.keys(t.inputs ?? {}).map(name => ({ name, required: true })),
    output_slots: Object.entries(t.outputs).map(([name, kind]) => ({ name, kind, required: true })),
    conditions: t.conditions.map((c: any) => ({ condition_id: c.id, description: c.text, required: true, method: c.method, slot: c.slot })),
  };
}

export function planTasks(plan: any): any[] {
  const out: any[] = [];
  const walk = (nodes: any[]) => { for (const n of nodes) { if (n.children) walk(n.children); else out.push(n); } };
  walk(plan.wbs);
  return out;
}

/** Task별 계약 원문(JSON). 계약 해시와 계약 전문 보기에 쓴다. */
export const contractTexts = (plan: any) => new Map(planTasks(plan).map(t => [t.id, JSON.stringify(contractOf(t))]));

export function planEvents(plan: any, sha: Sha) {
  const events: Event[] = [];
  const push = (type: string, subject: string, payload: any) => events.push({
    event_id: `plan-${events.length + 1}`, seq: events.length + 1, schema_version: 1, occurred_at: '', origin: 'plan',
    type, subject, actor: { kind: 'human', role: '승인자', instance: 'user' }, issuer: 'Planning', payload,
  });
  push('project.defined', plan.project.project_id, { ...plan.project, phases: plan.phases.map((p: any, i: number) => ({ phase_id: p.id, name: p.name, order: i + 1 })) });
  const walk = (nodes: any[], parent: string | null) => nodes.forEach((n, i) => {
    const task = !n.children;
    push('wbs_node.created', n.id, { node_id: n.id, parent_id: parent, kind: task ? 'task' : 'summary', name: n.name, order: i + 1, ...(task ? { phase_id: n.phase } : {}) });
    if (!task) walk(n.children, n.id);
  });
  walk(plan.wbs, null);
  const texts = contractTexts(plan);
  const tasks = planTasks(plan);
  for (const t of tasks) push('contract.confirmed', t.id, { ...contractOf(t), contract_ref: { kind: 'artifact', id: `sha256:${sha(texts.get(t.id)!)}`, version: 1 } });
  for (const t of tasks) for (const [slot, src] of Object.entries<string>(t.inputs ?? {})) {
    const [task_id, from] = src.split('.');
    push('dependency.linked', t.id, { from: { task_id, slot: from }, to: { task_id: t.id, slot } });
  }
  for (const ms of plan.milestones) push('milestone.defined', ms.id, {
    milestone_id: ms.id, name: ms.name,
    items: ms.items.map((it: string) => { const [task_id, slot] = it.split('.'); return slot ? { task_id, slot } : { task_id }; }),
  });
  const contractHash = (id: string) => texts.has(id) ? `sha256:${sha(texts.get(id)!)}` : undefined;
  return { events, contractHash };
}

// 사람 인수 기록 하나를 읽기 모델에 더한다. 인수 이벤트(E7)가 아니라 사용자가 대화에서 승인한 기록이다.
function acceptByHand(m: Model, a: any, contractHash: (id: string) => string | undefined) {
  const no = (msg: string) => { throw new Error(`인수 기록 ${a.task_id}: ${msg}`); };
  const c = m.contracts.get(a.task_id);
  if (!c) return no('계획에 없는 Task');
  if (m.taskAccepted.has(a.task_id)) no('이미 인수됐다');
  if (contractHash(a.task_id) !== a.contract) no('인수한 뒤에 계약이 바뀌었다. 승인은 승인한 버전에만 적용된다(9-4). 바꾸려면 새 Task를 만든다');
  const w = waitsOf(m, a.task_id)[0];
  if (w) no(`입력 슬롯이 인수되기 전이다(${w.resolve})`);
  for (const k of c.conditions) if (!a.evidence?.[k.condition_id]) no(`${k.condition_id}의 증거가 없다`);
  if (!a.approved_at || !a.channel) no('승인 시각과 채널이 없다');
  for (const k of c.conditions) m.condAccepted.add(`${a.task_id}/${k.condition_id}`);
  for (const s of c.output_slots) m.slotAccepted.add(`${a.task_id}/${s.name}`);
  m.taskAccepted.add(a.task_id);
}

export function acceptAll(m: Model, accepted: any[], contractHash: (id: string) => string | undefined) {
  for (const a of accepted) acceptByHand(m, a, contractHash);
}

export function foldPlan(plan: any, accepted: any[], sha: Sha) {
  const { events, contractHash } = planEvents(plan, sha);
  const known = new Set([...contractTexts(plan).values()].map(sha));
  const m = foldAll(events, r => known.has(r.id.slice(7)) ? undefined : '계약 원문 없음');
  acceptAll(m, accepted, contractHash);
  return { model: m, events, contractHash };
}
