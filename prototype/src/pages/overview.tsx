// 개요(Q1): 지금 어디까지 왔고, 무엇이 막혀 있고, 사용자가 무엇을 결정해야 하는가.
import { Notice, PageHeader, Section } from '@/components/page'
import { CountsBar, StatusBadge, Tid } from '@/components/status'
import { TaskRow } from '@/components/task'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import * as RM from '@/lib/rm'
import { waitHref, waitLabel, when } from '@/lib/status'
import { useCatena } from '@/lib/store'

const ORDER = ['실행 중', '실패', '검증 중', '대기', '착수 가능', '인수됨', '계획 중']
const rank = (s: string) => (ORDER.includes(s) ? ORDER.indexOf(s) : ORDER.length)
const byOrder = (a: string, b: string) => rank(a) - rank(b)

export function OverviewPage() {
  const { model, nameOf } = useCatena()
  const ids = RM.tasksUnder(model)
  const a = RM.aggregate(model, ids)
  const todos = RM.inbox(model)
  const blockers = [...RM.blocking(model)].sort((x, y) => y[1] - x[1])
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const r = RM.card(model, id).rep
    groups.set(r, [...(groups.get(r) ?? []), id])
  }
  const counts = new Map([...a.counts].sort((x, y) => byOrder(x[0], y[0])))
  const blockedBy = (src: string) => ids.filter((id) => RM.waitsOf(model, id).some((w) => w.source === src && w.type === 'dependency'))
  return (
    <>
      <PageHeader
        eyebrow={model.project.name}
        title="공정 현황"
        actions={
          <>
            <Button asChild variant="outline">
              <a href="#wbs">공정표</a>
            </Button>
            <Button asChild variant="outline">
              <a href="#dag">작업 네트워크</a>
            </Button>
          </>
        }
      />
      <Section title={`전체 Task ${ids.length}개`} description="상태별 Task 수">
        <CountsBar counts={counts} />
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>검수된 완료 조건</span>
            <span className="font-mono text-sm text-strong">
              {a.acc} / {a.tot}
            </span>
          </div>
          <Progress value={a.tot ? (a.acc / a.tot) * 100 : 0} aria-label="검수된 완료 조건 비율" />
        </div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="검토 대기 중" description="사용자의 조치가 필요합니다.">
          {todos.length ? (
            <ul className="flex flex-col gap-2">
              {todos.map(({ id, w }) => (
                <li key={w.id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge state={waitLabel(w)} tone="user" />
                      <Tid id={id} className="text-xs" />
                      <span className="truncate font-medium text-strong">{nameOf(id)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {w.action.text} · {when(w.raised_at)}부터
                    </p>
                  </div>
                  <Button asChild size="sm">
                    <a href={waitHref(id, w)}>{w.action.screen} 열기</a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Notice>현재 사용자가 처리할 일은 없습니다.</Notice>
          )}
        </Section>
        <Section title="후행 Task가 기다리는 Task" description="선행 Task 때문에 대기 중인 후행 Task 수">
          {blockers.length ? (
            <ul className="flex flex-col gap-2">
              {blockers.map(([src, n]) => (
                <li key={src} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tid id={src} className="text-xs" />
                      <span className="truncate font-medium text-strong">{nameOf(src)}</span>
                      <StatusBadge state={RM.card(model, src).rep} rep />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      후행 Task {n}개 대기: {blockedBy(src).map((t) => `${t} ${nameOf(t)}`).join(', ')}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <a href={`#task-${src}`}>열기</a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <Notice>기다리는 후행 Task가 없습니다.</Notice>
          )}
        </Section>
      </div>
      <Section title="상태별 Task" description="상태가 같은 Task끼리 모아 보여 줍니다.">
        {[...groups]
          .sort((x, y) => byOrder(x[0], y[0]))
          .map(([rep, list]) => (
            <div key={rep} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge state={rep} rep />
                <span className="font-mono text-xs text-muted-foreground">{list.length}</span>
              </div>
              {list.map((id) => (
                <TaskRow key={id} id={id} />
              ))}
            </div>
          ))}
      </Section>
    </>
  )
}
