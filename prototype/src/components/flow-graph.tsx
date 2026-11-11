// 공정표 캔버스. 배치는 lib/graph.ts(ELK)가 정하고, React Flow는 확대·이동·미니맵과 그리기만 맡는다.
// 노드는 끌어 옮길 수 없다: 위치는 의존 순서를 뜻하므로 사람이 바꾸면 그림이 사실과 달라진다.
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { Skeleton } from '@/components/ui/skeleton'
import { layoutGraph, type LGroup, type Laid } from '@/lib/graph'
import { cn } from '@/lib/utils'

export type Emphasis = 'selected' | 'related' | 'active' | 'dim' | 'summary' | 'closed'
export type GraphNode = {
  id: string
  w: number
  h: number
  /** 화면 읽기 프로그램이 읽을 이름. */
  label: string
  content: ReactNode
  href?: string
  onSelect?: () => void
  pressed?: boolean
  emphasis?: Emphasis[]
}
/** leaf: 원본 의존(슬롯이 모두 인수됨), open: 원본 의존(인수 안 된 슬롯 있음), agg: 집계 엣지, back: 반복 엣지. */
export type EdgeTone = 'leaf' | 'open' | 'agg' | 'back'
export type GraphEdge = {
  id: string
  from: string
  to: string
  tone: EdgeTone
  label?: string
  both?: boolean
  layout?: boolean
  hi?: boolean
  dim?: boolean
}

type CardData = { node: GraphNode }
type GroupData = { label: string }
type RoutedData = { d: string; label?: string; box?: { x: number; y: number; w: number; h: number }; tone: EdgeTone; both?: boolean; hi?: boolean; dim?: boolean; mk: string }

const EMPHASIS: Record<Emphasis, string> = {
  selected: 'ring-2 ring-primary',
  related: 'border-field',
  active: 'ring-2 ring-run',
  dim: 'opacity-50',
  summary: 'border-4 border-double bg-muted',
  closed: 'opacity-60',
}

function CardNode({ data }: NodeProps<Node<CardData>>) {
  const n = data.node
  const cls = cn(
    'flex size-full flex-col gap-1 overflow-hidden rounded-lg border bg-card p-2.5 text-left text-xs text-card-foreground transition-colors outline-none hover:border-field focus-visible:ring-3 focus-visible:ring-ring/50',
    n.emphasis?.map((e) => EMPHASIS[e]),
  )
  const handles = (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="invisible" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="invisible" />
    </>
  )
  if (n.href)
    return (
      <>
        {handles}
        <a href={n.href} aria-label={n.label} className={cls}>
          {n.content}
        </a>
      </>
    )
  if (n.onSelect)
    return (
      <>
        {handles}
        <button type="button" aria-label={n.label} aria-pressed={n.pressed} onClick={n.onSelect} className={cls}>
          {n.content}
        </button>
      </>
    )
  return (
    <>
      {handles}
      <div aria-label={n.label} className={cls}>
        {n.content}
      </div>
    </>
  )
}

function GroupNode({ data }: NodeProps<Node<GroupData>>) {
  return (
    <div className="relative size-full rounded-xl border border-dashed border-field">
      <span className="absolute top-2 left-3 text-xs text-muted-foreground">{data.label}</span>
    </div>
  )
}

const STROKE: Record<EdgeTone, { cls: string; width: number; dash?: string }> = {
  leaf: { cls: 'stroke-muted-foreground', width: 1.5 },
  open: { cls: 'stroke-wait', width: 1.75 },
  agg: { cls: 'stroke-muted-foreground', width: 3, dash: '7 5' },
  back: { cls: 'stroke-muted-foreground', width: 1.5, dash: '3 4' },
}

