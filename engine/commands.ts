// 명령 계층(사용 형태와 실행 구조 절, 0-9, 0-10): 공식 상태를 바꾸는 모든 동작은 이름 있는 명령
// {command, principal, channel, args, expected_version?}이다. 명령은 권한(9-1)을 확인하고 트랜잭션 하나에서
// 상태 테이블과 이벤트를 쓴 뒤, 저장된 이벤트 전체를 읽기 모델로 접어 검사 규칙을 확인한다(규칙의 유일한 출처).
// 하나라도 어기면 아무것도 남기지 않고 이유(규칙 위반 / 권한 거부 / 버전 충돌 / 대상 없음)를 돌려준다.
import { createHash } from 'node:crypto';
import { foldAll, RuleError, type Event } from '../tools/readmodel.ts';
import { contractTexts, planEvents, planTasks } from '../tools/planfold.ts';
import type { Store } from './store.ts';

export type Principal = { kind: 'human' | 'agent' | 'system'; id: string };
export type Channel = 'cli-tty' | 'cli-batch' | 'web' | 'mcp' | 'runner';
export type Command = { command: string; principal: Principal; channel: Channel; args: any; expected_version?: number };
export type Reason = '규칙 위반' | '권한 거부' | '버전 충돌' | '대상 없음';
export type Outcome = { ok: true; events: Event[]; version: number } | { ok: false; reason: Reason; message: string; version: number };

class Refusal extends Error {
  reason: Reason;
  constructor(reason: Reason, message: string) {
    super(message);
    this.reason = reason;
  }
}

type Handler = {
  humanOnly: boolean;                      // 9-1: Agent는 질의와 요청만 한다
  prepare?: (s: Store, cmd: Command) => any; // 트랜잭션 전에 할 일(산출물 파일 쓰기, 14-3 쓰기 순서)
  run: (s: Store, cmd: Command, prepared: any, emit: (d: Omit<Event, 'seq' | 'event_id' | 'schema_version' | 'origin' | 'dataset_id' | 'occurred_at' | 'actor'>) => void) => void;
};

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

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
  }
}

const HANDLERS: Record<string, Handler> = {
  // 계획 불러오기(1-1, C-12): 계획 파일을 계획 이벤트로 바꿔 넣는다. 사람 인수 기록은 이벤트가 아니므로 넣지 않는다(0-11).
  'plan.import': {
    humanOnly: true,
    prepare: (s, cmd) => {
      checkPlanShape(cmd.args?.plan);
      for (const text of contractTexts(cmd.args.plan).values()) s.putArtifact(text);
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
  if (h.humanOnly && cmd.principal.kind !== 'human') return failed('권한 거부', `${cmd.command}는 사람만 한다(9-1)`);
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
