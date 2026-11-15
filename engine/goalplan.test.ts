// Agent 계획을 공정으로 불러오기 시험(T38-C1): Agent가 낸 계획이 계획 파일 형식과 읽기 모델 검사를 통과할 때만 불러오고,
// 어기면 아무것도 남기지 않으며 이유를 보인다. 실제 Agent 대신 같은 출력을 내는 가짜 CLI를 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.ts';
import { askAgent, importAgentPlan, plannerPrompt } from './goalplan.ts';
import { foldAll, tasksUnder, waitsOf } from '../tools/readmodel.ts';

const CLAUDE = [process.execPath, new URL('./fixtures/fake-claude.mjs', import.meta.url).pathname];
const CODEX = [process.execPath, new URL('./fixtures/fake-codex.mjs', import.meta.url).pathname];
const CLI = new URL('../tools/catena.ts', import.meta.url).pathname;
const task = (id: string, extra: object = {}) => ({ id, name: `${id} 구현`, phase: 'P2', goal: `${id}를 만든다`, outputs: { out: '코드' },
  conditions: [{ id: `${id}-C1`, method: 'auto', slot: 'out', text: '단위 테스트 통과', verify: { command: 'npm test' } }], ...extra });
const plan = (wbs: any[]) => ({ project: { project_id: 'g', name: '회의실 예약' }, phases: [{ id: 'P2', name: '구현' }], milestones: [], wbs });
const GOOD = plan([task('T01'), task('T02', { agent: 'codex', inputs: { base: 'T01.out' } })]);
const fresh = () => openStore(mkdtempSync(join(tmpdir(), 'catena-goal-')));

test('T38-C1: Agent가 낸 계획이 검사를 통과하면 공정으로 불러오고, Task마다 고른 Agent와 선후 관계가 공정표에 보인다', () => {
  const s = fresh();
  const r = importAgentPlan(s, `계획입니다.\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\n`);
  assert.ok(r.ok, !r.ok ? r.message : '');
  const m = foldAll(s.events(), s.refCheck);
  assert.deepEqual(tasksUnder(m), ['T01', 'T02']);
  assert.equal(m.contracts.get('T02').agent, 'codex');
  assert.ok(waitsOf(m, 'T02').some((w: any) => w.type === 'dependency' && w.source === 'T01'), 'T02는 T01의 결과를 기다린다');
  s.close();
});

test('T38-C1: 순환·없는 선행 Task·형식 오류·JSON이 아닌 출력은 아무것도 남기지 않고 이유를 보인다', () => {
  const cases: [string, RegExp][] = [
    [JSON.stringify(plan([task('T01', { inputs: { x: 'T02.out' } }), task('T02', { inputs: { y: 'T01.out' } })])), /E3|순환/],
    [JSON.stringify(plan([task('T01', { inputs: { x: 'T09.out' } })])), /E2|E4|없/],
    [JSON.stringify(plan([task('T01', { agent: 'gemini' })])), /agent는/],
    ['계획을 만들 수 없습니다.', /JSON이 없다/],
  ];
  for (const [text, why] of cases) {
    const s = fresh();
    const r = importAgentPlan(s, text);
    assert.ok(!r.ok, text.slice(0, 40));
    assert.match(r.message, why);
    assert.equal(s.events().length, 0, '아무것도 남기지 않는다');
    s.close();
  }
});

test('T38: Agent에게는 계획만 받는다 — Claude Code는 plan 권한 모드, Codex는 read-only로 띄우고 마지막 응답을 쓴다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'catena-goal-'));
  const prompt = plannerPrompt('회의실 예약 서비스를 만든다', 'g');
  assert.match(prompt, /JSON 하나만/);
  process.env.FAKE_PLAN = JSON.stringify(GOOD);
  try {
    process.env.FAKE_CLAUDE_MODE = 'plan';
    process.env.FAKE_CLAUDE_ARGS = join(dir, 'claude.json');
    assert.equal(await askAgent({ agent: 'claude-code', prompt, cwd: dir, tmpDir: dir, command: CLAUDE }), process.env.FAKE_PLAN);
    assert.ok(JSON.parse(readFileSync(join(dir, 'claude.json'), 'utf8')).argv.join(' ').includes('--permission-mode plan'));
    process.env.FAKE_CODEX_MODE = 'plan';
    process.env.FAKE_CODEX_ARGS = join(dir, 'codex.json');
    assert.equal(await askAgent({ agent: 'codex', prompt, cwd: dir, tmpDir: dir, command: CODEX }), process.env.FAKE_PLAN);
    assert.ok(JSON.parse(readFileSync(join(dir, 'codex.json'), 'utf8')).argv.join(' ').includes('-s read-only'));
  } finally {
    for (const k of ['FAKE_PLAN', 'FAKE_CLAUDE_MODE', 'FAKE_CLAUDE_ARGS', 'FAKE_CODEX_MODE', 'FAKE_CODEX_ARGS']) delete process.env[k];
  }
});

test('T38: CLI plan from-goal은 Agent 계획을 불러오고 원문을 남기며, 검사를 통과하지 못하면 불러오지 않는다', () => {
  const run = (planText: string) => {
    const store = join(mkdtempSync(join(tmpdir(), 'catena-goal-')), 'store');
    const r = spawnSync(process.execPath, [CLI, 'plan', 'from-goal', '회의실 예약 서비스', '--agent', 'codex', '--project-id', 'g', '--store', store], {
      encoding: 'utf8', env: { ...process.env, CATENA_AGENT_COMMAND: JSON.stringify(CODEX), FAKE_CODEX_MODE: 'plan', FAKE_PLAN: planText } });
    return { r, store };
  };
  const ok = run(JSON.stringify(GOOD));
  assert.equal(ok.r.status, 0, ok.r.stderr);
  assert.match(ok.r.stdout, /codex가 낸 계획을 불러왔다/);
  assert.ok(existsSync(join(ok.store, 'goal-plan.json')));
  const bad = run(JSON.stringify(plan([task('T01', { inputs: { x: 'T01.out' } })])));
  assert.equal(bad.r.status, 1, bad.r.stderr);
  assert.match(bad.r.stderr, /불러오지 않았다/);
});
