// 제출 기록(6-8 ②③④, 7-8): Agent 단계가 끝나면 worktree의 변경을 base_ref와 비교한다. 추적 파일의 수정·삭제와
// ignore되지 않은 미추적 파일을 모두 보고, ignore된 파일은 보지 않는다. write_scope 밖 변경이 하나라도 있으면 거부로
// 기록만 하고(행위를 막는 장치가 아니라 인수 대상에서 빼는 확인이다, 0-5), 통과하면 Catena가 commit을 만든다.
// 비교와 commit은 임시 index로 한다. Agent의 worktree(파일, index, HEAD)는 건드리지 않는다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, matchesGlob } from 'node:path';
import { execute, HANDLERS, Refusal } from './commands.ts';
import { holds, type Holder } from './supervise.ts';
import type { Store } from './store.ts';

export type Change = { status: string; path: string }; // status: A(새 파일) · M(수정) · D(삭제) · T(종류 바뀜)

// 의존성 잠금 파일은 write_scope에 경로를 직접 적지 않으면 범위 밖이다(TaskContract write_scope, 7-8).
// shortcut: 흔한 잠금 파일 이름만 안다. 다른 생태계를 쓰는 Project가 생기면 Project 설정으로 넓힌다.
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'Gemfile.lock', 'composer.lock']);

/** 경로가 쓰기 범위 안인가. scope가 없으면(계획에 적지 않음) 저장소 전체다. 패턴은 glob(`src/**`)이다. */
export function inScope(path: string, scope: string[] | null | undefined): boolean {
  if (scope?.includes(path)) return true;
  if (LOCKFILES.has(basename(path))) return false;
  return !scope || scope.some(p => matchesGlob(path, p));
}

const IDENTITY = { GIT_AUTHOR_NAME: 'Catena', GIT_AUTHOR_EMAIL: 'catena@localhost', GIT_COMMITTER_NAME: 'Catena', GIT_COMMITTER_EMAIL: 'catena@localhost' };

/** worktree의 지금 내용을 base_ref와 비교한다. tree는 그 내용 전체이고, diff는 화면이 읽을 변경 원문이다. */
export function snapshot(worktree: string, base_ref: string): { tree: string; changes: Change[]; diff: string } {
  const dir = mkdtempSync(join(tmpdir(), 'catena-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(dir, 'index') };
  const git = (...a: string[]) => execFileSync('git', ['-C', worktree, ...a], { env, encoding: 'utf8', maxBuffer: 256 << 20 });
  try {
    git('read-tree', base_ref);
    git('add', '-A', '--', '.');
    const parts = git('diff', '--cached', '--name-status', '--no-renames', '-z', base_ref).split('\0').filter(Boolean);
    const changes: Change[] = [];
    for (let i = 0; i < parts.length; i += 2) changes.push({ status: parts[i], path: parts[i + 1] });
    return { tree: git('write-tree').trim(), changes, diff: git('diff', '--cached', '--no-renames', '--binary', base_ref) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 제출 commit을 만들고 ref로 붙잡아 둔다(후행 Task의 base_ref가 된다). Agent는 이 commit을 만들 수 없다. */
function commitOf(worktree: string, tree: string, base_ref: string, submission_id: string): string {
  const git = (...a: string[]) => execFileSync('git', ['-C', worktree, ...a], { env: { ...process.env, ...IDENTITY }, encoding: 'utf8' }).trim();
  const commit = git('commit-tree', tree, '-p', base_ref, '-m', `Catena 제출 기록 ${submission_id}`);
  git('update-ref', `refs/catena/submissions/${submission_id}`, commit);
  return commit;
}

HANDLERS['submission.create'] = {
  principals: ['system'],
  run: (s, cmd, _p, emit) => {
    const { run_id, node_id, holder, submission_id, base_ref, commit, changes, rejected, diff_ref, slots } = cmd.args;
    if (!holds(s, run_id, holder)) throw new Refusal('버전 충돌', `감독 임대를 갖지 않았다 ${run_id}`);
    const scope_check = rejected.length ? '거부' : '통과';
    s.db.prepare('INSERT INTO submissions VALUES (?, ?, ?)').run(submission_id, run_id,
      JSON.stringify({ submission_id, run_id, step: node_id, governance: 'Catena 실행', base_ref, commit, diff_ref, slots, scope_check, rejected_paths: rejected, changes, created_at: new Date().toISOString() }));
    emit({ type: 'submission.created', subject: run_id, issuer: 'Execution',
      payload: { submission_id, run_id, node_id, slots, scope_check, diff_ref, ...(rejected.length ? { rejected_paths: rejected } : {}) } });
  },
};

export type Submitted = { submission_id: string; scope_check: '통과' | '거부'; commit: string | null; changes: Change[]; rejected: string[] };

/** 6-8 ②③④. 노드가 아직 실행 중일 때 부른다(제출 기록은 그 노드의 결과다, E5). */
export function submit(s: Store, o: { run_id: string; node_id: string; holder: Holder; worktree: string; base_ref: string; write_scope: string[] | null; output_slots: string[] }): Submitted {
  const n = (s.db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE run_id = ?').get(o.run_id) as { n: number }).n;
  const submission_id = `${o.run_id}-s${n + 1}`; // 수정 반복마다 새 제출 기록
  const { tree, changes, diff } = snapshot(o.worktree, o.base_ref);
  const rejected = changes.map(c => c.path).filter(p => !inScope(p, o.write_scope));
  const commit = rejected.length ? null : commitOf(o.worktree, tree, o.base_ref, submission_id); // 거부된 제출 기록은 commit하지 않는다
  const r = execute(s, { command: 'submission.create', principal: { kind: 'system', id: 'orchestrator' }, channel: 'runner', args: {
    run_id: o.run_id, node_id: o.node_id, holder: o.holder, submission_id, base_ref: o.base_ref, commit, changes, rejected,
    diff_ref: s.putArtifact(diff), slots: o.output_slots.map(output_slot => ({ output_slot })) } });
  if (!r.ok) throw new Error(`제출 기록: ${r.reason} ${r.message}`);
  return { submission_id, scope_check: rejected.length ? '거부' : '통과', commit, changes, rejected };
}
