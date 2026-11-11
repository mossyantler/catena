// 공정표 배치 시험: roombook의 Task 의존과 최상위 공정표를 ELK로 배치해 겹침과 묶음 규칙을 확인한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { foldBundle } from '../../../tools/fold.ts'
import * as RM from '../../../tools/readmodel.ts'
import { layoutGraph, scc, textWidth, type Box } from './graph.ts'

const BUNDLE = join(import.meta.dirname, '..', '..', '..', 'scenarios', 'roombook')
const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

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
  // 엣지 숫자는 후행 노드 앞 포트마다 따로 놓이므로 서로, 그리고 노드와 겹치지 않는다.
  const labels = [...laid.edges.values()].flatMap((p) => (p.label ? [p.label] : []))
  assert.equal(labels.length, edges.length)
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!overlap(labels[i], labels[j]), '엣지 문구 겹침')
  for (const l of labels) for (const b of boxes) assert.ok(!overlap(l, b), '엣지 문구가 노드를 가림')
  // 선행 Task는 후행 Task보다 왼쪽에 있다.
  for (const e of edges) assert.ok(laid.nodes.get(e.from)!.x < laid.nodes.get(e.to)!.x, `${e.from} → ${e.to}`)
})

test('최상위 공정표: 집계 엣지로 서로 오가는 노드는 같은 열의 묶음 안에 있다', async () => {
  const { model } = foldBundle(BUNDLE)
  const { children, edges } = RM.edgesAt(model, undefined, false)
  const comp = scc(children, edges)
  const members = new Map<number, string[]>()
  for (const id of children) members.set(comp.get(id)!, [...(members.get(comp.get(id)!) ?? []), id])
  const groups = [...members.values()].filter((m) => m.length > 1).map((m, i) => ({ id: `g${i}`, label: '묶음', members: m }))
  assert.ok(groups.length > 0, 'roombook 최상위에는 양방향 집계 엣지 묶음이 있다')
  const inside = (a: string, b: string) => groups.some((g) => g.members.includes(a) && g.members.includes(b))
  const laid = await layoutGraph(
    children.map((id) => ({ id, w: 240, h: 112 })),
    edges.map((e, i) => ({ id: `e${i}`, from: e.from, to: e.to, layout: !inside(e.from, e.to), label: inside(e.from, e.to) ? 'Backend → Frontend 2 · Frontend → Backend 1' : undefined })),
    groups,
  )
  // 묶음 안 호의 문구는 묶음 테두리 안에 있고, 어떤 노드도 가리지 않는다.
  for (const [id, p] of laid.edges) {
    if (!p.label) continue
    const g = laid.groups[0]
    assert.ok(p.label.x >= g.x && p.label.x + p.label.w <= g.x + g.w && p.label.y + p.label.h <= g.y + g.h, `${id} 문구가 묶음 밖`)
    for (const b of laid.nodes.values()) assert.ok(!overlap(p.label, b), `${id} 문구가 노드를 가림`)
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

test('textWidth: 한글은 영문보다 넓게 어림한다', () => {
  assert.ok(textWidth('슬롯') > textWidth('ab'))
})
