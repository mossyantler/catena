// 화면 머리와 구역. academic-assistant의 PageHeader·구역 칸 규칙을 따른다(DESIGN.md).
import { useEffect, type ReactNode } from 'react'

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function PageHeader({ title, tabTitle, eyebrow, description, actions }: {
  title: ReactNode
  tabTitle?: string
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  const tab = tabTitle ?? (typeof title === 'string' ? title : null)
  useEffect(() => {
    if (tab) document.title = `${tab} - Catena`
  }, [tab])
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="mb-1.5 text-xs font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-section font-semibold tracking-tight text-strong lg:text-title">{title}</h1>
        {description ? <p className="mt-2 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

export function Section({ title, description, action, children, className }: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

/** 구역 안 작은 제목. */
export function SubTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold text-muted-foreground">{children}</h3>
}

/** 설명이 아니라 주의를 알리는 한 줄(예: Agent 보고는 증거가 아님). */
export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('border-l-2 border-field pl-3 text-xs text-muted-foreground', className)}>{children}</p>
}

/** 키-값 목록. */
export function KeyValues({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
