// 시뮬레이션 시나리오 생성기가 함께 쓰는 도구(roombook.build.ts, expense.build.ts).
// 결정적이다: event_id는 sha256(dataset:seq)에서, 원문 해시는 내용에서 나온다. Date.now()와 난수를 쓰지 않는다.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const uuid = (s: string) => { const h = sha(s); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };

// ---- 등장 주체 ----
export const USER = { kind: 'human', role: '승인자', instance: 'user:owner' };
export const CATENA = { kind: 'system', instance: 'catena' };
export const MGR = { kind: 'agent', role: 'Manager', instance: 'manager-1' };
export const W = (n: number) => ({ kind: 'agent', role: 'Worker', instance: `worker-${n}` });
export const RV = { kind: 'agent', role: 'Reviewer', instance: 'reviewer-1' };
export const TEST = { kind: 'code', role: '검사', instance: 'test-runner' };

// Agent 노드를 어느 Runtime·모델로 실행했는지(node.started.profile, v0.9). 여러 Runtime이 섞이는 것은 확장 단계를 가정한 값이다.
const PROFILE: Record<string, any> = {
  'manager-1': { runtime: 'claude-code', model: 'claude-opus-5-5', effort: 'high' },
  'reviewer-1': { runtime: 'claude-code', model: 'claude-opus-5-5', effort: 'high' },
  'worker-2': { runtime: 'codex', model: 'gpt-5-codex', effort: 'medium' },
};
const profileOf = (actor: any) => actor.kind !== 'agent' ? {} : { profile: PROFILE[actor.instance] ?? { runtime: 'claude-code', model: 'claude-sonnet-5-5', effort: 'medium' } };

export const diff = (file: string, lines: string[]) => `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}\n`;
export const log = (cmd: string, body: string[]) => `$ ${cmd}\n${body.join('\n')}\n`;
export const transcript = (turns: [string, string][]) => turns.map(([role, text]) => JSON.stringify({ role, text })).join('\n') + '\n';