function RoutedEdge({ data }: EdgeProps<Edge<RoutedData>>) {
  if (!data) return null
  const s = STROKE[data.tone]
  const mk = `url(#${data.mk}-${data.hi ? 'hi' : data.tone === 'open' ? 'open' : 'base'})`
  return (
    <g className={cn('transition-opacity', data.dim && 'opacity-25')}>
      <path d={data.d} fill="none" className={data.hi ? 'stroke-strong' : s.cls} strokeWidth={data.hi ? 2.25 : s.width} strokeDasharray={s.dash} markerEnd={mk} markerStart={data.both ? mk : undefined} />
      {data.label && data.box ? (
        <g>
          <rect x={data.box.x} y={data.box.y} width={data.box.w} height={data.box.h} rx={4} className="fill-card stroke-border" />
          <text x={data.box.x + data.box.w / 2} y={data.box.y + data.box.h / 2} textAnchor="middle" dominantBaseline="central" className={cn('text-2xs', data.tone === 'open' ? 'fill-wait' : 'fill-foreground')}>
            {data.label}
          </text>
        </g>
      ) : null}
    </g>
  )
}

const noop = () => {}
/** 아래쪽 확대·축소 버튼 띠. 첫 화면은 이 띠를 비워 두어 버튼이 카드를 가리지 않게 한다. */
const CONTROLS_H = 40

/**
 * 첫 화면: 다 들어오면 가운데, 넓으면 0.6배까지 줄이고 그래도 넘치면 왼쪽(공정의 시작)부터 보인다.
 * React Flow의 화면 맞춤은 늘 가운데를 보여 주므로 폰에서는 시작 Task가 잘린다.
 */
function firstView(el: HTMLDivElement | null, L: Laid) {
  const cw = el?.clientWidth ?? 800
  const ch = (el?.clientHeight ?? 400) - CONTROLS_H
  const zoom = Math.max(0.6, Math.min(1, (cw - 16) / L.width, (ch - 16) / L.height))
  const x = L.width * zoom <= cw ? (cw - L.width * zoom) / 2 : 8
  const y = L.width * zoom > cw || L.height * zoom > ch ? 8 : (ch - L.height * zoom) / 2
  return { x, y, zoom }
}
const nodeTypes = { card: CardNode, bundle: GroupNode, bounds: () => <div aria-hidden className="pointer-events-none size-full" /> }
const edgeTypes = { routed: RoutedEdge }

