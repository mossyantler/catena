// 명령 계층(사용 형태와 실행 구조 절, 0-9, 0-10): 공식 상태를 바꾸는 모든 동작은 이름 있는 명령
// {command, principal, channel, args, expected_version?}이다. 명령은 권한(9-1)을 확인하고 트랜잭션 하나에서
// 상태 테이블과 이벤트를 쓴 뒤, 저장된 이벤트 전체를 읽기 모델로 접어 검사 규칙을 확인한다(규칙의 유일한 출처).
// 하나라도 어기면 아무것도 남기지 않고 이유(규칙 위반 / 권한 거부 / 버전 충돌 / 대상 없음)를 돌려준다.
import { createHash } from 'node:crypto';
import { foldAll, RuleError, type Event, type Model, type Ref } from '../tools/readmodel.ts';
import { contractTexts, planEvents, planTasks, verifierTexts } from '../tools/planfold.ts';
import type { Store } from './store.ts';

export type Principal = { kind: 'human' | 'agent' | 'system'; id: string };
export type Channel = 'cli-tty' | 'cli-batch' | 'web' | 'mcp' | 'runner';
export type Command = { command: string; principal: Principal; channel: Channel; args: any; expected_version?: number };
export type Reason = '규칙 위반' | '권한 거부' | '버전 충돌' | '대상 없음';
export type Outcome = { ok: true; events: Event[]; version: number } | { ok: false; reason: Reason; message: string; version: number };

export class Refusal extends Error {
  reason: Reason;
  constructor(reason: Reason, message: string) {
    super(message);
    this.reason = reason;
  }
}

export type Handler = {
  principals: Principal['kind'][];         // 이 명령을 낼 수 있는 주체(9-1: Agent는 질의와 요청만 한다)
  prepare?: (s: Store, cmd: Command) => any; // 트랜잭션 전에 할 일(산출물 파일 쓰기, 14-3 쓰기 순서)
  run: (s: Store, cmd: Command, prepared: any, emit: (d: Omit<Event, 'seq' | 'event_id' | 'schema_version' | 'origin' | 'dataset_id' | 'occurred_at' | 'actor'>) => void) => void;
};

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

// Engine MVP의 내장 Workflow Template(3-2, v0.10.2): 구현 → 자동 검사 → 실패 시 수정(상한 N회) → 사람 인수 승인.
// 인수 승인(human 노드)은 계약에 human 조건이 있을 때만 둔다. 조건이 모두 auto면 통과 증거로 인수한다(7-4).
// 정의는 내용 해시 산출물로 두고 workflow_ref로 가리킨다(3-5: 공개된 정의는 바꾸지 않고 새 버전을 만든다).
const WORK = { node_id: 'work', name: '작성·구현', stage: '구현', executor: 'agent', role: 'Worker' };
const CHECK = { node_id: 'check', name: '자동 검사', stage: '검증', executor: 'code' };
const APPROVE = { node_id: 'approve', name: '검수 승인', stage: '승인', executor: 'human', role: '승인자' };
const LOOP = [{ from: 'work', to: 'check', kind: '순차' }, { from: 'check', to: 'work', kind: '반복' }];
export const TEMPLATES = {
  approve: { template_id: 'impl-check-fix-approve', version: 1, repair_limit: 3, nodes: [WORK, CHECK, APPROVE], edges: [...LOOP, { from: 'check', to: 'approve', kind: '순차' }] },
  auto: { template_id: 'impl-check-fix', version: 1, repair_limit: 3, nodes: [WORK, CHECK], edges: LOOP },
};
const OPEN_RUN = ['대기', '실행 중', '일시 중단', '결과 불명'];

