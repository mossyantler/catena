// 공정표 배치 시험: roombook의 Task 의존과 최상위 공정표를 ELK로 배치해 겹침과 묶음 규칙을 확인한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { foldBundle } from '../../../tools/fold.ts'
import * as RM from '../../../tools/readmodel.ts'
import { HEAD, layoutGraph, scc, textWidth, type Box } from './graph.ts'

const BUNDLE = join(import.meta.dirname, '..', '..', '..', 'scenarios', 'roombook')
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
/** path의 마지막 두 점. 화살촉 방향은 이 구간 방향이다. */
const tail = (d: string) => {
  const nums = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2] }))
  return [nums[nums.length - 2], nums[nums.length - 1]]
}

test('전체 의존: 노드가 겹치지 않고 모든 엣지에 경로가 있다', async () => {
  const { model } = foldBundle(BUNDLE)
  const ids = RM.tasksUnder(model).sort()
  const edges = RM.taskEdges(model, ids)
  const laid = await layoutGraph(
    ids.map((id) => ({ id, w: 240, h: 112 })),
    edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, label: `${e.accepted}/${e.count}` })),
    [],
    'head',
  )
  const boxes = [...laid.nodes.values()]
  assert.equal(boxes.length, ids.length)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i], boxes[j]), `노드 ${i}·${j} 겹침`)
  for (const [, p] of laid.edges) assert.match(p.d, /^M/)
  // 선은 후행 노드 왼쪽 HEAD 앞에서 수평으로 끝난다. 화살촉이 그 방향 그대로 남은 HEAD를 채운다.
  edges.forEach((e, i) => {
    const [a, z] = tail(laid.edges.get(`e${i}`)!.d)
    const to = laid.nodes.get(e.to)!
    assert.equal(a.y, z.y, `${e.from} → ${e.to} 마지막 구간이 수평이 아님`)
    assert.ok(a.x < z.x, `${e.from} → ${e.to} 마지막 구간이 오른쪽을 향하지 않음`)
    assert.ok(Math.abs(to.x - z.x - HEAD) <= 1.5, `${e.from} → ${e.to} 선 끝 ${z.x}, 노드 ${to.x}`)
  })
  // 엣지 숫자는 후행 노드 앞 포트마다 따로 놓이므로 서로, 그리고 노드와 겹치지 않는다.
  const labels = [...laid.edges.values()].flatMap((p) => (p.label ? [p.label] : []))
  assert.equal(labels.length, edges.length)
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!overlap(labels[i], labels[j]), '엣지 문구 겹침')
  for (const l of labels) for (const b of boxes) assert.ok(!overlap(l, b), '엣지 문구가 노드를 가림')
  // 선행 Task는 후행 Task보다 왼쪽에 있다.
  for (const e of edges) assert.ok(laid.nodes.get(e.from)!.x < laid.nodes.get(e.to)!.x, `${e.from} → ${e.to}`)
})