function Markers({ prefix }: { prefix: string }) {
  const m = (id: string, cls: string) => (
    <marker id={`${prefix}-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" className={cls} />
    </marker>
  )
  return (
    <svg aria-hidden className="absolute size-0">
      <defs>
        {m('base', 'fill-muted-foreground')}
        {m('open', 'fill-wait')}
        {m('hi', 'fill-strong')}
      </defs>
    </svg>
  )
}

export function FlowGraph({ nodes, edges, groups = [], labels = 'center', minimap = false, className }: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  groups?: LGroup[]
  /** 엣지 문구 자리: lib/graph.ts layoutGraph의 labels. */
  labels?: 'center' | 'head'
  minimap?: boolean
  className?: string
}) {
  const prefix = `mk${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const box = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  // 배치는 구조(노드 크기, 엣지, 문구, 묶음)가 바뀔 때만 다시 한다.
  const key = JSON.stringify([nodes.map((n) => [n.id, n.w, n.h]), edges.map((e) => [e.id, e.from, e.to, e.label, e.layout]), groups, labels])
  const [laid, setLaid] = useState<{ key: string; laid: Laid } | null>(null)
  useEffect(() => {
    let live = true
    const spec = JSON.parse(key) as [[string, number, number][], [string, string, string, string | undefined, boolean | undefined][], LGroup[], 'center' | 'head']
    layoutGraph(
      spec[0].map(([id, w, h]) => ({ id, w, h })),
      spec[1].map(([id, from, to, label, layout]) => ({ id, from, to, label: label ?? undefined, layout: layout ?? undefined })),
      spec[2],
      spec[3],
    ).then((l) => live && setLaid({ key, laid: l }))
    return () => {
      live = false
    }
  }, [key])
  // 캔버스 폭이 바뀌면(창 크기, 사이드바 접기) 첫 화면 위치를 다시 잡는다.
  useEffect(() => {
    const el = box.current
    if (!el || !laid) return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 2) return
      w = el.clientWidth
      rfRef.current?.setViewport(firstView(el, laid.laid))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [laid])

  const flow = useMemo(() => {
    if (!laid) return null
    const L = laid.laid
    const rfNodes: Node[] = [
      // 화면 맞춤은 노드만 보므로, 호와 엣지 문구까지 담긴 배치 전체 크기를 보이지 않는 노드로 넣는다.
      { id: '__bounds', type: 'bounds', position: { x: 0, y: 0 }, width: L.width, height: L.height, data: {}, zIndex: -2, selectable: false, draggable: false, focusable: false },
      ...L.groups.map((g) => ({ id: g.id, type: 'bundle', position: { x: g.x, y: g.y }, width: g.w, height: g.h, data: { label: g.label }, zIndex: -1, selectable: false, draggable: false, focusable: false })),
      ...nodes.flatMap((n) => {
        const b = L.nodes.get(n.id)
        return b ? [{ id: n.id, type: 'card', position: { x: b.x, y: b.y }, width: n.w, height: n.h, data: { node: n }, selectable: false, draggable: false, focusable: false }] : []
      }),
    ]
    const rfEdges: Edge[] = edges.flatMap((e) => {
      const p = L.edges.get(e.id)
      return p ? [{ id: e.id, source: e.from, target: e.to, type: 'routed', focusable: false, selectable: false, data: { d: p.d, label: e.label, box: p.label, tone: e.tone, both: e.both, hi: e.hi, dim: e.dim, mk: prefix } }] : []
    })
    return { rfNodes, rfEdges, height: Math.round(Math.min(Math.max(L.height + 24 + CONTROLS_H, 280), 720)) }
  }, [laid, nodes, edges, prefix])

  if (!flow) return <Skeleton className={cn('h-72 w-full', className)} />
  return (
    <div ref={box} className={cn('relative h-(--h) max-h-[75svh] w-full overflow-hidden rounded-xl border', className)} style={{ '--h': `${flow.height}px` } as CSSProperties}>
      <Markers prefix={prefix} />
      <ReactFlow
        key={laid!.key}
        nodes={flow.rfNodes}
        edges={flow.rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // 클릭 처리기가 없으면 React Flow가 노드의 포인터 이벤트를 끈다. 실제 동작은 노드 안의 링크·버튼이 한다.
        onNodeClick={noop}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        minZoom={0.35}
        maxZoom={1.5}
        onInit={(rf) => {
          rfRef.current = rf
          rf.setViewport(firstView(box.current, laid!.laid))
        }}
        fitViewOptions={{ padding: 0.04 }}
      >
        <Background variant={BackgroundVariant.Lines} gap={24} />
        <Controls showInteractive={false} orientation="horizontal" aria-label="확대·축소" />
        {minimap ? <MiniMap pannable zoomable className="max-lg:hidden" ariaLabel="미니맵" /> : null}
      </ReactFlow>
    </div>
  )
}

/** 범례의 선 모양. 공정표에서 쓰는 선과 같은 모양을 짧게 그린다. */
export function EdgeSwatch({ tone }: { tone: EdgeTone }) {
  const s = STROKE[tone]
  return (
    <svg width="36" height="10" aria-hidden className="shrink-0">
      <path d="M2,5 L34,5" fill="none" className={s.cls} strokeWidth={s.width} strokeDasharray={s.dash} />
    </svg>
  )
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">{children}</div>
}

export function LegendItem({ tone, children }: { tone?: EdgeTone; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      {tone ? <EdgeSwatch tone={tone} /> : null}
      {children}
    </span>
  )
}
