// 프로젝트 목록(첫 화면): Catena로 볼 수 있는 프로젝트를 출처와 검증된 완료 조건과 함께 보여 주고 골라 들어가게 한다.
// 프로젝트마다 따로 불러와 검사하고, 고르면 그 프로젝트만 새로 연다. 출처가 다른 데이터를 한 화면에 섞지 않는다(C-11).
import { useEffect, useState } from 'react'

import { PageHeader } from '@/components/page'
import { CountsBar } from '@/components/status'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { datasetHref, listProjects, type ProjectEntry } from '@/lib/data'
import { originLabel } from '@/lib/status'

export function ProjectsPage() {
  const [list, setList] = useState<ProjectEntry[] | Error>()
  useEffect(() => {
    listProjects().then(setList, (e) => setList(e instanceof Error ? e : new Error(String(e))))
  }, [])
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader
        eyebrow="Catena"
        title="프로젝트"
        description="Catena로 볼 수 있는 프로젝트입니다. 출처가 다른 데이터는 섞지 않고 프로젝트마다 따로 엽니다."
      />
      {list instanceof Error ? (
        <Alert variant="destructive">
          <AlertTitle>프로젝트 목록을 불러올 수 없습니다.</AlertTitle>
          <AlertDescription>{list.message}</AlertDescription>
        </Alert>
      ) : !list ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> 프로젝트를 불러와 검사하는 중
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (p.ok ? <ProjectCard key={p.name} p={p} /> : <BrokenCard key={p.name} p={p} />))}
        </div>
      )}
    </main>
  )
}

function ProjectCard({ p }: { p: Extract<ProjectEntry, { ok: true }> }) {
  const m = p.manifest
  return (
    <a href={datasetHref(p.name)} className="block rounded-xl outline-none hover:ring-1 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>{p.project}</CardTitle>
          <CardDescription>
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="wait" title={m.description}>
                {originLabel(m.origin)} · {m.dataset_id}
              </Badge>
              {m.origin === 'plan' ? <span>실행 기록 없음</span> : null}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CountsBar counts={new Map(p.counts)} />
          <p className="text-sm text-muted-foreground">
            검수된 완료 조건 <span className="font-mono text-foreground">{p.accepted} / {p.total}</span>
          </p>
          {m.description ? <p className="line-clamp-3 text-xs text-muted-foreground">{m.description}</p> : null}
        </CardContent>
      </Card>
    </a>
  )
}

function BrokenCard({ p }: { p: Extract<ProjectEntry, { ok: false }> }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>
        {p.error.kind}: {p.name}
      </AlertTitle>
      <AlertDescription>{p.error.message}</AlertDescription>
    </Alert>
  )
}
