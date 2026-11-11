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

const SCN = join(import.meta.dirname, '..', 'scenarios');
const SRC = join(SCN, 'roombook');
const EXP = join(SCN, 'expense'); // 사용자 시험용 두 번째 시나리오
const CLI = join(import.meta.dirname, 'catena.ts');
// expense의 ID → 같은 자리의 roombook ID. docs/user-test.md의 대응표와 같다.
const TO_ROOMBOOK: Record<string, string> = {
  T01: 'T01', T02: 'T06', T03: 'T07', T04: 'T08', T05: 'T02', T06: 'T03', T07: 'T04', T08: 'T05', T09: 'T09', T10: 'T11', T11: 'T10',
  T12: 'T13', T13: 'T12', T14: 'T14', S1: 'S1', S11: 'S12', S12: 'S11', S121: 'S111', S2: 'S2', S3: 'S3',
};
const readEvents = (dir: string) => readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// 이름과 내용을 뺀 공정 구조. map으로 ID를 바꿔 두 시나리오를 같은 기준에서 비교한다.
// 형제 순서(order)는 일부러 바꿨으므로 비교하지 않는다.
function shape(dir: string, map: (id: string) => string, at?: number) {
  const { model: m } = foldBundle(dir, at);
  const ids = RM.tasksUnder(m);
  const srt = (xs: any[]) => xs.map(x => JSON.stringify(x)).sort();
  return {
    nodes: srt([...m.nodes.values()].map(n => [map(n.id), n.parent ? map(n.parent) : null, n.kind, n.phase ?? null, n.lifecycle])),
    cards: srt(ids.map(id => {
      const c = card(m, id);
      return [map(id), c.rep, c.stages, c.exec, c.acceptance, c.accepted, c.total, c.passed, RM.hasRework(m, id),
        c.waits.map(w => [w.type, w.action.actor, w.source && m.nodes.has(w.source) ? map(w.source) : null]),
        RM.rework(m, id).map(r => [r.round, r.failed.length])];
    })),
    edges: srt([undefined, ...[...m.nodes.values()].filter(n => n.kind === 'summary').map(n => n.id)].map(s =>
      [s && map(s), srt(edgesAt(m, s).edges.map(e => [map(e.from), map(e.to), e.count, e.accepted, e.aggregated]))])),
    taskEdges: srt(RM.taskEdges(m, ids).map(e => [map(e.from), map(e.to), e.count, e.accepted])),
    inbox: RM.inbox(m).map(x => [map(x.id), x.w.type]),
    blocking: srt([...RM.blocking(m)].map(([k, v]) => [map(k), v])),
    milestones: [...m.milestones.values()].map(ms => ms.items.map((it: any) =>
      [map(it.task_id), !!it.slot, it.slot ? m.slotAccepted.has(`${it.task_id}/${it.slot}`) : m.taskAccepted.has(it.task_id)])),
    agents: srt(ids.filter(id => m.workflows.has(id)).map(id => [map(id), RM.agentGraph(m, id).nodes.map((n: any) =>
      [n.stage, n.executor, n.role ?? null, n.status, n.runs, n.instances, n.profiles.map((p: any) => p.runtime)])])),
  };
}

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
  for (const name of ['roombook', 'expense']) {
    const hash = () => createHash('sha256').update(readFileSync(join(SCN, name, 'events.jsonl'))).digest('hex');
    const before = hash();
    execFileSync(process.execPath, [join(SCN, `${name}.build.ts`)]);
    assert.equal(hash(), before, name);
  }
});

test('사용자 시험: 두 번째 시나리오는 검사를 통과하고 roombook과 구조가 같다', () => {
  assert.deepEqual(readEvents(EXP).map(e => e.type), readEvents(SRC).map(e => e.type));
  const toRb = (id: string) => TO_ROOMBOOK[id] ?? assert.fail(`대응표에 없는 ID ${id}`);
  const same = (id: string) => id;
  assert.deepEqual(shape(EXP, toRb), shape(SRC, same));
  // 1일차 끝(수정 반복 Task가 착수하기 직전)에서도 같다.
  const mid = readEvents(SRC).find(e => e.type === 'run.created' && e.payload.run_id === 'R03-1').seq - 1;
  assert.deepEqual(shape(EXP, toRb, mid), shape(SRC, same, mid));
  // 번호를 섞었으므로 같은 자리의 Task 번호가 대부분 다르다(번호를 외워 답하지 못하게).
  const { model: m } = foldBundle(EXP);
  assert.equal(card(m, 'T06').waits[0].type, 'decision');
  assert.equal(card(m, 'T05').waits[0].type, 'approval');
  assert.equal(card(m, 'T13').waits[0].type, 'resource');
  assert.deepEqual(card(m, 'T03').stages, ['구현', '검증']);
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
  // [묶음, 수정 반복 Task, Manager가 나눠 맡긴 Task]
  for (const [dir, T03, T07] of [[SRC, 'T03', 'T07'], [EXP, 'T06', 'T03']]) for (const at of [undefined, 120]) {
    const { model: m, manifest, position, total } = foldBundle(dir, at);
    const cli = (...a: string[]) => JSON.parse(execFileSync(process.execPath, [CLI, ...a, '--bundle', dir, '--json', ...(at ? ['--at', String(at)] : [])], { encoding: 'utf8' }));
    const st = cli('status');
    assert.deepEqual(st.source, { origin: manifest.origin, dataset_id: manifest.dataset_id, position: Math.min(position, total), total });
    const ids = RM.tasksUnder(m);
    assert.deepEqual(st.data.counts, Object.fromEntries(RM.aggregate(m, ids).counts));
    assert.deepEqual(st.data.tasks.map((t: any) => [t.id, t.rep, t.conditions.accepted, t.waits[0]?.type ?? null]),
      ids.map(id => { const c = card(m, id); return [id, c.rep, c.accepted, c.waits[0]?.type ?? null]; }));
    assert.deepEqual(st.data.inbox.map((x: any) => x.task), RM.inbox(m).map(x => x.id));
    assert.deepEqual(cli('graph').data.task_edges, RM.taskEdges(m, RM.tasksUnder(m)));
    assert.deepEqual(cli('show', T03).data.runs.map((r: any) => [r.run_id, r.round, r.failed.length]), RM.rework(m, T03).map(r => [r.run_id, r.round, r.failed.length]));
    assert.deepEqual(cli('agents', T07).data.nodes.map((n: any) => [n.node_id, n.status, n.runs]), RM.agentGraph(m, T07).nodes.map((n: any) => [n.node_id, n.status, n.runs]));
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
