// 공정표 배치. ELK(layered)로 노드 위치와 엣지 경로를 계산한다. 그리기는 components/flow-graph.tsx가 한다.
// 브라우저와 Node(시험)가 함께 쓰므로 DOM에 기대지 않는다.
import type { ElkExtendedEdge, ElkNode, ElkPoint } from 'elkjs/lib/elk-api.js'

// ELK(1.6MB)는 그래프 화면에 처음 들어갈 때 따로 불러온다. elk.bundled.js는 CommonJS라서
// 번들러(Vite)와 Node가 기본 내보내기를 감싸는 모양이 달라 두 모양을 다 받는다.
type Elk = { layout: (graph: ElkNode) => Promise<ElkNode> }
let elkP: Promise<Elk> | undefined
const getElk = () =>
  (elkP ??= import('elkjs/lib/elk.bundled.js').then((m: any) => {
    const C = m.default?.default ?? m.default ?? m
    return new C() as Elk
  }))

export type LNode = { id: string; w: number; h: number }
/** layout이 false인 엣지는 배치에 쓰지 않고 호로 그린다(Agent Graph의 반복 엣지). */
export type LEdge = { id: string; from: string; to: string; label?: string; layout?: boolean }
/**
 * 같은 열에 세로로 쌓아 테두리로 묶을 노드(명세 공정 관점 절, 집계 엣지 표시 규칙 4).
 * 묶음 안 엣지는 그리지 않는다. note(방향별 개수)는 테두리 안 아래쪽에 적고, 그 자리를 ELK에 미리 잡는다.
 */
export type LGroup = { id: string; label: string; members: string[]; note?: string }
export type Box = { x: number; y: number; w: number; h: number }
export type Laid = {
  width: number
  height: number
  nodes: Map<string, Box>
  groups: (Box & { id: string; label: string; note?: string })[]
  edges: Map<string, { d: string; label?: Box }>
}

const LABEL_PX = 11
const LABEL_H = 16
/** 화살촉 길이. 선은 화살촉 밑변에서 끝나고 화살촉이 원래 끝점까지 채운다(flow-graph.tsx의 marker와 같은 값). */
export const HEAD = 9

/** 엣지 문구 폭 어림값(11px Pretendard). 한글은 글자 폭이 글자 크기와 같고, 숫자와 영문은 그 0.6배다. */
export function textWidth(s: string, px = LABEL_PX) {
  let w = 0
  for (const ch of s) w += /[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? px : ch === ' ' ? px * 0.3 : px * 0.6
  return Math.ceil(w) + 8
}

/** 강하게 연결된 묶음(Tarjan). 반환값은 노드 → 묶음 번호. */
export function scc(ids: string[], edges: { from: string; to: string }[]) {
  let idx = 0
  let c = 0
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const on = new Set<string>()
  const st: string[] = []
  const comp = new Map<string, number>()
  const adj = new Map<string, string[]>(ids.map((i) => [i, []]))
  for (const e of edges) if (adj.has(e.from) && adj.has(e.to)) adj.get(e.from)!.push(e.to)
  const visit = (v: string) => {
    index.set(v, idx)
    low.set(v, idx)
    idx++
    st.push(v)
    on.add(v)
    for (const w of adj.get(v)!) {
      if (!index.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!))
    }
    if (low.get(v) === index.get(v)) {
      let w: string
      do {
        w = st.pop()!
        on.delete(w)
        comp.set(w, c)
      } while (w !== v)
      c++
    }
  }
  for (const v of ids) if (!index.has(v)) visit(v)
  return comp
}

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'ROOT',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.nodeNode': '24',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.spacing.edgeEdge': '12',
  'elk.spacing.edgeNode': '16',
  'elk.spacing.edgeLabel': '4',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // 같은 조건이면 넘겨준 순서(WBS 순서, Task ID 순서)를 지켜 재생 위치를 옮겨도 배치가 덜 흔들린다.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.padding': '[top=16,left=16,bottom=16,right=16]',
}


/** 꺾인 점을 지나는 경로를 모서리를 둥글게 해서 SVG path로 만든다. */
export function roundedPath(pts: ElkPoint[], r = 8) {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]]
    const k = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2)
    const p1 = { x: b.x + ((a.x - b.x) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)) * k, y: b.y + ((a.y - b.y) / (Math.hypot(a.x - b.x, a.y - b.y) || 1)) * k }
    const p2 = { x: b.x + ((c.x - b.x) / (Math.hypot(c.x - b.x, c.y - b.y) || 1)) * k, y: b.y + ((c.y - b.y) / (Math.hypot(c.x - b.x, c.y - b.y) || 1)) * k }
    d += ` L${p1.x},${p1.y} Q${b.x},${b.y} ${p2.x},${p2.y}`
  }
  const z = pts[pts.length - 1]
  return `${d} L${z.x},${z.y}`
}

/** 마지막 점을 마지막 구간 방향으로 len만큼 당긴다. 선 끝이 화살촉 밑변에 닿아 둘의 방향이 같아진다. */
export function trimEnd(pts: ElkPoint[], len = HEAD) {
  if (pts.length < 2) return pts
  const [a, z] = [pts[pts.length - 2], pts[pts.length - 1]]
  const d = Math.hypot(z.x - a.x, z.y - a.y)
  if (d <= len) return pts
  return [...pts.slice(0, -1), { x: z.x - ((z.x - a.x) / d) * len, y: z.y - ((z.y - a.y) / d) * len }]
}

/**
 * labels: 'center'는 ELK가 엣지 가운데에 문구 자리를 만든다(층 사이가 넓어진다).
 * 'head'는 후행 노드에 엣지마다 입력 포트를 따로 주고, 짧은 문구를 화살표 바로 앞에 둔다. 엣지가 많은 그림에 쓴다.
 */
