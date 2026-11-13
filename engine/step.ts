// Agent 노드 하나 실행(Orchestrator의 한 단계, 6-3, 6-7, 6-10, A-2, A-5): 감독 임대를 가진 프로세스가
// Run 전용 git worktree를 만들고, Claude Code Runner로 Agent를 띄워 출력을 이벤트로 기록하고, 끝나면 노드를 닫는다.
// 다른 인터페이스에서 취소하면(run.cancel) 감독 프로세스가 다음 확인 때 프로세스 그룹을 끝내고 Run을 취소로 닫는다.
// 공식 기록은 모두 명령 계층을 거친다(0-9). Agent의 행위는 막지 않는다(0-5).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { foldAll } from '../tools/readmodel.ts';
import { execute, HANDLERS, Refusal } from './commands.ts';
import { holds, realProcs, recordProcess, renewLease, type Holder } from './supervise.ts';
import { lines, normalize, prepare, start, stop, type Draft } from './runner.ts';
import { submit, type Submitted } from './submit.ts';
import type { Store } from './store.ts';

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };
const runRow = (s: Store, run_id: string) => s.db.prepare('SELECT task_id, state, payload FROM runs WHERE run_id = ?').get(run_id) as { task_id: string; state: string; payload: string } | undefined;
const setRun = (s: Store, run_id: string, patch: object, state?: string) => {
  const r = runRow(s, run_id)!;
  s.db.prepare('UPDATE runs SET state = ?, payload = ? WHERE run_id = ?').run(state ?? r.state, JSON.stringify({ ...JSON.parse(r.payload), ...patch }), run_id);
};
const mustHold = (s: Store, run_id: string, holder: Holder) => { if (!holds(s, run_id, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`); };

// Project 설정: 지켜보는 사람이 없는 실행의 권한 모드(R-3 7, 0-5)와 Project의 git 저장소(1-1)
HANDLERS['project.configure'] = {
  principals: ['human'],
  run: (s, cmd) => {
    const row = s.db.prepare('SELECT project_id, payload FROM projects').get() as { project_id: string; payload: string } | undefined;
    if (!row) throw new Refusal('대상 없음', '계획을 먼저 불러온다(plan import)');
    const { permission_mode, repo } = cmd.args ?? {};
    if (permission_mode !== undefined && (typeof permission_mode !== 'string' || !permission_mode)) throw new Refusal('규칙 위반', '권한 모드는 Claude Code가 받는 모드 이름이다');
    const p = JSON.parse(row.payload);
    const settings = { ...p.settings, ...(permission_mode ? { permission_mode } : {}), ...(repo ? { repo } : {}) };
    s.db.prepare('UPDATE projects SET payload = ? WHERE project_id = ?').run(JSON.stringify({ ...p, settings }), row.project_id);
  },
};
export const projectSettings = (s: Store): { permission_mode?: string; repo?: string } =>
  JSON.parse((s.db.prepare('SELECT payload FROM projects').get() as { payload: string } | undefined)?.payload ?? '{}').settings ?? {};

// 취소 요청(Engine 명령 cancel): 대기 중이면 바로 취소, 실행 중이면 감독 프로세스에 알린다
HANDLERS['run.cancel'] = {
  principals: ['human'],
  run: (s, cmd, _p, emit) => {
    const { run_id } = cmd.args ?? {};
    const r = runRow(s, run_id);
    if (!r) throw new Refusal('대상 없음', `Run ${run_id}을(를) 찾을 수 없다`);
    if (r.state === '대기') {
      s.db.prepare("UPDATE tickets SET status = '취소' WHERE run_id = ?").run(run_id);
      setRun(s, run_id, { cancelled_by: cmd.principal }, '취소');
      emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '취소', reason: '사용자 취소' } });
    } else if (r.state === '실행 중') setRun(s, run_id, { cancel_requested: { by: cmd.principal, channel: cmd.channel } });
    else throw new Refusal('규칙 위반', `끝난 Run은 취소할 수 없다(${r.state})`);
  },
};

HANDLERS['node.start'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, node_id, iteration, holder, profile } = cmd.args;
    mustHold(s, run_id, holder);
    emit({ type: 'node.started', subject: run_id, issuer: 'Execution', payload: { run_id, node_id, iteration, profile } });
  },
};

// Runner가 바꾼 활동 초안을 한 번에 기록한다(줄마다 명령을 내면 접기가 늘어나므로 묶는다)
HANDLERS['node.events'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, node_id, iteration, holder, activities } = cmd.args;
    mustHold(s, run_id, holder);
    for (const a of activities) emit({ type: 'agent.activity', subject: run_id, issuer: 'Execution', payload: { run_id, node_id, iteration, ...a } });
  },
};

HANDLERS['node.finish'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, node_id, iteration, holder, result, usage, transcript } = cmd.args;
    mustHold(s, run_id, holder);
    if (transcript) emit({ type: 'agent.activity', subject: run_id, issuer: 'Execution', payload: { run_id, node_id, iteration, kind: '메시지', summary: 'Runtime 출력 원문(transcript)', source: '시스템 기록', raw_ref: transcript } });
    if (usage) emit({ type: 'usage.recorded', subject: run_id, issuer: 'Resource', payload: { run_id, node_id, cost_usd: usage.cost_usd, tokens: usage.tokens, reliability: '추정값' } });
    emit({ type: 'node.finished', subject: run_id, issuer: 'Execution', payload: { run_id, node_id, iteration, result } });
  },
};

// 감독 프로세스가 취소 요청을 처리한 뒤 Run을 닫는다(노드는 이미 중단으로 닫혀 있어야 한다, E5)
HANDLERS['run.cancelled'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder } = cmd.args;
    mustHold(s, run_id, holder);
    s.db.prepare("UPDATE tickets SET status = '취소' WHERE run_id = ?").run(run_id);
    setRun(s, run_id, {}, '취소');
    s.db.prepare('DELETE FROM run_leases WHERE run_id = ?').run(run_id);
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '취소', reason: '사용자 취소' } });
  },
};

// Run을 실패로 닫는다(6-5, 6-8 ③). 노드는 모두 닫혀 있어야 한다(E5). 예약은 기록된 사용량으로 정산하고,
// 사용자가 다음 진행을 정하도록 decision 대기 사유를 낸다
HANDLERS['run.fail'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder, reason, action } = cmd.args;
    mustHold(s, run_id, holder);
    const r = runRow(s, run_id)!;
    const t = s.db.prepare('SELECT ticket_id, payload FROM tickets WHERE run_id = ?').get(run_id) as { ticket_id: string; payload: string };
    const used = s.events().filter(e => e.type === 'usage.recorded' && e.payload.run_id === run_id).reduce((n, e) => n + e.payload.cost_usd, 0);
    const ticket = { ...JSON.parse(t.payload), status: '정산 완료', settlement: { charged_usd: used, reliability: '추정값', reason } };
    s.db.prepare("UPDATE tickets SET status = '정산 완료', payload = ? WHERE ticket_id = ?").run(JSON.stringify(ticket), t.ticket_id);
    setRun(s, run_id, { failure: reason }, '실패');
    s.db.prepare('DELETE FROM run_leases WHERE run_id = ?').run(run_id);
    emit({ type: 'run.state_changed', subject: run_id, issuer: 'Execution', payload: { run_id, to: '실패', reason } });
    emit({ type: 'wait.raised', subject: r.task_id, issuer: 'Execution', payload: { wait_id: `W-${run_id}-decision`, wait_type: 'decision', target_id: r.task_id,
      resolve_condition: '사용자가 다음 진행을 정함', action: { actor: '사용자', text: action, screen: 'Task 상세' } } });
  },
};

const ok = (r: ReturnType<typeof execute>, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason} ${r.message}`); return r; };

// 계약과 입력을 Agent에게 넘길 지시문(8-4). 계약은 지시이고, 입력 산출물은 자료다(8-8)
function promptOf(contract: any): string {
  return [
    '다음 계약의 Task를 이 작업 디렉터리(git worktree)에서 수행한다. 끝나면 무엇을 바꿨는지 짧게 보고한다.',
    `목표: ${contract.goal}`,
    `출력 슬롯: ${contract.output_slots.map((o: any) => `${o.name}(${o.kind})`).join(', ')}`,
    '완료 조건(검사는 Catena가 따로 한다. 통과했다고 보고해도 증거가 되지 않는다):',
    ...contract.conditions.map((c: any) => `- ${c.condition_id}: ${c.description}`),
    ...(contract.write_scope ? [`쓰기 범위: ${contract.write_scope.join(', ')}. 이 밖의 파일을 바꾸면 제출 기록이 거부된다.`] : []),
  ].join('\n');
}

export type StepResult = { result: '성공' | '실패' | '중단'; exit: number | null; cancelled: boolean; submission?: Submitted };

/** Agent 노드 하나를 실행한다. 감독 임대를 가진 프로세스(holder)만 부른다. */
export async function runAgentNode(s: Store, o: {
  run_id: string; node_id: string; iteration: number; holder: Holder;
  command?: string[]; maxTurns?: number; ttlMs?: number; tickMs?: number;
}): Promise<StepResult> {
  const run = runRow(s, o.run_id);
  if (!run || run.state !== '실행 중') throw new Error(`실행 중인 Run이 아니다 ${o.run_id}`);
  if (!holds(s, o.run_id, o.holder)) throw new Error(`감독 임대를 갖지 않았다 ${o.run_id}`);
  const settings = projectSettings(s);
  if (!settings.permission_mode) throw new Error('Project 설정에 권한 모드가 없다. project.configure로 정한다(R-3 7)');
  if (!settings.repo) throw new Error('Project 설정에 git 저장소가 없다. project.configure로 정한다(1-1)');
  const payload = JSON.parse(run.payload);
  const ticket = JSON.parse((s.db.prepare('SELECT payload FROM tickets WHERE run_id = ?').get(o.run_id) as { payload: string }).payload);
  const baseline = JSON.parse((s.db.prepare('SELECT payload FROM baselines WHERE baseline_id = ?').get(payload.baseline_id) as { payload: string }).payload);
  const contract = foldAll(s.events(), s.refCheck).contracts.get(run.task_id);

  // Run마다 새 worktree와 TMPDIR(A-5). 이전 Run의 worktree는 다시 쓰지 않는다
  const worktree = payload.worktree ?? join(s.dir, 'worktrees', o.run_id);
  const tmpDir = join(s.dir, 'tmp', o.run_id);
  if (!existsSync(worktree)) execFileSync('git', ['-C', settings.repo, 'worktree', 'add', '--detach', worktree, baseline.base_ref], { stdio: 'pipe' });
  mkdirSync(tmpDir, { recursive: true });
  s.tx(() => setRun(s, o.run_id, { worktree }));

  const model = ticket.profile?.model ?? null;
  ok(execute(s, { command: 'node.start', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, node_id: o.node_id, iteration: o.iteration, holder: o.holder, profile: { runtime: 'claude-code', model: model ?? '기본값' } } }), 'node.start');
  const h = start(prepare({ command: o.command, worktree, tmpDir, prompt: promptOf(contract), permissionMode: settings.permission_mode, maxTurns: o.maxTurns ?? 30, model, budgetUsd: ticket.reservation?.budget_usd }));
  recordProcess(s, o.run_id, o.holder, { pgid: h.pgid, started_at: h.started_at });

  const ids = { run_id: o.run_id, node_id: o.node_id, iteration: o.iteration, holder: o.holder };
  let pending: Draft['payload'][] = [];
  let resultDraft: Extract<Draft, { type: 'result' }>['payload'] | undefined;
  // 멈춘 이유: 다른 인터페이스의 취소 요청, 또는 임대를 잃음(다른 프로세스가 넘겨받았다. 이때는 아무것도 기록하지 않는다)
  let stopped: 'cancel' | 'lease' | undefined;
  const flush = () => {
    if (pending.length && stopped !== 'lease') ok(execute(s, { command: 'node.events', principal: SYSTEM, channel: 'runner', args: { ...ids, activities: pending } }), 'node.events');
    pending = [];
  };
  // 주기적으로: 쌓인 활동을 기록하고, 임대를 연장하고, 다른 인터페이스의 취소 요청을 본다
  const tick = setInterval(() => {
    flush();
    if (stopped) return;
    if (!renewLease(s, o.run_id, o.holder, o.ttlMs ?? 30_000)) { stopped = 'lease'; stop(h); return; }
    if (JSON.parse(runRow(s, o.run_id)!.payload).cancel_requested) { stopped = 'cancel'; stop(h); }
  }, o.tickMs ?? 1000);
  const raw: Buffer[] = [];
  try {
    for await (const msg of lines(h, raw)) for (const d of normalize(msg)) {
      if (d.type === 'agent.activity') pending.push(d.payload);
      else if (d.type === 'result') resultDraft = d.payload;
    }
  } finally {
    clearInterval(tick);
  }
  const exit = await h.exit;
  if (realProcs.groupAlive(h.pgid)) stop(h); // 단계가 끝나면 그룹 전체가 끝났는지 확인한다(6-8 ①)
  if (stopped === 'lease') return { result: '중단', exit, cancelled: false };
  flush();
  const transcript = raw.length ? s.putArtifact(Buffer.concat(raw)) : undefined;
  const cancelled = stopped === 'cancel';
  const result: StepResult['result'] = cancelled ? '중단' : exit === 0 && resultDraft?.ok ? '성공' : '실패';
  // 프로세스 그룹이 끝난 것을 확인한 뒤 결과를 고정한다(6-8). 취소된 단계의 결과는 제출하지 않는다
  const submission = cancelled ? undefined : submit(s, { run_id: o.run_id, node_id: o.node_id, holder: o.holder, worktree, base_ref: baseline.base_ref,
    write_scope: ticket.allowed?.write_scope ?? null, output_slots: contract.output_slots.map((x: any) => x.name) });
  ok(execute(s, { command: 'node.finish', principal: SYSTEM, channel: 'runner', args: { ...ids, result, transcript,
    usage: resultDraft ? { cost_usd: resultDraft.cost_usd, tokens: resultDraft.tokens } : undefined } }), 'node.finish');
  if (cancelled) ok(execute(s, { command: 'run.cancelled', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, holder: o.holder } }), 'run.cancelled');
  // 쓰기 범위 밖 변경: Run을 실패(쓰기 범위)로 닫는다. 다음 시도는 새 Run과 새 worktree로 한다(6-8 ③)
  if (submission?.scope_check === '거부') ok(execute(s, { command: 'run.fail', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, holder: o.holder,
    reason: '쓰기 범위', action: `쓰기 범위 밖 변경(${submission.rejected.join(', ')})을 보고 새 시도를 시작할지 결정` } }), 'run.fail');
  return { result, exit, cancelled, submission };
}
