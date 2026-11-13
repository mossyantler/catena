// 제출 기록 시험(T20): 추적 파일 수정·삭제와 미추적 파일 생성이 모두 제출 기록에 잡히고(ignore된 파일은 빠진다),
// write_scope 밖 변경은 제출 기록 단계에서 거부되어 인수 대상에 들어가지 않는다(Engine 인수 기준 2, 6-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { beginRun, me } from './supervise.ts';
import { runAgentNode } from './step.ts';
import { inScope } from './submit.ts';
import { foldAll, waitsOf } from '../tools/readmodel.ts';

const FAKE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const plan = (write_scope?: string[]) => ({ project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [{ id: 'A', name: 'A', phase: 'P1', goal: '예약 모듈을 고친다', outputs: { code: '코드' }, write_scope,
    conditions: [{ id: 'A-C1', method: 'auto', slot: 'code', text: '단위 테스트 통과' }] }] });

// 추적 파일 셋(README.md, src/old.ts, src/keep.ts)과 ignore 규칙(build/)이 있는 저장소에서 Run 하나를 실행 중으로 만든다
function running(write_scope?: string[]) {
  const base = mkdtempSync(join(tmpdir(), 'catena-submit-'));
  const repo = join(base, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험 저장소\n');
  writeFileSync(join(repo, 'src', 'old.ts'), 'export const old = 1;\n');
  writeFileSync(join(repo, 'src', 'keep.ts'), 'export const keep = 1;\n');
  writeFileSync(join(repo, '.gitignore'), 'build/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: plan(write_scope) } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: sha } }).ok);
  const holder = me();
  assert.ok(beginRun(s, 'A-r1', holder, 30_000).ok);
  return { repo, sha, s, holder };
}
const EDITS = { write: { 'README.md': '고친 설명\n', 'src/new.ts': 'export const fresh = 2;\n', 'build/out.log': '빌드 부산물\n' }, delete: ['src/old.ts'] };
async function step(t: ReturnType<typeof running>, edits: object) {
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CLAUDE_EDITS = JSON.stringify(edits);
  delete process.env.FAKE_CLAUDE_ARGS;
  try { return await runAgentNode(t.s, { run_id: 'A-r1', node_id: 'work', iteration: 1, holder: t.holder, command: FAKE, tickMs: 50 }); }
  finally { delete process.env.FAKE_CLAUDE_EDITS; }
}
const row = (t: ReturnType<typeof running>, sql: string) => t.s.db.prepare(sql).get() as any;

test('T20-C1: 추적 파일 수정·삭제와 미추적 파일 생성이 모두 제출 기록에 잡히고, Catena가 그 내용으로 commit을 만든다', async () => {
  const t = running(['src/**', 'README.md', 'hello.txt']);
  const r = await step(t, EDITS);
  const sub = r.submission!;
  assert.equal(sub.scope_check, '통과');
  assert.deepEqual(sub.changes.map(c => `${c.status} ${c.path}`).sort(), ['A hello.txt', 'A src/new.ts', 'D src/old.ts', 'M README.md'], 'ignore된 build/out.log는 빠진다');

  // commit: base_ref 위에 worktree의 지금 내용. ref로 붙잡아 둔다
  assert.equal(git(t.repo, 'rev-parse', `${sub.commit}^`), t.sha);
  assert.equal(git(t.repo, 'rev-parse', `refs/catena/submissions/${sub.submission_id}`), sub.commit);
  assert.deepEqual(git(t.repo, 'ls-tree', '-r', '--name-only', sub.commit!).split('\n').sort(), ['.gitignore', 'README.md', 'hello.txt', 'src/keep.ts', 'src/new.ts']);
  assert.equal(git(t.repo, 'show', `${sub.commit}:README.md`), '고친 설명');

  // Agent의 worktree는 건드리지 않았다: HEAD는 base_ref, 변경은 commit되지 않은 채 남는다
  const wt = JSON.parse(row(t, "SELECT payload FROM runs WHERE run_id = 'A-r1'").payload).worktree;
  assert.equal(git(wt, 'rev-parse', 'HEAD'), t.sha);
  assert.match(git(wt, 'status', '--porcelain'), /D src\/old\.ts/);

  // 기록: 제출 기록 표와 이벤트, diff 원문
  const ev = t.s.events().find(e => e.type === 'submission.created')!;
  assert.deepEqual([ev.payload.submission_id, ev.payload.scope_check, ev.payload.slots], ['A-r1-s1', '통과', [{ output_slot: 'code' }]]);
  const diff = readFileSync(join(t.s.dir, 'artifacts', 'sha256', ev.payload.diff_ref.id.slice(7)), 'utf8');
  for (const p of ['README.md', 'src/new.ts', 'src/old.ts', 'hello.txt']) assert.ok(diff.includes(p), p);
  assert.equal(JSON.parse(row(t, "SELECT payload FROM submissions WHERE submission_id = 'A-r1-s1'").payload).commit, sub.commit);
  const m = foldAll(t.s.events(), t.s.refCheck);
  assert.equal(m.submissions.get('A-r1-s1').scope_check, '통과');
  assert.equal(row(t, "SELECT state FROM runs WHERE run_id = 'A-r1'").state, '실행 중', '통과한 제출 기록은 다음 단계(자동 검사)로 이어진다');
  t.s.close();
});

test('T20-C1: write_scope 밖 변경은 제출 기록에서 거부되고, Run은 실패(쓰기 범위)로 끝나며 인수 대상에 들어가지 않는다(Engine 인수 기준 2)', async () => {
  const t = running(['src/**', 'hello.txt']);
  const r = await step(t, { write: { ...EDITS.write, 'package-lock.json': '{}\n' }, delete: EDITS.delete });
  const sub = r.submission!;
  assert.deepEqual([sub.scope_check, sub.commit, sub.rejected.sort()], ['거부', null, ['README.md', 'package-lock.json']]);
  assert.throws(() => git(t.repo, 'rev-parse', '--verify', '-q', `refs/catena/submissions/${sub.submission_id}`), '거부된 제출 기록은 commit하지 않는다');

  const tail = t.s.events().slice(-3).map(e => [e.type, e.payload.to ?? e.payload.wait_type ?? e.payload.result]);
  assert.deepEqual(tail, [['node.finished', '성공'], ['run.state_changed', '실패'], ['wait.raised', 'decision']]);
  const m = foldAll(t.s.events(), t.s.refCheck);
  assert.equal(m.runs.get('A-r1').reason, '쓰기 범위');
  assert.deepEqual(m.submissions.get('A-r1-s1').rejected_paths.sort(), ['README.md', 'package-lock.json']);
  assert.ok(waitsOf(m, 'A').some((w: any) => w.type === 'decision' && /README\.md/.test(w.action.text)), '사용자가 다음 진행을 정하도록 대기 사유가 열린다');
  assert.equal(row(t, "SELECT status FROM tickets WHERE run_id = 'A-r1'").status, '정산 완료');
  assert.equal(row(t, 'SELECT COUNT(*) AS n FROM run_leases').n, 0);

  // 거부된 제출 기록에는 증거를 붙일 수 없다: 인수 대상이 되지 않는다(E7)
  const evidence = { ...t.s.events().at(-1)!, seq: t.s.events().length + 1, event_id: 'x', type: 'evidence.recorded', subject: 'A',
    payload: { evidence_id: 'E1', submission_id: 'A-r1-s1', condition_id: 'A-C1', result: '통과' } };
  assert.throws(() => foldAll([...t.s.events(), evidence], t.s.refCheck), /E7/);

  // 다음 시도는 새 Run으로
  assert.ok(execute(t.s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: t.sha } }).ok);
  t.s.close();
});

test('T20: 쓰기 범위는 glob이고, 의존성 잠금 파일은 경로를 직접 적어야 범위 안이며, 범위를 적지 않으면 저장소 전체다', () => {
  assert.ok(inScope('src/a/b.ts', ['src/**']));
  assert.ok(!inScope('docs/a.md', ['src/**']));
  assert.ok(!inScope('package-lock.json', ['**']), '잠금 파일은 기본으로 범위 밖');
  assert.ok(inScope('package-lock.json', ['src/**', 'package-lock.json']));
  assert.ok(inScope('docs/a.md', null) && !inScope('web/yarn.lock', null));
  const s = openStore(mkdtempSync(join(tmpdir(), 'catena-submit-')));
  const bad = execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: plan('src/**' as any) } });
  assert.ok(!bad.ok && /write_scope/.test(bad.message), '계획 파일의 write_scope는 문자열 배열이다');
  s.close();
});