/** 묶음 하나를 만드는 도구. day0은 0일차 날짜(YYYY-MM-DD, KST)다. */
export function scenario(DATASET: string, day0: string) {
  const events: any[] = [];
  const files = new Map<string, string>();
  const art = (content: string) => { const h = sha(content); files.set(h, content); return { kind: 'artifact', id: `sha256:${h}`, version: 1 }; };

  let clock = 0;
  const at = (day: number, hm: string) => { clock = Date.parse(`${day0}T${hm}:00+09:00`) + day * 86400e3; };
  const iso = () => new Date(clock + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00';

  function ev(type: string, subject: string, actor: any, issuer: string, payload: any) {
    const seq = events.length + 1;
    events.push({ event_id: uuid(`${DATASET}:${seq}`), seq, schema_version: 1, occurred_at: iso(), origin: 'simulated',
      dataset_id: DATASET, type, subject, actor, issuer, payload });
  }

  // ---- 계획 ----
  const node = (id: string, parent: string | null, kind: string, name: string, order: number, phase?: string) =>
    ev('wbs_node.created', id, USER, 'Planning', { node_id: id, parent_id: parent, kind, name, order, ...(phase ? { phase_id: phase } : {}) });

  function contract(task: string, goal: string, outOfScope: string, writeScope: string[], inputs: string[],
    outputs: [string, string][], conds: [string, string, string, string?][]) {
    const payload = {
      task_id: task, goal,
      input_slots: inputs.map(name => ({ name, required: true })),
      output_slots: outputs.map(([name, kind]) => ({ name, kind, required: true })),
      conditions: conds.map(([condition_id, description, method, slot]) => ({ condition_id, description, required: true, method, ...(slot ? { slot } : {}) })),
    };
    const full = { ...payload, version: 1, out_of_scope: outOfScope, write_scope: writeScope, status: '확정' };
    ev('contract.confirmed', task, USER, 'Planning', { ...payload, contract_ref: art(JSON.stringify(full, null, 2) + '\n') });
  }

  const link = (from: string, fromSlot: string, to: string, toSlot: string) =>
    ev('dependency.linked', to, USER, 'Planning', { from: { task_id: from, slot: fromSlot }, to: { task_id: to, slot: toSlot } });

  const simpleFlow = (task: string) => ev('workflow.bound', task, CATENA, 'Graph Design', {
    task_id: task,
    nodes: [
      { node_id: 'work', name: '작성·구현', stage: '구현', executor: 'agent', role: 'Worker' },
      { node_id: 'check', name: '자동 검사', stage: '검증', executor: 'code' },
      { node_id: 'approve', name: '인수 승인', stage: '승인', executor: 'human', role: '승인자' },
    ],
    edges: [{ from: 'work', to: 'check', kind: '순차' }, { from: 'check', to: 'work', kind: '반복' }, { from: 'check', to: 'approve', kind: '순차' }],
  });

  // ---- 실행 ----
  const runStart = (task: string, run: string) => {
    ev('run.created', run, CATENA, 'Execution', { run_id: run, task_id: task, attempt: 1 });
    ev('run.state_changed', run, CATENA, 'Execution', { run_id: run, to: '실행 중' });
  };
  const runEnd = (run: string, to: string, reason?: string) => ev('run.state_changed', run, CATENA, 'Execution', { run_id: run, to, ...(reason ? { reason } : {}) });
  const start = (run: string, n: string, i: number, actor: any) => ev('node.started', run, actor, 'Execution', { run_id: run, node_id: n, iteration: i, ...profileOf(actor) });
  const finish = (run: string, n: string, i: number, actor: any, result = '성공') => ev('node.finished', run, actor, 'Execution', { run_id: run, node_id: n, iteration: i, result });
  const act = (run: string, n: string, i: number, actor: any, kind: string, summary: string, source: string, extra: any = {}) =>
    ev('agent.activity', run, actor, 'Execution', { run_id: run, node_id: n, iteration: i, kind, summary, source, ...extra });
  const submit = (run: string, n: string, sub: string, slots: any[], diffText: string) =>
    ev('submission.created', sub, CATENA, 'Execution', { submission_id: sub, run_id: run, node_id: n, slots, scope_check: '통과', diff_ref: art(diffText) });
  const usage = (run: string, n: string, cost: number) => ev('usage.recorded', run, CATENA, 'Resource', { run_id: run, node_id: n, cost_usd: cost, reliability: '추정값' });
  const evidence = (sub: string, id: string, cond: string, result: string, logText: string) =>
    ev('evidence.recorded', sub, TEST, 'Validation & Acceptance', { evidence_id: id, condition_id: cond, submission_id: sub, result, raw_log_ref: art(logText) });
  const request = (sub: string, id: string, conds: string[]) =>
    ev('approval.requested', sub, CATENA, 'Policy', { approval_id: id, kind: '품질', submission_id: sub, condition_ids: conds });
  const decide = (id: string, comment: string) => ev('approval.decided', id, USER, 'Policy', { approval_id: id, decision: '승인', comment });
  const accept = (id: string, task: string, slot: string | null, sub: string, conds: string[], evids: string[], approval: string) =>
    ev('acceptance.recorded', task, CATENA, 'Validation & Acceptance', { acceptance_id: id, scope: slot ? 'slot' : 'task', task_id: task,
      ...(slot ? { slot } : {}), submission_id: sub, condition_ids: conds, evidence_ids: evids, approval_id: approval });

  /** 묶음 폴더를 지우고 새로 쓴다. 기본 재생 위치는 마지막 이벤트다. */
  function write(out: string, description: string) {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'artifacts', 'sha256'), { recursive: true });
    for (const [h, body] of files) writeFileSync(join(out, 'artifacts', 'sha256', h), body);
    writeFileSync(join(out, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(join(out, 'dataset.json'), JSON.stringify({
      dataset_id: DATASET, origin: 'simulated', schema_version: 1, description, source: null, default_position: events.length,
    }, null, 2) + '\n');
    console.log(`이벤트 ${events.length}개, 원문 파일 ${files.size}개 → ${out}`);
  }

  return { ev, art, at, node, contract, link, simpleFlow, runStart, runEnd, start, finish, act, submit, usage, evidence, request, decide, accept, write };
}