test('최상위 공정표: 집계 엣지로 서로 오가는 노드는 같은 열의 묶음 안에 있고, 묶음 안 엣지 대신 적은 개수가 노드와 겹치지 않는다', async () => {
  const { model } = foldBundle(BUNDLE)
  const { children, edges } = RM.edgesAt(model, undefined, false)
  const comp = scc(children, edges)
  const members = new Map<number, string[]>()
  for (const id of children) members.set(comp.get(id)!, [...(members.get(comp.get(id)!) ?? []), id])
  const note = 'Backend → Frontend 2 · Frontend → Backend 1 · 눌러서 펼치기'
  const groups = [...members.values()].filter((m) => m.length > 1).map((m, i) => ({ id: `g${i}`, label: '묶음', members: m, note }))
  assert.ok(groups.length > 0, 'roombook 최상위에는 양방향 집계 엣지 묶음이 있다')
  const inside = (a: string, b: string) => groups.some((g) => g.members.includes(a) && g.members.includes(b))
  const laid = await layoutGraph(
    children.map((id) => ({ id, w: 240, h: 112 })),
    edges.filter((e) => !inside(e.from, e.to)).map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to })),
    groups,
  )
  for (const g of groups) {
    // 개수 문구 자리(테두리 안 아래쪽 한 줄)는 비어 있고, 문구가 들어갈 만큼 넓다.
    const box = laid.groups.find((x) => x.id === g.id)!
    assert.equal(box.note, note)
    assert.ok(box.w >= textWidth(note) + 24, '묶음이 개수 문구보다 좁음')
    for (const m of g.members) assert.ok(laid.nodes.get(m)!.y + laid.nodes.get(m)!.h <= box.y + box.h - 26, `${m}이 개수 문구 자리를 가림`)
  }
  for (const g of groups) {
    const xs = new Set(g.members.map((m) => laid.nodes.get(m)!.x))
    assert.equal(xs.size, 1, '묶음 안 노드는 같은 열')
    const box = laid.groups.find((x) => x.id === g.id)!
    for (const m of g.members) {
      const n = laid.nodes.get(m)!
      assert.ok(n.x >= box.x && n.y >= box.y && n.x + n.w <= box.x + box.w && n.y + n.h <= box.y + box.h, '노드가 묶음 테두리 안')
    }
  }
})

test('가운데 문구: ELK가 문구 자리를 만들어 서로 겹치지 않는다', async () => {
  const { model } = foldBundle(BUNDLE)
  const ids = RM.tasksUnder(model).sort()
  const edges = RM.taskEdges(model, ids)
  const laid = await layoutGraph(ids.map((id) => ({ id, w: 240, h: 112 })), edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, label: '의존 2 · 인수 1' })))
  const labels = [...laid.edges.values()].flatMap((p) => (p.label ? [p.label] : []))
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!overlap(labels[i], labels[j]), '엣지 문구 겹침')
})

test('호(반복 엣지): 화살촉 앞에 곧은 구간이 있어 선과 화살촉 방향이 같다', async () => {
  // a → b → c 다음 c → a 반복은 아래쪽 호, 같은 열의 x → y는 오른쪽 호다.
  const laid = await layoutGraph(
    ['a', 'b', 'c', 'x', 'y'].map((id) => ({ id, w: 200, h: 100 })),
    [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'bc', from: 'b', to: 'c' },
      { id: 'back', from: 'c', to: 'a', layout: false },
      { id: 'side', from: 'x', to: 'y', layout: false },
    ],
  )
  // 마지막 명령이 곡선(C)이면 끝 두 좌표가 조절점과 끝점이라 곧은 구간이 없어도 아래 검사를 통과하므로, 직선(L)인지 먼저 본다.
  for (const id of ['back', 'side']) assert.match(laid.edges.get(id)!.d, /C[^LC]+L-?[\d.]+,-?[\d.]+$/, `${id}가 곧은 구간으로 끝나지 않음`)
  const a = laid.nodes.get('a')!
  const [p, z] = tail(laid.edges.get('back')!.d)
  assert.equal(p.x, z.x, '아래쪽 호의 끝 구간이 세로가 아님')
  assert.ok(p.y - z.y >= 10, '아래쪽 호의 끝 곧은 구간이 짧음')
  assert.equal(z.y, a.y + a.h + HEAD, '아래쪽 호가 노드 HEAD 앞에서 끝나지 않음')
  const x = laid.nodes.get('x')!
  const y = laid.nodes.get('y')!
  assert.equal(x.x, y.x, 'x, y는 같은 열')
  const [q, w] = tail(laid.edges.get('side')!.d)
  assert.equal(q.y, w.y, '오른쪽 호의 끝 구간이 가로가 아님')
  assert.ok(q.x - w.x >= 10, '오른쪽 호의 끝 곧은 구간이 짧음')
  assert.equal(w.x, y.x + y.w + HEAD, '오른쪽 호가 노드 HEAD 앞에서 끝나지 않음')
})

test('textWidth: 한글은 영문보다 넓게 어림한다', () => {
  assert.ok(textWidth('슬롯') > textWidth('ab'))
})
