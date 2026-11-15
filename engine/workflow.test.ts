// 워크플로우 템플릿 실행 시험(T23). C1: 검사가 상한만큼 실패하면 Run이 실패로 끝나고 decision 대기가 생긴다.
// C2: Run 상태 전이가 6-3 전이표를 따른다(E5): 성공·상한 실패·승인·반려·승인 대기 중 취소의 전이를 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { execute } from './commands.ts';
import { me } from './supervise.ts';
import { runWorkflow } from './workflow.ts';
import { card, foldAll, waitsOf } from '../tools/readmodel.ts';

const CLAUDE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const human = { kind: 'human' as const, id: 'user' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@localhost', ...a], { cwd, encoding: 'utf8' }).trim();
const plan = (verify: string, withHuman = false) => ({ project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '구현' }], milestones: [],
  wbs: [{ id: 'A', name: 'A 구현', phase: 'P1', goal: '인사 파일을 만든다', outputs: { out: '코드' }, conditions: [
    { id: 'A-C1', method: 'auto', slot: 'out', text: '검사 통과', verify: { command: verify } },
    ...(withHuman ? [{ id: 'A-C2', method: 'human', slot: 'out', text: '문구 검토' }] : [])] }] });

function started(p: any) {
  const base = mkdtempSync(join(tmpdir(), 'catena-wf-'));
  const repo = join(base, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), '시험\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  const s = openStore(join(base, 'store'));
  assert.ok(execute(s, { command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan: p } }).ok);
  assert.ok(execute(s, { command: 'project.configure', principal: human, channel: 'cli-tty', args: { permission_mode: 'acceptEdits', repo } }).ok);
  assert.ok(execute(s, { command: 'run.start', principal: human, channel: 'cli-tty', args: { task_id: 'A', base_ref: git(repo, 'rev-parse', 'HEAD') } }).ok);
  process.env.FAKE_CLAUDE_MODE = 'ok';
  return s;
}
const go = (s: any, env: Record<string, string> = {}) => {
  Object.assign(process.env, env);
  return runWorkflow(s, { run_id: 'A-r1', holder: me(), command: CLAUDE, tickMs: 50, pollMs: 50 }).finally(() => { for (const k of Object.keys(env)) delete process.env[k]; });
};
const transitions = (s: any) => s.events().filter((e: any) => e.type === 'run.state_changed').map((e: any) => e.payload.to);
const nodes = (s: any) => foldAll(s.events(), s.refCheck).nodeLog.map((l: any) => `${l.node}${l.iteration}:${l.result}`);
async function until(f: () => boolean) { for (const t = Date.now() + 10_000; !f(); await new Promise(r => setTimeout(r, 20))) if (Date.now() > t) throw new Error('기다리던 상태가 오지 않았다'); }

test('T23-C1: 검사가 상한(3회)만큼 실패하면 Run이 실패로 끝나고 decision 대기가 생긴다', async () => {
  const s = started(plan('test -f 없는파일'));
  const r = await go(s);
  assert.deepEqual([r.outcome, r.reason, r.iterations], ['실패', '수정 반복 상한 3회 도달', 3]);
  assert.deepEqual(nodes(s), ['work1:성공', 'check1:실패', 'work2:성공', 'check2:실패', 'work3:성공', 'check3:실패']);
  const m = foldAll(s.events(), s.refCheck);
  const w = waitsOf(m, 'A').find((x: any) => x.type === 'decision');
  assert.ok(w && w.action.actor === '사용자', '사용자가 새 시도나 취소를 고르는 대기 사유');
  assert.deepEqual(transitions(s), ['실행 중', '실패']);
  assert.equal(card(m, 'A').acceptance, '미인수');
  s.close();
});

test('T23-C2: 수정 회차에는 실패한 검사를 알려 주고, 통과하면 검수를 기록하고 Run을 종료한다(대기 → 실행 중 → 종료)', async () => {
  const s = started(plan('test -f fixed.txt'));
  const r = await go(s, { FAKE_CLAUDE_FIX_ON_REPAIR: '1' });
  assert.deepEqual([r.outcome, r.iterations], ['검수', 2]);
  assert.deepEqual(nodes(s), ['work1:성공', 'check1:실패', 'work2:성공', 'check2:성공']);
  assert.deepEqual(transitions(s), ['실행 중', '종료']);
  const m = foldAll(s.events(), s.refCheck);
  assert.equal(card(m, 'A').acceptance, '인수됨');
  assert.equal((s.db.prepare("SELECT status FROM tickets WHERE run_id = 'A-r1'").get() as any).status, '정산 완료');
  s.close();
});

test('T23-C2: 사용자 확인 조건이 있으면 승인을 기다린다 — 승인하면 검수·종료, 반려하면 실패와 decision 대기, 기다리는 중 취소하면 취소', async () => {
  for (const [decision, outcome, last] of [['승인', '검수', '종료'], ['반려', '실패', '실패'], ['취소', '취소', '취소']] as const) {
    const s = started(plan('test -f hello.txt', true));
    const running = go(s);
    await until(() => Boolean(s.db.prepare('SELECT 1 FROM approval_requests').get()));
    if (decision === '취소') assert.ok(execute(s, { command: 'run.cancel', principal: human, channel: 'cli-tty', args: { run_id: 'A-r1' } }).ok);
    else assert.ok(execute(s, { command: 'approval.decide', principal: human, channel: 'cli-tty', args: { approval_id: 'A-r1-s1-a1', decision, comment: decision === '반려' ? '문구가 어색하다' : '' } }).ok);
    const r = await running;
    assert.equal(r.outcome, outcome, decision);
    assert.deepEqual(transitions(s), ['실행 중', last], decision);
    assert.equal(nodes(s).at(-1), `approve1:${decision === '승인' ? '성공' : decision === '반려' ? '실패' : '중단'}`);
    assert.doesNotThrow(() => foldAll(s.events(), s.refCheck), '전이와 노드 기록이 검사 규칙(E5)을 통과한다');
    s.close();
  }
});
