// 그래프 화면: WBS 계층별 공정표(C-1), 선택 범위의 Dependency DAG, Task 안의 Agent Graph.
import { useState, type ReactNode } from 'react'

import { FlowGraph, Legend, LegendItem, type GraphEdge, type GraphNode } from '@/components/flow-graph'
import { Notice, PageHeader, Section } from '@/components/page'
import { RawButton } from '@/components/raw-viewer'
import { StageTag, StatusBadge, Tid } from '@/components/status'
import { SummaryNodeContent, TaskNodeContent } from '@/components/task'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { scc, type LGroup } from '@/lib/graph'
import * as RM from '@/lib/rm'
import { EXECUTOR, hm, profText, type Profile } from '@/lib/status'
import { useCatena } from '@/lib/store'
import { cn } from '@/lib/utils'

const W = 240
/** 전체 의존은 열이 많아 카드를 좁힌다(1440px 창에서 0.9배 이상으로 보이게). */
const W_DAG = 216
const TASK_H = 134
const SUMMARY_H = 136

/** 원본 의존 엣지: 숫자는 후행 Task가 필요로 하는 슬롯 중 인수된 수(명세 Drill-down 1). */
const leafEdge = (e: { from: string; to: string; count: number; accepted: number }): GraphEdge => ({
  id: `${e.from}>${e.to}`,
  from: e.from,
  to: e.to,
  tone: e.accepted < e.count ? 'open' : 'leaf',
  label: `${e.accepted}/${e.count}`,
})

function DepLegend({ children }: { children?: ReactNode }) {
  return (
    <Legend>
      <LegendItem tone="leaf">Task 간 연결. 숫자는 필요한 입력 항목 가운데 검수된 수</LegendItem>
      <LegendItem tone="open">아직 검수되지 않은 입력 항목이 있는 연결</LegendItem>
      {children}
    </Legend>
  )
}

/** 펼칠 대상: 집계 엣지 하나(노드 쌍 하나) 또는 묶음(구성원 쌍 전부). */
type Expand = { title: string; what: string; pairs: [string, string][] }

