// Catena CLI (core spec C-12). Product MVP 범위라 데이터 묶음을 읽는 질의만 한다.
// 값은 화면(prototype/app.js)과 같은 읽기 모델 함수(readmodel.ts)로만 계산한다.
// 사용: node tools/catena.ts <명령> [인자] [--bundle 폴더] [--at N] [--json]
//   status | ready | inbox | graph [요약 노드 ID] | show <Task> | agents <Task> | activity <Task> <노드>
// 종료 코드: 0 성공, 1 규칙 위반(묶음 검사 실패), 2 사용법 오류, 3 대상 없음
// --json: { schema_version, command, source: { origin, dataset_id, position, total }, data | error: { kind, message } }
import { join } from 'node:path';
import { foldBundle } from './fold.ts';
import * as RM from './readmodel.ts';

export const CLI_SCHEMA = 1;
const USAGE = 'node tools/catena.ts <status|ready|inbox|graph [노드]|show <Task>|agents <Task>|activity <Task> <노드>> [--bundle 폴더] [--at N] [--json]';
class CliError extends Error {
  kind: string; code: number;
  constructor(kind: string, code: number, msg: string) { super(msg); this.kind = kind; this.code = code; }
}
const notFound = (what: string) => { throw new CliError('대상 없음', 3, `${what}을(를) 찾을 수 없다`); };

const waitJson = (w: RM.Wait) => ({ type: w.type, issuer: w.issuer, resolve: w.resolve, action: w.action, raised_at: w.raised_at || null });
const ref = (r?: RM.Ref) => r?.id ?? null;

function cardOf(m: RM.Model, id: string) {
  const n = m.nodes.get(id);
  const c = RM.card(m, id);
  return { id, name: n.name, phase: m.project.phases.find((p: any) => p.phase_id === n.phase)?.name ?? null,
    rep: c.rep, stages: c.stages, exec: c.exec, acceptance: c.acceptance,
    conditions: { accepted: c.accepted, total: c.total, passed: c.passed }, waits: c.waits.map(waitJson), rework: RM.hasRework(m, id) };
}
const taskOf = (m: RM.Model, id?: string) => { const n = id && m.nodes.get(id); if (!n || n.kind !== 'task') notFound(`Task ${id}`); return n; };

