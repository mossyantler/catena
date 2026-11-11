// 검사 규칙이 실제로 잘못된 데이터를 거부하는지, 재생 위치와 재생성이 결정적인지 확인한다.
// 사용: node --test tools/fold.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldBundle, card, edgesAt } from './fold.ts';
import * as RM from './readmodel.ts';

const SRC = join(import.meta.dirname, '..', 'scenarios', 'roombook');
const CLI = join(import.meta.dirname, 'catena.ts');

// 묶음을 임시 폴더로 복사하고 events를 고친다. renumber면 seq를 다시 매긴다.
function mutate(fn: (events: any[]) => any[], renumber = true) {
  const dir = mkdtempSync(join(tmpdir(), 'catena-'));
  cpSync(SRC, dir, { recursive: true });
  const file = join(dir, 'events.jsonl');
  let events = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  events = fn(events);
  if (renumber) events.forEach((e, i) => { e.seq = i + 1; });
  writeFileSync(file, events.map(e => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}
const find = (events: any[], pred: (e: any) => boolean) => { const i = events.findIndex(pred); assert.ok(i >= 0); return i; };
const rejects = (dir: string, rule: string) => assert.throws(() => foldBundle(dir), new RegExp(rule));

test('기준 시나리오는 검사를 통과하고 의도한 상태를 보여 준다', () => {
  const { model: m } = foldBundle(SRC);
  assert.equal(card(m, 'T07').rep, '실행 중');
  assert.deepEqual(card(m, 'T07').stages, ['구현', '검증']);
  assert.equal(card(m, 'T03').waits[0].type, 'decision');
  assert.equal(card(m, 'T02').waits[0].type, 'approval');
  assert.equal(card(m, 'T12').waits[0].type, 'resource');
  assert.equal(card(m, 'T05').waits.length, 2);
  const mutual = edgesAt(m).edges.filter(e => ['S1', 'S2'].includes(e.from) && ['S1', 'S2'].includes(e.to));
  assert.equal(mutual.length, 2);
  assert.ok(mutual.every(e => e.aggregated));
});

test('재생 위치: 1일차 끝에는 T03이 일부 슬롯 인수만으로 착수 가능하다', () => {
  const events = readFileSync(join(SRC, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const r03 = events.find(e => e.type === 'run.created' && e.payload.run_id === 'R03-1');
  const { model: m } = foldBundle(SRC, r03.seq - 1);
  assert.equal(card(m, 'T03').rep, '착수 가능');
  assert.equal(card(m, 'T04').waits[0].type, 'dependency');
});

test('E1: 같은 내용의 중복은 무시하고, 다른 내용이면 거부한다', () => {
  foldBundle(mutate(ev => [...ev, structuredClone(ev[4])], false));
  rejects(mutate(ev => { const d = structuredClone(ev[4]); d.payload.name = '바뀜'; return [...ev, d]; }, false), 'E1');
  rejects(mutate(ev => ev.filter((_, i) => i !== 9), false), 'E1');
});

test('E9: 원문 파일이 없거나 내용이 바뀌면 거부한다', () => {
  const dir = mutate(ev => ev, false);
  const art = join(dir, 'artifacts', 'sha256');
  const first = readdirSync(art)[0];
  writeFileSync(join(art, first), '바뀐 내용');
  rejects(dir, 'E9');
  const dir2 = mutate(ev => ev, false);
  unlinkSync(join(dir2, 'artifacts', 'sha256', readdirSync(join(dir2, 'artifacts', 'sha256'))[0]));
  rejects(dir2, 'E9');
});

test('E7: 증거·승인과 다른 제출 기록을 인수하면 거부한다', () => {
  rejects(mutate(ev => { ev[find(ev, e => e.payload.acceptance_id === 'AC06-1')].payload.submission_id = 'S06-1'; return ev; }), 'E7');
});

test('E6: 필수 입력이 인수되기 전에는 Run을 만들 수 없다', () => {
  rejects(mutate(ev => ev.filter(e => e.payload.acceptance_id !== 'AC02-1')), 'E6');
});

test('E4: Task 단위 순환을 거부한다', () => {
  rejects(mutate(ev => {
    const i = find(ev, e => e.type === 'dependency.linked' && e.payload.to.task_id === 'T02');
    ev[i].payload.from = { task_id: 'T05', slot: 'auth_test_report' };
    return ev;
  }), 'E4');
});

test('E8: dependency 대기 사유는 이벤트로 발행할 수 없다', () => {
  rejects(mutate(ev => { ev[find(ev, e => e.payload.wait_id === 'W-T12-budget')].payload.wait_type = 'dependency'; return ev; }), 'E8');
});

test('같은 생성기를 다시 돌리면 같은 이벤트가 나온다', () => {
  const hash = () => createHash('sha256').update(readFileSync(join(SRC, 'events.jsonl'))).digest('hex');
  const before = hash();
  execFileSync(process.execPath, [join(import.meta.dirname, '..', 'scenarios', 'roombook.build.ts')]);
  assert.equal(hash(), before);
});

test('Q8·profile: 수정 반복 회차와 노드를 수행한 Runtime이 읽기 모델에 보인다', () => {
  const { model: m } = foldBundle(SRC);
  assert.deepEqual(RM.rework(m, 'T03').map(r => [r.round, r.failed.length]), [[3, 3]]);
  assert.ok(RM.hasRework(m, 'T06')); // 검증 실패 뒤 수정해 인수된 Task
  assert.ok(!RM.hasRework(m, 'T01'));
  assert.equal(RM.agentGraph(m, 'T03').edges.find((e: any) => e.kind === '반복').loops, 2);
  const runtimes = new Set(RM.agentGraph(m, 'T07').nodes.flatMap((n: any) => n.profiles.map((p: any) => p.runtime)));
  assert.ok(runtimes.size >= 2);
});

test('C-12: CLI의 JSON 값은 화면이 쓰는 읽기 모델 질의 값과 같다', () => {
  for (const at of [undefined, 120]) {
    const { model: m, manifest, position, total } = foldBundle(SRC, at);
    const cli = (...a: string[]) => JSON.parse(execFileSync(process.execPath, [CLI, ...a, '--json', ...(at ? ['--at', String(at)] : [])], { encoding: 'utf8' }));
    const st = cli('status');
    assert.deepEqual(st.source, { origin: manifest.origin, dataset_id: manifest.dataset_id, position: Math.min(position, total), total });
    const ids = RM.tasksUnder(m);
    assert.deepEqual(st.data.counts, Object.fromEntries(RM.aggregate(m, ids).counts));
    assert.deepEqual(st.data.tasks.map((t: any) => [t.id, t.rep, t.conditions.accepted, t.waits[0]?.type ?? null]),
      ids.map(id => { const c = card(m, id); return [id, c.rep, c.accepted, c.waits[0]?.type ?? null]; }));
    assert.deepEqual(st.data.inbox.map((x: any) => x.task), RM.inbox(m).map(x => x.id));
    assert.deepEqual(cli('graph').data.task_edges, RM.taskEdges(m, RM.tasksUnder(m)));
    assert.deepEqual(cli('show', 'T03').data.runs.map((r: any) => [r.run_id, r.round, r.failed.length]), RM.rework(m, 'T03').map(r => [r.run_id, r.round, r.failed.length]));
    assert.deepEqual(cli('agents', 'T07').data.nodes.map((n: any) => [n.node_id, n.status, n.runs]), RM.agentGraph(m, 'T07').nodes.map((n: any) => [n.node_id, n.status, n.runs]));
  }
  const miss = spawnSync(process.execPath, [CLI, 'show', 'T99', '--json'], { encoding: 'utf8' });
  assert.equal(miss.status, 3);
  assert.equal(JSON.parse(miss.stdout).error.kind, '대상 없음');
});

test('집계 엣지 펼치기: 묶인 원본 의존 수가 집계 엣지와 같고, 펼친 그림은 비순환이다', () => {
  const { model: m } = foldBundle(SRC);
  const { edges } = edgesAt(m);
  for (const ag of edges.filter(e => e.aggregated)) {
    const sum = RM.expandEdge(m, ag.from, ag.to).filter(e => RM.path(m, e.from).includes(ag.from)).reduce((n, e) => n + e.count, 0);
    assert.equal(sum, ag.count, `${ag.from} → ${ag.to}`);
  }
  // Backend ↔ Frontend: 양방향 집계 엣지를 펼치면 위상 정렬로 모든 Task를 지울 수 있다(순환 없음).
  const ex = RM.expandEdge(m, 'S1', 'S2');
  assert.ok(ex.length > 0);
  const left = new Set(ex.flatMap(e => [e.from, e.to]));
  while (left.size) {
    const free = [...left].filter(t => !ex.some(e => e.to === t && left.has(e.from)));
    assert.ok(free.length, '순환');
    free.forEach(t => left.delete(t));
  }
});
