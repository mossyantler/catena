// 명령 계층과 계획 불러오기 시험(T14): 규칙을 어긴 명령은 상태와 이벤트를 남기지 않는다(C1),
// plan/catena.plan.json을 불러와 만든 읽기 모델이 tools/plan.ts의 결과와 같다(C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from './store.ts';
import { execute, type Command } from './commands.ts';
import { foldAll } from '../tools/readmodel.ts';
import { describe } from '../tools/fold.ts';
import { acceptAll } from '../tools/planfold.ts';
import { foldPlan, loadPlan } from '../tools/plan.ts';

const ROOT = join(import.meta.dirname, '..');
const fresh = () => openStore(mkdtempSync(join(tmpdir(), 'catena-cmd-')));
const human = { kind: 'human' as const, id: 'user' };
const imp = (plan: any, over: Partial<Command> = {}): Command => ({ command: 'plan.import', principal: human, channel: 'cli-batch', args: { plan }, ...over });
const TABLES = ['events', 'commands', 'projects', 'wbs_nodes', 'contracts', 'dependencies', 'milestones'];
const counts = (s: Store) => Object.fromEntries(TABLES.map(t => [t, (s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n]));

const task = (id: string, inputs?: Record<string, string>) => ({
  id, name: id, phase: 'P1', goal: id, inputs, outputs: { out: '코드' },
  conditions: [{ id: `${id}-C1`, method: 'auto', slot: 'out', text: '시험' }],
});
const small = (wbs: any[]) => ({ project: { project_id: 'p', name: '시험 계획' }, phases: [{ id: 'P1', name: '설계' }], wbs, milestones: [] });

test('C1: 규칙을 어긴 명령은 상태와 이벤트를 남기지 않는다', () => {
  const s = fresh();
  const empty = counts(s);
  const refused: [Command, RegExp, string][] = [
    [imp(small([task('A', { in: 'B.out' }), task('B', { in: 'A.out' })])), /E4/, '순환'],
    [imp(small([task('A', { in: 'X.out' })])), /E2|E3/, '없는 공급 Task'],
    [imp(small([task('A', { in: 'A.out' })])), /E4/, '자기 참조'],
    [imp({ project: { project_id: 'p' } }), /계획 파일 형식/, '형식 오류'],
  ];
  for (const [cmd, re, what] of refused) {
    const r = execute(s, cmd);
    assert.equal(r.ok, false, what);
    assert.ok(!r.ok && r.reason === '규칙 위반' && re.test(r.message), `${what}: ${!r.ok && r.message}`);
    assert.deepEqual(counts(s), empty, `${what}: 아무것도 남지 않는다`);
  }
  const agent = execute(s, imp(small([task('A')]), { principal: { kind: 'agent', id: 'claude' } }));
  assert.ok(!agent.ok && agent.reason === '권한 거부');
  const unknown = execute(s, { command: 'plan.drop', principal: human, channel: 'cli-tty', args: {} });
  assert.ok(!unknown.ok && unknown.reason === '대상 없음');
  assert.deepEqual(counts(s), empty);

  const ok = execute(s, imp(small([task('A'), task('B', { in: 'A.out' })])));
  assert.ok(ok.ok, !ok.ok ? ok.message : '');
  const after = counts(s);
  assert.deepEqual(after, { events: ok.version, commands: 1, projects: 1, wbs_nodes: 2, contracts: 2, dependencies: 1, milestones: 0 });
  const row = s.db.prepare('SELECT seq_from, seq_to, command, principal, channel FROM commands').get() as any;
  assert.deepEqual({ ...row }, { seq_from: 1, seq_to: ok.version, command: 'plan.import', principal: JSON.stringify(human), channel: 'cli-batch' });

  const again = execute(s, imp(small([task('A'), task('B', { in: 'A.out' })])));
  assert.ok(!again.ok && again.reason === '규칙 위반', '같은 계획을 두 번 불러오지 않는다');
  const stale = execute(s, imp(small([task('C')]), { expected_version: 1 }));
  assert.ok(!stale.ok && stale.reason === '버전 충돌' && stale.version === ok.version, '최신 버전을 돌려준다');
  assert.deepEqual(counts(s), after, '거부된 명령 뒤에도 그대로다');
  assert.doesNotThrow(() => foldAll(s.events(), s.refCheck));
  s.close();
});

test('C2: plan/catena.plan.json을 불러와 만든 읽기 모델이 tools/plan.ts의 결과와 같다', () => {
  const s = fresh();
  const { plan, accepted, model: viaPlanTool } = loadPlan();
  const r = execute(s, imp(plan));
  assert.ok(r.ok, !r.ok ? r.message : '');
  const stored = foldAll(s.events(), s.refCheck);
  // 계획 구조·계약·의존·Milestone과 Task 상태가 같다(인수 기록 없이)
  assert.deepEqual(describe(stored), describe(foldPlan(plan, []).model));
  // 사람 인수 기록은 이벤트가 아니므로(0-11) 불러오지 않는다. 같은 기록을 더하면 tools/plan.ts의 결과와 같다
  acceptAll(stored, accepted, foldPlan(plan, []).contractHash);
  assert.deepEqual(describe(stored), describe(viaPlanTool));
  s.close();
});

test('CLI: plan import는 저장소에 계획을 넣고, 같은 저장소를 --store로 질의한다. 실패는 종료 코드로 알린다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catena-cli-'));
  const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, 'tools', 'catena.ts'), ...a, '--json'], { encoding: 'utf8' });
  const first = cli('plan', 'import', join(ROOT, 'plan', 'catena.plan.json'), '--store', dir);
  assert.equal(first.status, 0, first.stderr);
  const out = JSON.parse(first.stdout);
  assert.equal(out.data.tasks, loadPlan().model.contracts.size);
  const status = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'tools', 'catena.ts'), 'status', '--store', dir, '--json'], { encoding: 'utf8' }));
  assert.equal(status.source.origin, 'live');
  assert.equal(status.data.tasks.length, out.data.tasks);
  const again = cli('plan', 'import', join(ROOT, 'plan', 'catena.plan.json'), '--store', dir);
  assert.equal(again.status, 1, '규칙 위반은 종료 코드 1');
  assert.equal(JSON.parse(again.stdout).error.kind, '규칙 위반');
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, '{');
  assert.equal(cli('plan', 'import', bad, '--store', dir).status, 2, '읽을 수 없는 파일은 사용법 오류');
  assert.equal(cli('status', '--store', join(dir, 'none')).status, 3, '없는 저장소는 대상 없음');
  assert.ok(readFileSync(join(dir, 'catena.db')).length > 0);
});