// 명령 하나의 결과(JSON으로 그대로 내보낼 수 있는 값). 시험도 이 함수를 쓴다.
export function query(m: RM.Model, cmd: string, args: string[]): any {
  switch (cmd) {
    case 'status': {
      const ids = RM.tasksUnder(m);
      const a = RM.aggregate(m, ids);
      return { project: m.project.name, counts: Object.fromEntries(a.counts), conditions: { accepted: a.acc, total: a.tot },
        inbox: query(m, 'inbox', []), blocking: [...RM.blocking(m)].sort((x, y) => y[1] - x[1]).map(([task, blocks]) => ({ task, blocks })),
        tasks: ids.map(id => cardOf(m, id)) };
    }
    case 'ready':
      return { tasks: RM.tasksUnder(m).filter(id => RM.card(m, id).rep === '착수 가능').map(id => ({ id, name: m.nodes.get(id).name })) };
    case 'inbox':
      return RM.inbox(m).map(({ id, w }) => ({ task: id, name: m.nodes.get(id).name, ...waitJson(w) }));
    case 'graph': {
      const scope = args[0];
      if (scope && m.nodes.get(scope)?.kind !== 'summary') notFound(`요약 노드 ${scope}`);
      const { children, edges, external } = RM.edgesAt(m, scope);
      const tasks = RM.tasksUnder(m, scope);
      return { scope: scope ?? null, children: children.map(id => ({ id, kind: m.nodes.get(id).kind, name: m.nodes.get(id).name })),
        edges, external: Object.fromEntries(external), tasks, task_edges: RM.taskEdges(m, tasks) };
    }
    case 'show': {
      const id = args[0];
      const n = taskOf(m, id);
      const c = m.contracts.get(id);
      const wf = m.workflows.get(id);
      return { ...cardOf(m, id), lifecycle: n.lifecycle, path: RM.path(m, id).map(x => m.nodes.get(x).name), goal: c?.goal ?? null,
        condition_states: (c?.conditions ?? []).map((cd: any) => ({ condition_id: cd.condition_id, description: cd.description, slot: cd.slot ?? null, method: cd.method,
          state: RM.conditionState(m, id, cd.condition_id),
          evidence: [...m.evidence.values()].filter(e => e.task === id && e.condition_id === cd.condition_id).map(e => ({ evidence_id: e.evidence_id, result: e.result, submission_id: e.submission_id })) })),
        inputs: (c?.input_slots ?? []).map((s: any) => {
          const d = m.deps.find(x => x.to.task_id === id && x.to.slot === s.name);
          return { slot: s.name, from: !d ? null : d.from.external_ref ? { external: true } : { task: d.from.task_id, slot: d.from.slot, accepted: m.slotAccepted.has(`${d.from.task_id}/${d.from.slot}`) } };
        }),
        outputs: (c?.output_slots ?? []).map((s: any) => ({ slot: s.name, accepted: m.slotAccepted.has(`${id}/${s.name}`),
          consumers: m.deps.filter(x => x.from.task_id === id && x.from.slot === s.name).map(x => x.to.task_id) })),
        runs: RM.rework(m, id).map(r => ({ ...r, steps: m.nodeLog.filter(l => l.run === r.run_id).map(l => ({ node: l.node, name: wf.nodes.get(l.node).name,
          iteration: l.iteration, role: l.actor.role ?? null, instance: l.actor.instance, profile: l.profile ?? null, result: l.result ?? null })) })),
        submissions: [...m.submissions.values()].filter(s => s.task === id).map(s => ({ submission_id: s.submission_id, node: s.node_id, iteration: s.iteration,
          scope_check: s.scope_check, slots: s.slots.map((x: any) => x.output_slot), diff_ref: ref(s.diff_ref) })) };
    }
    case 'agents': {
      const id = args[0];
      taskOf(m, id);
      if (!m.workflows.has(id)) notFound(`${id}의 Workflow`);
      const g = RM.agentGraph(m, id);
      return { run: g.run ? { run_id: g.run.id, attempt: g.run.attempt, state: g.run.state, reason: g.run.reason ?? null } : null,
        nodes: g.nodes.map(({ node_id, name, stage, executor, role, status, runs, instances, profiles }) => ({ node_id, name, stage, executor, role: role ?? null, status, runs, instances, profiles })),
        edges: g.edges };
    }
    case 'activity': {
      const [id, nodeId] = args;
      taskOf(m, id);
      const wn = m.workflows.get(id)?.nodes.get(nodeId);
      if (!wn) notFound(`${id}의 노드 ${nodeId}`);
      const a = RM.nodeActivity(m, id, nodeId);
      return { run_id: a.run?.id ?? null, node: { node_id: wn.node_id, name: wn.name, stage: wn.stage, executor: wn.executor },
        steps: a.logs.map(l => ({ iteration: l.iteration, role: l.actor.role ?? null, instance: l.actor.instance, profile: l.profile ?? null, started: l.started, finished: l.finished ?? null, result: l.result ?? null })),
        activities: a.acts.map(x => ({ at: x.at, kind: x.kind, summary: x.summary, source: x.source, role: x.actor.role ?? null, instance: x.actor.instance, to_instance: x.to_instance ?? null, raw_ref: ref(x.raw_ref) })),
        submissions: a.subs.map(s => ({ submission_id: s.submission_id, at: s.at, diff_ref: ref(s.diff_ref) })),
        evidence: a.evs.map(e => ({ evidence_id: e.evidence_id, condition_id: e.condition_id, result: e.result, at: e.at, raw_log_ref: ref(e.raw_log_ref) })),
        approvals: a.approvals.map(x => ({ approval_id: x.approval_id, decision: x.decision ?? null, requested: x.requested })),
        cost_usd: a.cost };
    }
    default:
      throw new CliError('사용법 오류', 2, `알 수 없는 명령 ${cmd ?? '(없음)'}. ${USAGE}`);
  }
}

// ---- 사람이 읽는 글 ----
const prof = (p: any) => p ? ` [${p.runtime} · ${p.model}${p.effort ? ` · ${p.effort}` : ''}]` : '';
const waitLine = (w: any) => w ? `${w.type}: ${w.resolve} → ${w.action.actor}: ${w.action.text}` : '차단 없음';
const cardLine = (c: any) => `${c.id} ${c.name} — ${c.rep}${c.stages.length ? ` · ${c.stages.join(', ')}` : ''} · 완료 조건 ${c.conditions.accepted}/${c.conditions.total}${c.rework ? ' · 수정 반복 있음' : ''}\n    ${waitLine(c.waits[0])}`;