// 입력 슬롯을 공급한 제출 commit(Baseline의 base_ref 후보, D). Engine MVP는 공급 commit이 하나일 때만 쓴다.
function suppliedCommits(s: Store, m: Model, taskId: string) {
  const bindings: { input_slot: string; from: string; submission_id: string | null }[] = [];
  const commits = new Set<string>();
  for (const d of m.deps.filter((x: any) => x.to.task_id === taskId && !x.from.external_ref)) {
    const acc = [...m.acceptances].reverse().find((a: any) => a.task_id === d.from.task_id && (a.scope === 'task' || a.slot === d.from.slot));
    bindings.push({ input_slot: d.to.slot, from: `${d.from.task_id}.${d.from.slot}`, submission_id: acc?.submission_id ?? null });
    const row = acc && (s.db.prepare('SELECT payload FROM submissions WHERE submission_id = ?').get(acc.submission_id) as { payload: string } | undefined);
    const commit = row && JSON.parse(row.payload).commit;
    if (commit) commits.add(commit);
  }
  return { bindings, commits: [...commits] };
}

// 계획 파일의 모양만 확인한다. 의존·순환·슬롯 같은 공정 규칙은 읽기 모델이 확인한다(E2~E4, E11).
function checkPlanShape(plan: any) {
  const no = (msg: string) => { throw new Refusal('규칙 위반', `계획 파일 형식: ${msg}`); };
  if (!plan || typeof plan !== 'object') no('JSON 객체가 아니다');
  if (typeof plan.project?.project_id !== 'string' || typeof plan.project?.name !== 'string') no('project.project_id와 project.name이 필요하다');
  for (const k of ['phases', 'wbs', 'milestones']) if (!Array.isArray(plan[k])) no(`${k}는 배열이어야 한다`);
  for (const t of planTasks(plan)) {
    if (typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.goal !== 'string') no(`Task에 id·name·goal이 필요하다 (${t.id ?? '?'})`);
    if (!t.outputs || typeof t.outputs !== 'object' || !Array.isArray(t.conditions)) no(`${t.id}: outputs 객체와 conditions 배열이 필요하다`);
    for (const src of Object.values<any>(t.inputs ?? {})) if (typeof src !== 'string' || !/^[^.]+\.[^.]+$/.test(src)) no(`${t.id}: 입력 공급은 "Task.슬롯" 형식이다 (${src})`);
    if (t.write_scope !== undefined && (!Array.isArray(t.write_scope) || !t.write_scope.length || !t.write_scope.every((p: any) => typeof p === 'string' && p)))
      no(`${t.id}: write_scope는 경로 패턴(glob) 문자열의 배열이다`);
    for (const c of t.conditions) if (c.verify !== undefined) {
      const v = c.verify;
      if (c.method !== 'auto') no(`${c.id}: 검사 방법(verify)은 auto 조건에만 적는다`);
      if (!v || typeof v.command !== 'string' || !v.command.trim() || (v.files !== undefined && (!Array.isArray(v.files) || !v.files.every((f: any) => typeof f === 'string' && f))))
        no(`${c.id}: verify는 {command: 실행할 명령, files?: 보호할 검사 파일 경로[]}이다`);
    }
  }
}

