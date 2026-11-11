// Task 카드 조각: 목록 행, 공정표 노드, 요약 노드. 값은 모두 RM.card·RM.aggregate에서 온다.
import { ArrowRightLeft, Repeat2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { CountsBar, StageTag, StatusBadge, Tid } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import * as RM from '@/lib/rm'
import { waitLabel } from '@/lib/status'
import { useCatena } from '@/lib/store'
import { cn } from '@/lib/utils'

export function useCard(id: string) {
  const { model } = useCatena()
  const c = RM.card(model, id)
  return { c, w: c.waits[0] as RM.Wait | undefined }
}

export function TaskState({ id, wrap = true }: { id: string; wrap?: boolean }) {
  const { c } = useCard(id)
  return (
    <span className={cn('inline-flex items-center gap-1', wrap ? 'flex-wrap' : 'min-w-0 overflow-hidden')}>
      <StatusBadge state={c.rep} />
      {c.stages.map((s: string) => (
        <StageTag key={s} stage={s} />
      ))}
    </span>
  )
}

export function CondCount({ id }: { id: string }) {
  const { c } = useCard(id)
  return (
    <span>
      <span className="font-mono text-foreground">
        {c.accepted}/{c.total}
      </span>{' '}
      인수{c.passed ? <span className="text-muted-foreground"> · {c.passed} 검증 통과</span> : null}
    </span>
  )
}

/** 첫 번째 차단 이유 한 줄. */
export function BlockText({ id }: { id: string }) {
  const { c, w } = useCard(id)
  if (!w) return <>차단 없음</>
  return (
    <>
      {waitLabel(w)}: {w.resolve}
      {c.waits.length > 1 ? <span className="font-mono"> (외 {c.waits.length - 1}건)</span> : null}
    </>
  )
}

export function ActionText({ id }: { id: string }) {
  const { w } = useCard(id)
  return w ? <>{w.action.actor}: {w.action.text}</> : <>할 일 없음</>
}

export function PhaseTag({ phase }: { phase?: string }) {
  const { phaseName } = useCatena()
  const name = phaseName(phase)
  return name ? <Badge variant="quiet">{name}</Badge> : null
}

/** 목록 행. 데스크톱은 한 줄 네 칸, 폰은 두 줄이다. */
export function TaskRow({ id, extra }: { id: string; extra?: ReactNode }) {
  const { node } = useCatena()
  const n = node(id)
  return (
    <a
      href={`#task-${id}`}
      className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border px-3 py-2.5 transition-colors hover:bg-accent sm:grid-cols-[minmax(11rem,1.3fr)_minmax(7rem,auto)_6rem_minmax(0,2fr)] sm:items-center"
    >
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-xs">
          <Tid id={id} />
          <PhaseTag phase={n.phase} />
        </span>
        <span className="truncate font-medium text-strong">{n.name}</span>
        {extra}
      </span>
      <TaskState id={id} />
      <span className="text-xs text-muted-foreground">
        <CondCount id={id} />
      </span>
      <span className="min-w-0 text-xs">
        <span className="block truncate">
          <BlockText id={id} />
        </span>
        <span className="block truncate text-muted-foreground">
          <ActionText id={id} />
        </span>
      </span>
    </a>
  )
}

/** 공정표 노드 안의 Task 카드(240×112). tag는 선행·후행 같은 관계 표시. */
export function TaskNodeContent({ id, tag, extra }: { id: string; tag?: string; extra?: string }) {
  const { node, model } = useCatena()
  const n = node(id)
  const closed = RM.CLOSED.includes(n.lifecycle)
  if (closed)
    return (
      <>
        <span className="flex items-center gap-1.5">
          <Tid id={id} />
          <Badge variant="muted">{n.lifecycle}</Badge>
        </span>
        <span className="truncate text-sm font-semibold text-strong line-through">{n.name}</span>
        <span className="truncate text-muted-foreground">{n.closedReason ?? ''}</span>
      </>
    )
  const rework = RM.hasRework(model, id)
  return (
    <>
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        <Tid id={id} />
        <PhaseTag phase={n.phase} />
        {rework ? <Repeat2 className="size-3.5 text-muted-foreground" aria-label="수정 반복 있음" /> : null}
        {tag ? <span className="ml-auto shrink-0 font-semibold text-strong">{tag}</span> : null}
      </span>
      <span className="shrink-0 truncate text-sm font-semibold text-strong">{n.name}</span>
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        <TaskState id={id} wrap={false} />
        <span className="ml-auto shrink-0 text-muted-foreground">
          <CondCount id={id} />
        </span>
      </span>
      <span className="shrink-0 truncate text-muted-foreground">
        <BlockText id={id} />
      </span>
      <span className="shrink-0 truncate text-muted-foreground">
        <ActionText id={id} />
      </span>
      {extra ? <span className="shrink-0 truncate text-muted-foreground">{extra}</span> : null}
    </>
  )
}

/** 요약 노드: 하위 Task를 집계한 값. */
export function SummaryNodeContent({ id, ext }: { id: string; ext?: { in: number; out: number } }) {
  const { model, nameOf } = useCatena()
  const tasks = RM.tasksUnder(model, id)
  const a = RM.aggregate(model, tasks)
  const blockers = RM.blocking(model)
  const top = Math.max(0, ...blockers.values())
  const hasTop = top > 0 && tasks.some((t) => blockers.get(t) === top)
  return (
    <>
      <span className="text-muted-foreground">
        요약 노드 · Task <span className="font-mono">{tasks.length}</span>
      </span>
      <span className="truncate text-sm font-semibold text-strong">{nameOf(id)}</span>
      <CountsBar counts={a.counts} legend={false} />
      <span className="truncate text-muted-foreground">
        완료 조건 <span className="font-mono text-foreground">{a.acc}/{a.tot}</span> 인수 · 착수 가능 <span className="font-mono text-foreground">{a.ready}</span>
        {hasTop ? ' · 뒤를 가장 많이 막는 Task 포함' : ''}
      </span>
      <span className={cn('inline-flex items-center gap-1 truncate text-muted-foreground')}>
        <ArrowRightLeft className="size-3" aria-hidden />
        범위 밖 {ext ? `선행 ${ext.in} · 후행 ${ext.out}` : '없음'}
      </span>
    </>
  )
}
