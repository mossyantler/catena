// 상태 표시 부품: 상태 배지, 실행 단계, Task ID, 상태별 개수 막대.
import type { CSSProperties } from 'react'

import { Badge } from '@/components/ui/badge'
import { label, stageLabel, TONE_BG, toneOf, type Tone } from '@/lib/status'
import { cn } from '@/lib/utils'

/** rep: Task 대표 상태(실패·종료·취소·대기를 실행 기준 이름으로 보인다) */
export function StatusBadge({ state, tone, rep, className }: { state: string; tone?: Tone; rep?: boolean; className?: string }) {
  return (
    <Badge variant={tone ?? toneOf(state)} className={className}>
      {label(state, rep)}
    </Badge>
  )
}

/** Agent Graph의 실행 단계(계획·구현·검증·승인). Project Phase와 다르므로 색 없이 테두리만. */
export function StageTag({ stage }: { stage: string }) {
  return <Badge variant="quiet">{stageLabel(stage)}</Badge>
}

export function Tid({ id, className }: { id: string; className?: string }) {
  return <span className={cn('shrink-0 font-mono whitespace-nowrap text-muted-foreground', className)}>{id}</span>
}

export function ToneDot({ state, className }: { state: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', TONE_BG[toneOf(state)], className)} />
}

/** 대표 상태별 Task 수를 한 줄 막대로. 길이는 개수 비율이다. */
export function CountsBar({ counts, legend = true, className }: { counts: Map<string, number>; legend?: boolean; className?: string }) {
  const total = [...counts.values()].reduce((s, n) => s + n, 0)
  if (!total) return null
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={[...counts].map(([k, v]) => `${label(k, true)} ${v}`).join(', ')}>
        {[...counts].map(([k, v]) => (
          <span key={k} className={cn('h-full grow-(--n)', TONE_BG[toneOf(k)])} style={{ '--n': v } as CSSProperties} />
        ))}
      </div>
      {legend ? (
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {[...counts].map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <ToneDot state={k} />
            {label(k, true)}
            <span className="font-mono text-foreground">{v}</span>
          </span>
        ))}
      </div>
      ) : null}
    </div>
  )
}