/** 집계 엣지·묶음 펼치기(집계 엣지 표시 규칙 3): 거기에 묶인 원본 의존만 Task 단위로 보여 준다. */
function ExpandDialog({ open, onClose }: { open: Expand | null; onClose: () => void }) {
  const { model, nameOf } = useCatena()
  const deps = [...new Map((open?.pairs ?? []).flatMap(([a, b]) => RM.expandEdge(model, a, b)).map((e) => [`${e.from}>${e.to}`, e])).values()]
  const ids = [...new Set(deps.flatMap((e) => [e.from, e.to]))].sort()
  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{open ? `${open.title}의 Task 간 연결` : ''}</DialogTitle>
          <DialogDescription>{open?.what}에 묶인 Task 간 연결을 펼쳤습니다. 화살표는 결과가 넘어가는 방향입니다.</DialogDescription>
        </DialogHeader>
        {open ? (
          <FlowGraph
            nodes={ids.map((t) => ({ id: t, w: W_DAG, h: TASK_H, label: `${t} ${nameOf(t)}`, href: `#task-${t}`, content: <TaskNodeContent id={t} /> }))}
            edges={deps.map(leafEdge)}
            labels="head"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------- WBS 계층별 공정표 ----------------
export function WbsPage({ id: idArg }: { id?: string }) {
  const { model, node, nameOf, showClosed } = useCatena()
  const [open, setOpen] = useState<Expand | null>(null)
  const id = idArg && node(idArg)?.kind === 'summary' ? idArg : undefined
  const { children, edges, external } = RM.edgesAt(model, id, showClosed)
  const kids = children.map((c) => node(c)).sort((a, b) => a.order - b.order)

  // 집계 엣지로 서로 오가는 노드는 같은 열에 묶음 테두리로 둔다(공정 관점 절, 집계 엣지 표시 규칙 4).
  // 묶음 안 엣지는 화살표로 그리지 않고 방향별 개수를 묶음에 적는다. 묶음을 누르면 펼친다(2026-11-11 사용자 결정).
  const comp = scc(children, edges)
  const members = new Map<number, string[]>()
  for (const k of kids) members.set(comp.get(k.id)!, [...(members.get(comp.get(k.id)!) ?? []), k.id])
  const together = (m: string[], e: { from: string; to: string }) => m.includes(e.from) && m.includes(e.to)
  const groups: LGroup[] = [...members.values()]
    .filter((m) => m.length > 1)
    .map((m, i) => ({
      id: `grp-${i}`,
      label: '서로 결과를 주고받는 묶음 · 앞뒤 순서 없음',
      members: m,
      note: edges
        .filter((e) => together(m, e))
        .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
        .map((e) => `${nameOf(e.from)} → ${nameOf(e.to)} ${e.count}`)
        .concat('눌러서 Task 간 연결 보기')
        .join(' · '),
    }))
  const bundleOf = (g: LGroup): Expand => ({
    title: `${g.members.map(nameOf).join(' · ')} 묶음`,
    what: '묶음',
    pairs: g.members.flatMap((a, i) => g.members.slice(i + 1).map((b): [string, string] => [a, b])),
  })

  const drawn: GraphEdge[] = edges
    .filter((e) => !groups.some((g) => together(g.members, e)))
    .map((e): GraphEdge => (e.aggregated ? { id: `${e.from}>${e.to}`, from: e.from, to: e.to, tone: 'agg', label: `연결 ${e.count} · 검수 ${e.accepted}` } : leafEdge(e)))
  const edgeOf = (e: GraphEdge): Expand => ({ title: `${nameOf(e.from)} → ${nameOf(e.to)}`, what: '요약 엣지', pairs: [[e.from, e.to]] })
  const nodes: GraphNode[] = kids.map((n) => {
    const ext = external.get(n.id)
    if (n.kind === 'summary')
      return { id: n.id, w: W, h: SUMMARY_H, label: `요약 노드 ${n.name}`, href: `#wbs-${n.id}`, emphasis: ['summary'], content: <SummaryNodeContent id={n.id} ext={ext} /> }
    const closed = RM.CLOSED.includes(n.lifecycle)
    return {
      id: n.id, w: W, h: ext ? TASK_H + 18 : TASK_H, label: `${n.id} ${n.name}`, href: `#task-${n.id}`, emphasis: closed ? ['closed'] : [],
      content: <TaskNodeContent id={n.id} extra={ext ? `범위 밖 선행 Task ${ext.in}개 · 후행 Task ${ext.out}개` : undefined} />,
    }
  })
  const aggs = drawn.filter((e) => e.tone === 'agg')
  const title = id ? nameOf(id) : model.project.name
  return (
    <>
      <PageHeader
        eyebrow="공정표"
        title={`${title} 공정표`}
        description={`하위 항목 ${kids.length}개. 요약 노드는 하위 Task의 현황을 합쳐 보여 줍니다.`}
        actions={
          <Button asChild variant="outline">
            <a href={`#dag${id ? `-${id}` : ''}`}>이 범위의 작업 네트워크 보기</a>
          </Button>
        }
      />
      <DepLegend>
        <LegendItem tone="agg">요약 엣지: 하위 Task 사이의 연결을 합친 선. 실행 순서가 아님</LegendItem>
        <LegendItem>점선 테두리: 서로 결과를 주고받는 묶음. 안쪽에는 화살표 대신 방향별 연결 수</LegendItem>
      </DepLegend>
      {aggs.length || groups.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Task 간 연결 보기(그림에서 엣지나 묶음을 눌러도 됩니다)
          {groups.map((g) => (
            <Button key={g.id} size="xs" variant="outline" onClick={() => setOpen(bundleOf(g))}>
              {bundleOf(g).title}
            </Button>
          ))}
          {aggs.map((e) => (
            <Button key={e.id} size="xs" variant="outline" onClick={() => setOpen(edgeOf(e))}>
              {edgeOf(e).title}
            </Button>
          ))}
        </div>
      ) : null}
      {nodes.length ? (
        <FlowGraph
          nodes={nodes}
          edges={drawn}
          groups={groups}
          onEdgeClick={(eid) => {
            const e = aggs.find((x) => x.id === eid)
            if (e) setOpen(edgeOf(e))
          }}
          onGroupClick={(gid) => setOpen(bundleOf(groups.find((g) => g.id === gid)!))}
        />
      ) : (
        <Notice>하위 항목이 없습니다.</Notice>
      )}
      <ExpandDialog open={open} onClose={() => setOpen(null)} />
    </>
  )
}

// ---------------- 선택 범위의 Dependency DAG ----------------
export function DagPage({ id: idArg }: { id?: string }) {
  const { model, node, nameOf, dagSel: picked, setDagSel: setPicked } = useCatena()
  const id = idArg && node(idArg)?.kind === 'summary' ? idArg : undefined
  const ids = RM.tasksUnder(model, id).sort((a, b) => a.localeCompare(b))
  const sel = picked && ids.includes(picked) ? picked : null
  const rel = sel ? RM.relations(model, sel) : null
  const relTag = (t: string) => (!rel || t === sel ? undefined : rel.ancestors.has(t) ? '선행' : rel.descendants.has(t) ? '후행' : '병렬 가능')
  const blockers = RM.blocking(model)
  const top = Math.max(0, ...blockers.values())
  const onPath = (e: { from: string; to: string }) =>
    !!rel && (((e.to === sel || rel.ancestors.has(e.to)) && rel.ancestors.has(e.from)) || ((e.from === sel || rel.descendants.has(e.from)) && rel.descendants.has(e.to)))
  const edges = RM.taskEdges(model, ids).map((e) => ({ ...leafEdge(e), hi: onPath(e), dim: !!sel && !onPath(e) }))
  const nodes: GraphNode[] = ids.map((t) => ({
    id: t, w: W_DAG, h: TASK_H, label: `${t} ${nameOf(t)}`,
    onSelect: () => setPicked((s) => (s === t ? null : t)),
    pressed: t === sel,
    emphasis: t === sel ? ['selected'] : rel ? ['related'] : [],
    content: <TaskNodeContent id={t} tag={relTag(t) ?? (!sel && top > 0 && blockers.get(t) === top ? '후행 Task 대기 가장 많음' : undefined)} />,
  }))
  const ready = ids.filter((t) => RM.card(model, t).rep === '착수 가능')
  return (
    <>
      <PageHeader
        eyebrow="작업 네트워크"
        title={`${id ? nameOf(id) : model.project.name} 작업 네트워크`}
        description={`Task ${ids.length}개. 지금 시작 가능: ${ready.length ? ready.join(', ') : '없음'}`}
        actions={
          id ? (
            <Button asChild variant="outline">
              <a href={`#wbs-${id}`}>하위 공정표 보기</a>
            </Button>
          ) : null
        }
      />
      {sel && rel ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <span className="min-w-0 flex-1">
            <Tid id={sel} /> <span className="font-semibold text-strong">{nameOf(sel)}</span>
            <span className="text-muted-foreground">
              {' '}
              · 선행 {rel.ancestors.size} · 후행 {rel.descendants.size} · 병렬 가능 {ids.length - 1 - rel.ancestors.size - rel.descendants.size}
            </span>
          </span>
          <Button asChild size="sm">
            <a href={`#task-${sel}`}>Task 상세</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={`#agent-${sel}`}>Agent 그래프</a>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
            선택 해제
          </Button>
        </div>
      ) : (
        <Notice>Task를 고르면 선행·후행·병렬 가능 Task를 카드 오른쪽 위에 표시합니다. 판단은 Task 간 연결로만 합니다.</Notice>
      )}
      <DepLegend>
        <LegendItem>굵은 선: 선택한 Task와 이어진 경로</LegendItem>
      </DepLegend>
      <FlowGraph nodes={nodes} edges={edges} labels="head" minimap={ids.length > 20} />
    </>
  )
}

// ---------------- Agent Graph ----------------
export function AgentPage({ id }: { id: string }) {
  const { model, node } = useCatena()
  const n = node(id)
  const wf = model.workflows.get(id)
  const [picked, setPicked] = useState<string | null>(null)
  if (!n || !wf) return <Notice>Agent 그래프가 없는 Task입니다.</Notice>
  const g = RM.agentGraph(model, id)
  const run = g.run
  const sel: string = picked && wf.nodes.has(picked) ? picked : (g.nodes.find((x: any) => run?.active.has(x.node_id)) ?? g.nodes[0]).node_id
  const nodes: GraphNode[] = g.nodes.map((gn: any) => ({
    id: gn.node_id, w: W, h: gn.profiles.length ? 128 : 110, label: `${gn.name} ${gn.status}`,
    onSelect: () => setPicked(gn.node_id), pressed: gn.node_id === sel,
    emphasis: [...(gn.status === '실행 중' ? (['active'] as const) : []), ...(gn.node_id === sel ? (['selected'] as const) : [])],
    content: (
      <>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <StageTag stage={gn.stage} />
          {EXECUTOR[gn.executor]}
          {gn.role ? ` · ${gn.role}` : ''}
        </span>
        <span className="truncate text-sm font-semibold text-strong">{gn.name}</span>
        <span className="flex items-center gap-1.5">
          <StatusBadge state={gn.status} tone={gn.status === '시작 전' ? 'muted' : undefined} />
          {gn.runs > 1 ? <span className="font-mono text-muted-foreground">{gn.runs}회</span> : null}
        </span>
        <span className="truncate text-muted-foreground">담당 {gn.instances.length ? gn.instances.join(', ') : '없음'}</span>
        {gn.profiles.length ? <span className="truncate text-muted-foreground">{gn.profiles.map((p: Profile) => `도구 ${p.runtime} · 모델 ${p.model}`).join(', ')}</span> : null}
      </>
    ),
  }))
  const edges: GraphEdge[] = g.edges.map((e: any) => ({
    id: `${e.from}>${e.to}`, from: e.from, to: e.to,
    tone: e.kind === '반복' ? 'back' : 'leaf', layout: e.kind !== '반복',
    label: e.kind === '반복' ? e.loops ? `수정 반복 ${e.loops}회` : '수정 반복' : ['분기', '합류'].includes(e.kind) ? e.kind : undefined,
  }))
  const wn = wf.nodes.get(sel)
  const act = RM.nodeActivity(model, id, sel)
  type Line = { at: string; who: ReactNode; body: ReactNode; report?: boolean }
  const timeline: Line[] = [
    ...act.logs.map((l: any) => ({
      at: l.started,
      who: <>{l.actor.role ?? ''} <span className="font-mono">{l.actor.instance}</span>{l.profile ? ` · ${profText(l.profile)}` : ''}</>,
      body: <>{l.iteration}회차 시작{l.finished ? ` · ${hm(l.finished)}에 ${l.result}` : ' · 진행 중'}</>,
    })),
    ...act.acts.map((a: any) => ({
      at: a.at,
      report: a.source === 'Agent 보고',
      who: (
        <>
          {a.actor.role ?? ''} <span className="font-mono">{a.actor.instance}</span> · {a.kind}
          {a.to_instance ? <> → <span className="font-mono">{a.to_instance}</span></> : null}{' '}
          <Badge variant={a.source === 'Agent 보고' ? 'wait' : 'quiet'}>{a.source}{a.source === 'Agent 보고' ? ' · 검수 근거 아님' : ''}</Badge>
        </>
      ),
      body: <>{a.summary} <RawButton refId={a.raw_ref} title={`${a.actor.instance} 활동 원문`} /></>,
    })),
    ...act.subs.map((s: any) => ({
      at: s.at,
      who: <>Catena · 제출 기록</>,
      body: <><span className="font-mono">{s.submission_id}</span>을 검사 대상으로 고정 <RawButton refId={s.diff_ref} title={`${s.submission_id} 변경 내용`} label="변경 내용" /></>,
    })),
    ...act.evs.map((e: any) => ({
      at: e.at,
      who: <>검사 코드 · 검수 근거 <Badge variant="quiet">시스템 기록</Badge></>,
      body: <>{e.condition_id} <StatusBadge state={e.result} /> <RawButton refId={e.raw_log_ref} title={`${e.evidence_id} 검사 로그`} label="로그 보기" /></>,
    })),
    ...act.approvals.map((a: any) => ({
      at: a.requested,
      who: <>승인 요청</>,
      body: <><a href={`#approval-${a.approval_id}`} className="underline-offset-4 hover:underline">{a.approval_id}</a> · {a.decision ? <><StatusBadge state={a.decision} /> {a.comment ?? ''}</> : <StatusBadge state="결정 전" />}</>,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return (
    <>
      <PageHeader
        eyebrow="Agent 그래프"
        title={<><Tid id={id} /> {n.name}</>}
        tabTitle={`${id} Agent 그래프`}
        description={run ? `${run.id} · 실행 ${run.attempt}회차 · ${run.state}${run.reason ? ` (${run.reason})` : ''}` : '아직 실행하지 않아 계획된 단계만 보여 줍니다.'}
        actions={
          <Button asChild variant="outline">
            <a href={`#task-${id}`}>Task 상세</a>
          </Button>
        }
      />
      <Legend>
        <LegendItem>단계 종류: 계획 · 구현 · 검사 · 승인 (프로젝트의 작업 단계와 다름)</LegendItem>
        <LegendItem tone="back">수정 반복: 검사에 실패해 다시 고친 횟수</LegendItem>
        <LegendItem>파란 테두리: 지금 실행 중인 노드</LegendItem>
      </Legend>
      <FlowGraph nodes={nodes} edges={edges} />
      <Section
        title={`${wn.name} 활동 기록`}
        description={`${wn.stage} 단계 · ${EXECUTOR[wn.executor]}${act.cost ? ` · 사용량 $${act.cost.toFixed(2)} (추정값)` : ''}`}
      >
        <Notice>점선 항목은 Agent가 스스로 보고한 내용입니다. 검수 근거가 아니며, 검사 결과와 다를 수 있습니다.</Notice>
        {timeline.length ? (
          <ol className="flex flex-col gap-2">
            {timeline.map((t, i) => (
              <li key={i} className={cn('grid grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2.5', t.report && 'border-dashed border-wait')}>
                <span className="font-mono text-xs text-muted-foreground">{hm(t.at)}</span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-xs text-muted-foreground">{t.who}</span>
                  <span>{t.body}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Notice>아직 기록이 없습니다.</Notice>
        )}
      </Section>
    </>
  )
}
