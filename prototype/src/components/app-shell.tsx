// 화면 틀: 왼쪽 사이드바(화면 전환, WBS 트리), 위쪽 띠(위치, Task 찾기, 결정할 일, 데이터 출처와 재생 위치), 떠 있는 본문 판.
import { ChevronsRight, Columns3, Flag, GanttChart, LayoutDashboard, Network, Repeat2 } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'

import { StatusBadge, Tid, ToneDot } from '@/components/status'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import * as RM from '@/lib/rm'
import { tabOf, type Route } from '@/lib/route'
import { reworkText, when } from '@/lib/status'
import { useCatena } from '@/lib/store'

const NAV = [
  { view: 'overview', label: '개요', icon: LayoutDashboard },
  { view: 'wbs', label: 'WBS 공정표', icon: GanttChart },
  { view: 'dag', label: '전체 의존', icon: Network },
  { view: 'phase', label: 'Phase', icon: Columns3 },
  { view: 'milestone', label: 'Milestone', icon: Flag },
] as const

/** 지금 화면이 가리키는 WBS 노드(트리에서 강조). */
function focusOf(route: Route, model: RM.Model) {
  if (['task', 'agent', 'wbs', 'dag'].includes(route.view)) return route.id
  if (route.view === 'approval' && route.id) return model.approvals.get(route.id)?.task
}

function WbsTree({ route }: { route: Route }) {
  const { model, showClosed } = useCatena()
  const sel = focusOf(route, model)
  const kids = (parent?: string) =>
    [...model.nodes.values()].filter((n) => n.parent === parent && (showClosed || !RM.CLOSED.includes(n.lifecycle))).sort((a, b) => a.order - b.order)
  const label = (n: any) => {
    if (n.kind === 'summary') {
      const a = RM.aggregate(model, RM.tasksUnder(model, n.id))
      return (
        <>
          <span className="truncate font-medium">{n.name}</span>
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {a.acc}/{a.tot}
          </span>
        </>
      )
    }
    const closed = RM.CLOSED.includes(n.lifecycle)
    return (
      <>
        <ToneDot state={closed ? n.lifecycle : RM.card(model, n.id).rep} />
        <Tid id={n.id} className="text-xs" />
        <span className={closed ? 'truncate text-muted-foreground line-through' : 'truncate'}>{n.name}</span>
      </>
    )
  }
  const href = (n: any) => (n.kind === 'summary' ? `#wbs-${n.id}` : `#task-${n.id}`)
  const sub = (parent: string): ReactNode => {
    const ns = kids(parent)
    if (!ns.length) return null
    return (
      <SidebarMenuSub>
        {ns.map((n) => (
          <SidebarMenuSubItem key={n.id}>
            <SidebarMenuSubButton asChild isActive={sel === n.id}>
              <a href={href(n)}>{label(n)}</a>
            </SidebarMenuSubButton>
            {n.kind === 'summary' ? sub(n.id) : null}
          </SidebarMenuSubItem>
        ))}
      </SidebarMenuSub>
    )
  }
  return (
    <SidebarMenu>
      {kids(undefined).map((n) => (
        <SidebarMenuItem key={n.id}>
          <SidebarMenuButton asChild isActive={sel === n.id} tooltip={n.name}>
            <a href={href(n)}>{label(n)}</a>
          </SidebarMenuButton>
          {n.kind === 'summary' ? sub(n.id) : null}
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
}

function AppSidebar({ route }: { route: Route }) {
  const { model, showClosed, setShowClosed } = useCatena()
  const { setOpenMobile } = useSidebar()
  const tab = tabOf(route.view)
  // 폰 시트 안의 링크를 누르면 시트를 닫는다(shadcn 사이드바는 스스로 닫지 않는다).
  // 클릭 도중에 시트를 닫으면 링크 이동이 사라지므로 클릭이 끝난 뒤에 닫는다.
  const closeOnLink = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) setTimeout(() => setOpenMobile(false), 0)
  }
  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader onClick={closeOnLink}>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <a href="#overview">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <ChevronsRight className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-semibold text-strong">Catena</span>
                  <span className="truncate text-xs text-muted-foreground">{model.project.name}</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent onClick={closeOnLink}>
        <SidebarGroup>
          <SidebarGroupLabel>화면</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ view, label, icon: Icon }) => (
                <SidebarMenuItem key={view}>
                  <SidebarMenuButton asChild isActive={tab === view}>
                    <a href={`#${view}`} aria-current={tab === view ? 'page' : undefined}>
                      <Icon aria-hidden />
                      {label}
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>WBS</SidebarGroupLabel>
          <SidebarGroupContent>
            <WbsTree route={route} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <label className="flex items-center justify-between gap-2 px-2 text-xs text-muted-foreground">
          닫힌 노드 보기
          <Switch checked={showClosed} onCheckedChange={setShowClosed} />
        </label>
      </SidebarFooter>
    </Sidebar>
  )
}

function Crumbs({ route }: { route: Route }) {
  const { model, node } = useCatena()
  const [open, setOpen] = useState(false)
  const items: { href: string; label: string }[] = [{ href: '#wbs', label: model.project.name }]
  const focus = focusOf(route, model)
  if (focus && node(focus))
    for (const id of RM.path(model, focus)) {
      const n = node(id)
      items.push({ href: n.kind === 'summary' ? `#wbs-${id}` : `#task-${id}`, label: n.kind === 'task' ? `${id} ${n.name}` : n.name })
    }
  const here = { overview: '개요', wbs: '하위 공정표', dag: '의존 관계', task: 'Task 상세', agent: 'Agent Graph', approval: `승인 ${route.id ?? ''}`, phase: 'Phase별', milestone: 'Milestone별' }[route.view]
  const shown: ({ href: string; label: string } | null)[] = items.length > 3 && !open ? [items[0], null, ...items.slice(-2)] : items
  return (
    <nav aria-label="현재 위치" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        {shown.map((it, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            {it ? (
              <a href={it.href} className="truncate hover:text-foreground">
                {it.label}
              </a>
            ) : (
              <Button variant="ghost" size="xs" onClick={() => setOpen(true)} aria-label="가운데 단계 펼치기">
                …
              </Button>
            )}
            <span aria-hidden>›</span>
          </li>
        ))}
        <li className="shrink-0 font-medium text-strong" aria-current="page">
          {here}
        </li>
      </ol>
    </nav>
  )
}