function text(cmd: string, d: any): string {
  switch (cmd) {
    case 'status':
      return [`${d.project} · 검증된 완료 조건 ${d.conditions.accepted} / ${d.conditions.total}`,
        `상태별: ${Object.entries(d.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
        `결정할 일 ${d.inbox.length}건${d.inbox.map((x: any) => `\n  ${x.task} ${x.name} — ${x.action.text} (${x.action.screen})`).join('')}`,
        `뒤를 막는 Task: ${d.blocking.map((b: any) => `${b.task}(후행 ${b.blocks})`).join(', ') || '없음'}`,
        ...d.tasks.map((c: any) => `  ${cardLine(c)}`)].join('\n');
    case 'ready': return d.tasks.length ? d.tasks.map((t: any) => `${t.id} ${t.name}`).join('\n') : '지금 착수할 수 있는 Task가 없다';
    case 'inbox': return d.length ? d.map((x: any) => `${x.task} ${x.name} — ${x.type}: ${x.action.text} (${x.action.screen})`).join('\n') : '결정할 일이 없다';
    case 'graph':
      return [`범위: ${d.scope ?? '최상위'} · 하위 ${d.children.length} · Task ${d.tasks.length}`,
        ...d.edges.map((e: any) => `  ${e.aggregated ? '[집계]' : '[원본]'} ${e.from} → ${e.to} 의존 ${e.count}(인수 ${e.accepted})`),
        'Task 단위 의존', ...d.task_edges.map((e: any) => `  ${e.from} → ${e.to} 슬롯 ${e.accepted}/${e.count} 인수`)].join('\n');
    case 'show':
      return [cardLine(d), `경로: ${d.path.join(' / ')}`, `목표: ${d.goal ?? '(계약 전)'}`, '완료 조건',
        ...d.condition_states.map((c: any) => `  ${c.condition_id} ${c.state} — ${c.description}${c.evidence.length ? ` (증거 ${c.evidence.map((e: any) => `${e.evidence_id} ${e.result}`).join(', ')})` : ''}`),
        '실행 기록',
        ...d.runs.map((r: any) => `  ${r.run_id} 시도 ${r.attempt} · ${r.state}${r.reason ? ` (${r.reason})` : ''} · Agent ${r.round}회차${r.round > 1 ? ` · 수정 ${r.round - 1}회` : ''}${r.failed.length ? ` · 통과 못 한 검사 ${r.failed.length}` : ''}`
          + r.steps.map((s: any) => `\n    ${s.name} ${s.iteration}회차 · ${s.role ?? ''} ${s.instance}${prof(s.profile)} · ${s.result ?? '진행 중'}`).join(''))].join('\n');
    case 'agents':
      return [d.run ? `${d.run.run_id} 시도 ${d.run.attempt} · ${d.run.state}` : 'Run 없음',
        ...d.nodes.map((n: any) => `  [${n.stage}] ${n.name} (${n.executor}${n.role ? ` · ${n.role}` : ''}) — ${n.status}${n.runs > 1 ? ` · ${n.runs}회` : ''}${n.instances.length ? ` · ${n.instances.join(', ')}` : ''}${n.profiles.map(prof).join('')}`),
        ...d.edges.filter((e: any) => e.kind === '반복').map((e: any) => `  반복 ${e.from} → ${e.to}: ${e.loops}회`)].join('\n');
    case 'activity':
      return [`${d.node.name} [${d.node.stage}] · ${d.run_id ?? 'Run 없음'}${d.cost_usd ? ` · 사용량 $${d.cost_usd.toFixed(2)} (추정값)` : ''}`,
        ...d.steps.map((s: any) => `  ${s.iteration}회차 시작 · ${s.role ?? ''} ${s.instance}${prof(s.profile)} · ${s.result ?? '진행 중'}`),
        ...d.activities.map((a: any) => `  ${a.at.slice(11, 16)} ${a.kind} · ${a.instance} · ${a.source}${a.source === '시스템 기록' ? '' : ' (증거 아님)'}: ${a.summary}`),
        ...d.evidence.map((e: any) => `  증거 ${e.evidence_id} ${e.condition_id} ${e.result} (시스템 기록)`)].join('\n');
  }
  return '';
}

function main(argv: string[]) {
  const opt = (name: string) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
  const json = argv.includes('--json');
  if (json) argv.splice(argv.indexOf('--json'), 1);
  const bundle = opt('--bundle') ?? join(import.meta.dirname, '..', 'scenarios', 'roombook');
  const atArg = opt('--at');
  const [cmd, ...args] = argv;
  let source: any = null;
  try {
    if (atArg !== undefined && !/^[1-9]\d*$/.test(atArg)) throw new CliError('사용법 오류', 2, `--at은 1 이상의 정수다: ${atArg}`);
    let r;
    try { r = foldBundle(bundle, atArg === undefined ? undefined : Number(atArg)); } catch (err) {
      if (err instanceof RM.RuleError) throw new CliError('규칙 위반', 1, `검사 실패 — 묶음을 불러오지 않음: ${err.message}`);
      if ((err as any).code === 'ENOENT') throw new CliError('대상 없음', 3, `데이터 묶음을 찾을 수 없다: ${bundle}`);
      throw err;
    }
    source = { origin: r.manifest.origin, dataset_id: r.manifest.dataset_id ?? null, position: Math.min(r.position, r.total), total: r.total };
    const data = query(r.model, cmd, args);
    if (json) console.log(JSON.stringify({ schema_version: CLI_SCHEMA, command: cmd, source, data }, null, 2));
    else console.log(`[${source.origin}] ${source.dataset_id} · 재생 위치 ${source.position} / ${source.total}\n${text(cmd, data)}`);
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    if (json) console.log(JSON.stringify({ schema_version: CLI_SCHEMA, command: cmd ?? null, source, error: { kind: err.kind, message: err.message } }, null, 2));
    else console.error(`${err.kind}: ${err.message}`);
    process.exitCode = err.code;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