/** 명령 이름 → 처리기. 감독(supervise.ts)처럼 다른 모듈도 여기에 명령을 더한다. */
export const HANDLERS: Record<string, Handler> = {
  // 착수 요청(6-1, v0.10): 착수 가능 판정(1-4)과 요청 주체 확인 → Baseline → Run(대기) → 예약과 Ticket을 트랜잭션 하나로.
  // 입력 슬롯이 인수되기 전이면 run.created가 E6으로 거부되어 아무것도 남지 않는다. Agent를 띄우는 일은 감독(T17, T19)이 한다.
  'run.start': {
    principals: ['human'], // Engine MVP의 착수는 사용자가 요청한다(5-4)
    prepare: s => ({ approve: s.putArtifact(JSON.stringify(TEMPLATES.approve)), auto: s.putArtifact(JSON.stringify(TEMPLATES.auto)) }),
    run: (s, cmd, refs: Record<'approve' | 'auto', Ref>, emit) => {
      const a = cmd.args ?? {};
      const m = foldAll(s.events(), s.refCheck);
      const n = m.nodes.get(a.task_id);
      if (!n || n.kind !== 'task') throw new Refusal('대상 없음', `Task ${a.task_id}을(를) 찾을 수 없다`);
      const contract = m.contracts.get(a.task_id);
      if (!contract) throw new Refusal('규칙 위반', `E2: 계약이 확정되지 않은 Task ${a.task_id}`);
      if ([...m.runs.values()].some((r: any) => r.task === a.task_id && OPEN_RUN.includes(r.state))) throw new Refusal('규칙 위반', `${a.task_id}에 끝나지 않은 Run이 있다. Task마다 끝나지 않은 Run은 하나뿐이다(6-1)`);
      const kind = contract.conditions.some((c: any) => c.method !== 'auto') ? 'approve' : 'auto';
      const templateRef = refs[kind];
      if (!m.workflows.has(a.task_id)) emit({ type: 'workflow.bound', subject: a.task_id, issuer: 'Graph Design', payload: { task_id: a.task_id, workflow_ref: templateRef, nodes: TEMPLATES[kind].nodes, edges: TEMPLATES[kind].edges } });

      const attempt = [...m.runs.values()].filter((r: any) => r.task === a.task_id).length + 1;
      const run_id = `${a.task_id}-r${attempt}`;
      const { bindings, commits } = suppliedCommits(s, m, a.task_id);
      if (commits.length > 1) throw new Refusal('규칙 위반', `입력 공급 commit이 둘 이상이다(병합은 확장, 3-4): ${commits.join(', ')}`);
      const base_ref = commits[0] ?? a.base_ref;
      if (typeof base_ref !== 'string' || !base_ref) throw new Refusal('규칙 위반', 'base_ref가 없다: 입력이 없는 Task는 프로젝트 기준 commit을 넘긴다(1-1)');
      const now = new Date();
      const baseline = {
        baseline_id: `${run_id}-b`, plan_version: versionOf(s), contract_ref: contract.contract_ref, workflow_ref: m.workflows.get(a.task_id)?.workflow_ref ?? templateRef,
        base_ref, runner_ref: a.runner_ref ?? null, input_bindings: bindings, memory_refs: [], created_at: now.toISOString(), created_by: cmd.principal,
      };
      const ticket = {
        ticket_id: `${run_id}-t`, run_id, baseline_id: baseline.baseline_id, principal: cmd.principal,
        allowed: { write_scope: contract.write_scope ?? null, permission_mode: a.permission_mode ?? null },
        policy_decision: { principal: cmd.principal, channel: cmd.channel, result: '허가' }, approvals: [],
        profile: { runner_ref: a.runner_ref ?? null, model: a.model ?? null, effort: a.effort ?? null },
        reservation: { budget_usd: a.budget_usd ?? null, slots: 1, write_lock: contract.write_scope ?? null },
        expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(), status: '유효',
      };
      s.db.prepare('INSERT INTO baselines VALUES (?, ?)').run(baseline.baseline_id, JSON.stringify(baseline));
      try {
        s.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?)').run(run_id, a.task_id, attempt, '대기', JSON.stringify({ baseline_id: baseline.baseline_id, ticket_id: ticket.ticket_id }));
      } catch (err) {
        if (/UNIQUE/i.test((err as Error).message)) throw new Refusal('규칙 위반', `${a.task_id}에 끝나지 않은 Run이 있다. Task마다 끝나지 않은 Run은 하나뿐이다(6-1)`);
        throw err;
      }
      s.db.prepare('INSERT INTO tickets VALUES (?, ?, ?, ?)').run(ticket.ticket_id, run_id, ticket.status, JSON.stringify(ticket));
      emit({ type: 'run.created', subject: a.task_id, issuer: 'Execution', payload: { run_id, task_id: a.task_id, attempt, runner_ref: a.runner_ref ?? undefined, requested_by: { principal: cmd.principal, channel: cmd.channel } } });
    },
  },
  // 계획 불러오기(1-1, C-12): 계획 파일을 계획 이벤트로 바꿔 넣는다. 사람 인수 기록은 이벤트가 아니므로 넣지 않는다(0-11).
  'plan.import': {
    principals: ['human'],
    prepare: (s, cmd) => {
      checkPlanShape(cmd.args?.plan);
      for (const text of [...contractTexts(cmd.args.plan).values(), ...verifierTexts(cmd.args.plan)]) s.putArtifact(text);
    },
    run: (s, cmd, _p, emit) => {
      const plan = cmd.args.plan;
      const { events } = planEvents(plan, sha);
      const put = (sql: string, ...v: (string | number | null)[]) => s.db.prepare(sql).run(...v);
      for (const e of events) {
        const p = e.payload;
        switch (e.type) {
          case 'project.defined': put('INSERT INTO projects VALUES (?, ?)', p.project_id, JSON.stringify(p)); break;
          case 'wbs_node.created': put('INSERT INTO wbs_nodes VALUES (?, ?, ?, ?, ?)', p.node_id, p.parent_id, p.kind, '활성', JSON.stringify(p)); break;
          case 'contract.confirmed': put('INSERT INTO contracts VALUES (?, 1, ?)', p.task_id, JSON.stringify(p)); break;
          case 'dependency.linked': put('INSERT INTO dependencies VALUES (?, ?, ?, ?, ?)', p.to.task_id, p.to.slot, p.from.task_id, p.from.slot, JSON.stringify(p)); break;
          case 'milestone.defined': put('INSERT INTO milestones VALUES (?, ?)', p.milestone_id, JSON.stringify(p)); break;
        }
        emit({ type: e.type, subject: e.subject, issuer: 'Planning', payload: p });
      }
    },
  },
};