/** Task 찾기: 이름, ID, 상태, Phase로 찾고 수정 반복 여부로 거른다(C-1, Q8). */
function Find() {
  const { model, showClosed, nameOf, phaseName } = useCatena()
  const [q, setQ] = useState('')
  const [rework, setRework] = useState(false)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])
  const query = q.trim().toLowerCase()
  const hits =
    query || rework
      ? RM.tasksUnder(model, undefined, showClosed)
          .filter((id) => {
            if (rework && !RM.hasRework(model, id)) return false
            const c = RM.card(model, id)
            return !query || id.toLowerCase().includes(query) || nameOf(id).toLowerCase().includes(query) || c.rep.includes(q.trim()) || (phaseName(model.nodes.get(id).phase) ?? '').includes(q.trim())
          })
          .slice(0, 8)
      : []
  const done = () => {
    setOpen(false)
    setQ('')
    setRework(false)
  }
  return (
    <div ref={box} className="relative flex items-center gap-2 max-sm:w-full">
      <div className="relative min-w-0 flex-1 sm:w-64">
        <label className="sr-only" htmlFor="find">
          Task 찾기
        </label>
        <Input
          id="find"
          type="search"
          value={q}
          placeholder="Task 찾기: 이름, ID, 상태"
          autoComplete="off"
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) {
              window.location.hash = `#task-${hits[0]}`
              done()
            }
            if (e.key === 'Escape') setOpen(false)
          }}
        />
      </div>
      <Toggle
        variant="outline"
        size="sm"
        pressed={rework}
        onPressedChange={(p) => {
          setRework(p)
          setOpen(true)
        }}
        aria-label="수정 반복 있는 Task만"
      >
        <Repeat2 aria-hidden />
        수정 반복 있음
      </Toggle>
      {open && (query || rework) ? (
        <div className="absolute top-full right-0 left-0 z-20 mt-1 max-h-80 overflow-auto rounded-lg border bg-popover p-1 shadow-lg sm:right-auto sm:w-md">
          {hits.length ? (
            hits.map((id) => (
              <a key={id} href={`#task-${id}`} onClick={done} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                <Tid id={id} className="text-xs" />
                <span className="min-w-0 flex-1 truncate">
                  {nameOf(id)}
                  {rework ? <span className="text-xs text-muted-foreground"> · {reworkText(RM.rework(model, id).at(-1))}</span> : null}
                </span>
                <StatusBadge state={RM.card(model, id).rep} />
              </a>
            ))
          ) : (
            <p className="px-2 py-1.5 text-muted-foreground">찾은 Task가 없습니다</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** 데이터 출처와 재생 위치. 시뮬레이션을 실제 실행처럼 보이게 하지 않는다. */
function Origin() {
  const { bundle, pos, setPos, sim } = useCatena()
  const m = bundle.manifest
  if (!sim) return null
  const last = bundle.events[pos - 1]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="wait" tabIndex={0}>
            {m.origin === 'simulated' ? '시뮬레이션 데이터' : '기록 재생'} · {m.dataset_id}
          </Badge>
        </TooltipTrigger>
        {m.description ? <TooltipContent className="max-w-sm">{m.description}</TooltipContent> : null}
      </Tooltip>
      {/* 폰에서는 막대가 줄 하나를 통째로 쓴다(남은 자리에 끼우면 화면 밖으로 넘친다). */}
      <span className="flex min-w-0 grow basis-full items-center gap-3 sm:basis-auto sm:max-w-xl">
        <label htmlFor="replay" className="shrink-0">
          재생 위치
        </label>
        <Slider id="replay" min={1} max={bundle.total} step={1} value={[pos]} onValueChange={([v]) => setPos(v)} className="min-w-24 flex-1" aria-label="재생 위치" />
      </span>
      <output htmlFor="replay" className="font-mono">
        {pos} / {bundle.total} · {when(last?.occurred_at)}
        {m.origin === 'simulated' ? ' (가상 시각)' : ''}
      </output>
      <Button variant="outline" size="xs" onClick={() => setPos(bundle.total)} disabled={pos === bundle.total}>
        끝으로
      </Button>
    </div>
  )
}

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const { model } = useCatena()
  const todos = RM.inbox(model)
  return (
    // 사이드바는 WBS 트리가 세 단계까지 들어가므로 기본(16rem)보다 넓게 둔다.
    <SidebarProvider style={{ '--sidebar-width': '19rem' } as CSSProperties}>
      <AppSidebar route={route} />
      <SidebarInset>
        <header className="z-10 flex flex-col gap-2.5 border-b bg-background px-4 py-3 lg:sticky lg:top-0 lg:rounded-t-xl lg:px-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SidebarTrigger aria-label="사이드바 열고 닫기" />
            <Separator orientation="vertical" className="h-4" />
            <Crumbs key={`${route.view}-${route.id}`} route={route} />
            <Find />
            <Badge variant="user" asChild>
              <a href="#overview">결정할 일 {todos.length}</a>
            </Badge>
          </div>
          <Origin />
        </header>
        <div className="flex flex-col gap-6 px-4 py-6 lg:px-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
