// 불러오기 순서: 묶음 전체를 끝까지 접어 검사하고, 통과하면 기본 재생 위치로 다시 접어 그린다.
// 검사에 실패하면 화면을 그리지 않는다(ExecutionEvent 처리 규칙 7).
import { useEffect, useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { RawViewerProvider } from '@/components/raw-viewer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LoadError, loadBundle, type Bundle } from '@/lib/data'
import { parseHash, useHash } from '@/lib/route'
import { CatenaProvider } from '@/lib/store'
import { AgentPage, DagPage, WbsPage } from '@/pages/graphs'
import { ApprovalPage, MilestonePage, PhasePage } from '@/pages/others'
import { OverviewPage } from '@/pages/overview'
import { TaskPage } from '@/pages/task'

function Screen() {
  const hash = useHash()
  const route = parseHash(hash)
  // 중괄호: 최신 브라우저의 scrollTo는 Promise를 돌려주는데, effect가 그 값을 돌려주면 React가 정리 함수로 부른다.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [hash])
  const page = {
    overview: () => <OverviewPage />,
    wbs: () => <WbsPage id={route.id} />,
    dag: () => <DagPage id={route.id} />,
    task: () => <TaskPage id={route.id ?? ''} />,
    agent: () => <AgentPage id={route.id ?? ''} />,
    approval: () => <ApprovalPage id={route.id ?? ''} />,
    phase: () => <PhasePage />,
    milestone: () => <MilestonePage />,
  }[route.view]
  return (
    <AppShell route={route}>
      <div key={hash} className="contents">
        {page()}
      </div>
    </AppShell>
  )
}

export default function App() {
  const [state, setState] = useState<{ bundle?: Bundle; error?: LoadError }>({})
  useEffect(() => {
    loadBundle().then(
      (bundle) => setState({ bundle }),
      (e) => setState({ error: e instanceof LoadError ? e : new LoadError('불러오기 실패', String(e)) }),
    )
  }, [])
  if (state.error)
    return (
      <main className="mx-auto max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{state.error.kind}: 데이터 묶음을 불러오지 않았습니다.</AlertTitle>
          <AlertDescription>
            <p>{state.error.message}</p>
            <p>묶음은 전부 불러오거나 전부 거부합니다(ExecutionEvent 처리 규칙 7).</p>
          </AlertDescription>
        </Alert>
      </main>
    )
  if (!state.bundle)
    return (
      <main className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
        <Spinner /> 데이터 묶음을 불러와 검사하는 중
      </main>
    )
  return (
    <TooltipProvider>
      <CatenaProvider bundle={state.bundle}>
        <RawViewerProvider>
          <Screen />
        </RawViewerProvider>
      </CatenaProvider>
    </TooltipProvider>
  )
}