export async function layoutGraph(nodes: LNode[], edges: LEdge[], groups: LGroup[] = [], labels: 'center' | 'head' = 'center'): Promise<Laid> {
  const inGroup = new Map<string, LGroup>()
  for (const g of groups) for (const m of g.members) inGroup.set(m, g)
  const laidOut = edges.filter((e) => e.layout !== false && nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
  const portOf = (e: LEdge) => `${e.id}@in`
  const leaf = (n: LNode): ElkNode =>
    labels === 'head'
      ? {
          id: n.id, width: n.w, height: n.h,
          layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
          ports: laidOut.filter((e) => e.to === n.id).map((e) => ({ id: portOf(e), width: 1, height: 1, layoutOptions: { 'elk.port.side': 'WEST' } })),
        }
      : { id: n.id, width: n.w, height: n.h }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const children: ElkNode[] = []
  const placed = new Set<string>()
  for (const n of nodes) {
    const g = inGroup.get(n.id)
    if (!g) children.push(leaf(n))
    else if (!placed.has(g.id)) {
      placed.add(g.id)
      // note 자리를 테두리 안에 잡지 않으면 ELK가 모르는 자리라 다음 열의 노드나 엣지와 겹친다.
      const lw = g.note ? textWidth(g.note) : 0
      const bottom = lw ? 12 + LABEL_H + 8 : 12
      children.push({
        id: g.id,
        layoutOptions: {
          'elk.padding': `[top=30,left=12,bottom=${bottom},right=12]`,
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${lw + 24}, 0)`,
        },
        children: g.members.filter((m) => byId.has(m)).map((m) => leaf(byId.get(m)!)),
      })
    }
  }
  const elkEdges: ElkExtendedEdge[] = laidOut.map((e) => ({
    id: e.id,
    sources: [e.from],
    targets: [labels === 'head' ? portOf(e) : e.to],
    labels: labels === 'center' && e.label ? [{ text: e.label, width: textWidth(e.label), height: LABEL_H }] : [],
  }))
  const options = labels === 'head' ? { ...OPTIONS, 'elk.spacing.portPort': '22', 'elk.layered.spacing.nodeNodeBetweenLayers': '88', 'elk.layered.spacing.edgeNodeBetweenLayers': '40' } : OPTIONS
  const out: ElkNode = await (await getElk()).layout({ id: 'root', layoutOptions: options, children, edges: elkEdges })

  const boxes = new Map<string, Box>()
  const laidGroups: Laid['groups'] = []
  const walk = (n: ElkNode) => {
    const box = { x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: n.height ?? 0 }
    if (n.children?.length) {
      const g = groups.find((x) => x.id === n.id)
      if (g) laidGroups.push({ ...box, id: g.id, label: g.label, note: g.note })
      n.children.forEach(walk)
    } else boxes.set(n.id, box)
  }
  out.children?.forEach(walk)

  let width = out.width ?? 0
  let height = out.height ?? 0
  const paths = new Map<string, { d: string; label?: Box }>()
  for (const e of out.edges ?? []) {
    const pts = (e.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint])
    const l = e.labels?.[0]
    const text = edges.find((x) => x.id === e.id)?.label
    const end = pts[pts.length - 1]
    const label = l
      ? { x: l.x ?? 0, y: l.y ?? 0, w: l.width ?? 0, h: l.height ?? 0 }
      : labels === 'head' && text && end
        ? { x: end.x - textWidth(text) - 10, y: end.y - LABEL_H - 2, w: textWidth(text), h: LABEL_H }
        : undefined
    paths.set(e.id, { d: roundedPath(trimEnd(pts)), label })
  }
  // 배치에 쓰지 않은 엣지: 같은 열이면 오른쪽 호, 뒤로 가면 아래쪽 호.
  // 곡선은 노드 앞 HEAD + STRAIGHT에서 끝내고, 곧은 STRAIGHT 구간을 지나 HEAD 앞에서 선을 끝낸다.
  // 곡선 끝에 바로 화살촉을 달면 화살촉은 끝점 방향을 따르고 선은 비스듬히 들어와 둘이 어긋나 보인다.
  const STRAIGHT = 10
  for (const e of edges) {
    if (e.layout !== false) continue
    const a = boxes.get(e.from)
    const b = boxes.get(e.to)
    if (!a || !b) continue
    const lw = e.label ? textWidth(e.label) : 0
    if (Math.abs(a.x - b.x) < 1) {
      const x = a.x + a.w
      const y1 = a.y + a.h / 2
      const y2 = b.y + b.h / 2
      const bend = x + 36
      const label = e.label ? { x: bend - 6, y: (y1 + y2) / 2 - LABEL_H / 2, w: lw, h: LABEL_H } : undefined
      paths.set(e.id, { d: `M${x},${y1} C${bend},${y1} ${bend},${y2} ${x + HEAD + STRAIGHT},${y2} L${x + HEAD},${y2}`, label })
      width = Math.max(width, bend + lw + 8)
    } else {
      const x1 = a.x + a.w / 2
      const y1 = a.y + a.h
      const x2 = b.x + b.w / 2
      const y2 = b.y + b.h
      const lowY = Math.max(y1, y2) + 44
      paths.set(e.id, {
        d: `M${x1},${y1} C${x1},${lowY} ${x2},${lowY} ${x2},${y2 + HEAD + STRAIGHT} L${x2},${y2 + HEAD}`,
        label: e.label ? { x: (x1 + x2) / 2 - lw / 2, y: lowY - LABEL_H - 2, w: lw, h: LABEL_H } : undefined,
      })
      height = Math.max(height, lowY + 12)
    }
  }
  return { width, height, nodes: boxes, groups: laidGroups, edges: paths }
}