/** 지금 저장소의 버전: 마지막 이벤트의 seq. expected_version은 이 값과 비교한다. */
export const versionOf = (s: Store) => (s.db.prepare('SELECT COALESCE(MAX(seq), 0) AS v FROM events').get() as { v: number }).v;

export function execute(s: Store, cmd: Command): Outcome {
  const failed = (reason: Reason, message: string): Outcome => ({ ok: false, reason, message, version: versionOf(s) });
  const h = HANDLERS[cmd.command];
  if (!h) return failed('대상 없음', `없는 명령 ${cmd.command}`);
  if (!h.principals.includes(cmd.principal.kind)) return failed('권한 거부', `${cmd.command}는 ${h.principals.join('·')}만 한다(9-1)`);
  try {
    const prepared = h.prepare?.(s, cmd);
    return s.tx(() => {
      const before = versionOf(s);
      if (cmd.expected_version !== undefined && cmd.expected_version !== before) throw new Refusal('버전 충돌', `기대한 버전 ${cmd.expected_version}, 지금 ${before}`);
      const at = new Date().toISOString();
      const actor = { kind: cmd.principal.kind, instance: cmd.principal.id };
      const events: Event[] = [];
      h.run(s, cmd, prepared, d => events.push(s.append({ ...d, occurred_at: at, actor })));
      foldAll(s.events(), s.refCheck); // 규칙을 어기면 RuleError로 트랜잭션 전체가 되돌려진다
      const version = versionOf(s);
      s.db.prepare('INSERT INTO commands VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        before + 1, version, cmd.command, JSON.stringify(cmd.principal), cmd.channel, sha(JSON.stringify(cmd.args ?? null)), at);
      return { ok: true as const, events, version };
    });
  } catch (err) {
    if (err instanceof Refusal) return failed(err.reason, err.message);
    if (err instanceof RuleError) return failed('규칙 위반', err.message);
    if ((err as any)?.code === 'ERR_SQLITE_ERROR' && /constraint/i.test((err as Error).message)) return failed('규칙 위반', `저장소 제약: ${(err as Error).message}`);
    throw err;
  }
}
