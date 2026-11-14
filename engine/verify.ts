// Agent 결과 검사(T21, A-6, 7-2, 7-3, 7-7, 7-8): 결과 commit을 Agent의 worktree가 아닌 새 checkout에 꺼내,
// Task 명세에 고정된 검사 방법(검증 정의)으로 Catena가 직접 검사를 실행하고 검수 근거(EvidenceBundle)를 남긴다.
// Agent가 전한 결과는 검수 근거가 아니다(7-3). 검사 방법이 없는 자동 조건은 '미실행'으로 남아 검수할 수 없다.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldAll } from '../tools/readmodel.ts';
import { execute, HANDLERS, Refusal } from './commands.ts';
import { holds, realProcs, renewLease, type Holder } from './supervise.ts';
import { projectSettings } from './step.ts';
import type { Store } from './store.ts';

const SYSTEM = { kind: 'system' as const, id: 'orchestrator' };
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'Cargo.lock', 'go.sum', 'uv.lock', 'poetry.lock'];

HANDLERS['evidence.record'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, holder, evidence } = cmd.args;
    if (!holds(s, run_id, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`);
    s.db.prepare('INSERT INTO evidence VALUES (?, ?, ?)').run(evidence.evidence_id, evidence.submission_id, JSON.stringify(evidence));
    emit({ type: 'evidence.recorded', subject: evidence.submission_id, issuer: 'Validation & Acceptance', payload: evidence });
  },
};

/** 셸 명령을 새 프로세스 그룹으로 실행한다. 시간을 넘기거나 그만두라고 하면(stop) 그룹 전체를 끝낸다. */
function sh(command: string, cwd: string, timeoutMs: number, stop: () => boolean): Promise<{ code: number | null; out: string; reason?: string }> {
  return new Promise(done => {
    const p = spawn('/bin/sh', ['-c', command], { cwd, detached: true, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let reason: string | undefined;
    p.stdout.on('data', c => (out += c));
    p.stderr.on('data', c => (out += c));
    const end = (why: string) => { if (!reason) { reason = why; realProcs.killGroup(p.pid!); } };
    const t = setTimeout(() => end('시간 초과'), timeoutMs);
    const w = setInterval(() => { if (stop()) end('감독 임대를 잃음'); }, 200);
    p.on('close', code => { clearTimeout(t); clearInterval(w); done({ code, out, reason }); });
  });
}

export type Checked = { condition_id: string; evidence_id: string; result: '통과' | '실패' | '미실행' };

/** 제출 기록 하나의 필수 자동 조건을 모두 검사한다. 감독 임대를 가진 프로세스(holder)만 부른다. */
export async function collectEvidence(s: Store, o: { run_id: string; holder: Holder; submission_id: string; timeoutMs?: number; ttlMs?: number }): Promise<Checked[]> {
  if (!holds(s, o.run_id, o.holder)) throw new Error(`감독 임대를 갖지 않았다 ${o.run_id}`);
  const row = s.db.prepare('SELECT payload FROM submissions WHERE submission_id = ? AND run_id = ?').get(o.submission_id, o.run_id) as { payload: string } | undefined;
  if (!row) throw new Error(`이 Run의 제출 기록이 아니다 ${o.submission_id}`);
  const sub = JSON.parse(row.payload);
  if (sub.scope_check !== '통과' || !sub.commit) throw new Error(`쓰기 범위에서 거부된 결과는 검사하지 않는다 ${o.submission_id}`);
  const m = foldAll(s.events(), s.refCheck);
  const contract = m.contracts.get(m.runs.get(o.run_id).task);
  const repo = projectSettings(s).repo!;
  const out: Checked[] = [];
  for (const c of contract.conditions.filter((x: any) => x.required && x.method === 'auto')) {
    const n = (s.db.prepare('SELECT COUNT(*) AS n FROM evidence WHERE submission_id = ?').get(o.submission_id) as { n: number }).n;
    const evidence_id = `${o.submission_id}-e${n + 1}`;
    let result: Checked['result'];
    let log: string;
    let environment: Record<string, string> = { commit: sub.commit };
    if (!c.verifier_ref || s.refCheck(c.verifier_ref)) {
      result = '미실행';
      log = c.verifier_ref ? `검사 방법 원문을 찾을 수 없어 실행하지 않았다(${s.refCheck(c.verifier_ref)}).` : '검사 방법(verify)이 Task 명세에 없어 실행하지 않았다.';
    } else {
      const verifier = JSON.parse(readFileSync(join(s.dir, 'artifacts', 'sha256', c.verifier_ref.id.slice(7)), 'utf8'));
      // 새 checkout: Agent의 worktree가 아니라 제출 commit을 따로 꺼낸다(7-8 ②). 끝나면 지운다
      const dir = join(s.dir, 'checks', evidence_id);
      execFileSync('git', ['-C', repo, 'worktree', 'add', '--detach', dir, sub.commit], { stdio: 'pipe' });
      try {
        const lock = LOCKFILES.find(f => existsSync(join(dir, f)));
        environment = { ...environment, node: process.version, platform: process.platform, ...(lock ? { lockfile: `${lock} sha256:${createHash('sha256').update(readFileSync(join(dir, lock))).digest('hex')}` } : {}) };
        let lost = false;
        const r = await sh(verifier.command, dir, o.timeoutMs ?? 30 * 60_000, () => (lost ||= !renewLease(s, o.run_id, o.holder, o.ttlMs ?? 30_000)));
        if (lost) throw new Error(`검사 중 감독 임대를 잃었다 ${o.run_id}`);
        result = r.code === 0 && !r.reason ? '통과' : '실패';
        log = `$ ${verifier.command}\n${r.out}\n(종료 코드 ${r.code ?? '없음'}${r.reason ? `, ${r.reason}` : ''})\n`;
      } finally {
        execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' });
      }
    }
    const evidence = {
      evidence_id, condition_id: c.condition_id, submission_id: o.submission_id, result, raw_log_ref: s.putArtifact(log),
      ...(c.verifier_ref ? { verifier_ref: c.verifier_ref } : {}),
      verifier: 'runner', collected_via: '직접 실행', target_ref: { submission_id: o.submission_id, commit: sub.commit }, environment,
    };
    const r = execute(s, { command: 'evidence.record', principal: SYSTEM, channel: 'runner', args: { run_id: o.run_id, holder: o.holder, evidence } });
    if (!r.ok) throw new Error(`검수 근거 기록: ${r.reason} ${r.message}`);
    out.push({ condition_id: c.condition_id, evidence_id, result });
  }
  return out;
}

/** 워크플로우의 자동 검사 노드 한 회차: 노드를 시작하고, 검사하고, 모두 통과했으면 성공으로 닫는다. */
export async function runCheckNode(s: Store, o: { run_id: string; iteration: number; holder: Holder; submission_id: string; timeoutMs?: number }) {
  const ids = { run_id: o.run_id, node_id: 'check', iteration: o.iteration, holder: o.holder };
  const ok = (r: ReturnType<typeof execute>, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason} ${r.message}`); };
  ok(execute(s, { command: 'node.start', principal: SYSTEM, channel: 'runner', args: { ...ids, profile: { runtime: 'catena-runner', model: '검사 코드' } } }), 'node.start');
  let checks: Checked[] = [];
  let done = false;
  try {
    checks = await collectEvidence(s, o);
    done = true;
  } finally {
    // 임대를 잃었으면 넘겨받은 프로세스가 정리한다(6-9). 여기서는 기록하지 않는다
    if (holds(s, o.run_id, o.holder))
      ok(execute(s, { command: 'node.finish', principal: SYSTEM, channel: 'runner', args: { ...ids, result: done && checks.every(c => c.result === '통과') ? '성공' : '실패' } }), 'node.finish');
  }
  return checks;
}
