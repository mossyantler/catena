// 불러오기 순서: 묶음 전체를 끝까지 접어 검사하고, 통과하면 기본 재생 위치로 다시 접어 그린다.
// 검사에 실패하면 화면을 그리지 않는다(ExecutionEvent 처리 규칙 7).
import { lazy, Suspense, useEffect, useRef, useState } from 'react'

import { AppShell } from '@/components/app-shell'
import { RawViewerProvider } from '@/components/raw-viewer'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { BASELINE, DATASET, LIVE, LoadError, loadBundle, loadLive, refreshLive, type Bundle } from '@/lib/data'
import { parseHash, useHash } from '@/lib/route'
import { CatenaProvider } from '@/lib/store'
import { BaselinePage } from '@/pages/baseline'
import { AgentPage, DagPage, WbsPage } from '@/pages/graphs'
import { ApprovalPage, MilestonePage, PhasePage } from '@/pages/others'
import { OverviewPage } from '@/pages/overview'
import { ProjectsPage } from '@/pages/projects'
import { TaskPage } from '@/pages/task'

const CopyReviewPage = lazy(() => import('@/pages/copy-review'))
const AcceptancePage = lazy(() => import('@/pages/acceptance'))

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
  if (new URLSearchParams(location.search).get('review') === 'accept')
    return <Suspense fallback={<main className="p-6">검수표를 불러오고 있습니다.</main>}><AcceptancePage /></Suspense>
  if (new URLSearchParams(location.search).get('review') === 'copy')
    return <Suspense fallback={<main className="p-6">첨삭 화면을 불러오고 있습니다.</main>}><CopyReviewPage /></Suspense>
  // ?data=가 없으면 프로젝트 목록을 연다
  if (!DATASET && !LIVE)
    return (
      <TooltipProvider>
        <ProjectsPage />
      </TooltipProvider>
    )
  return DATASET ? <Project name={DATASET} /> : <Project name={LIVE!} live />
}

function Project({ name, live = false }: { name: string; live?: boolean }) {
  const [state, setState] = useState<{ bundle?: Bundle; error?: LoadError }>({})
  const current = useRef<Bundle | undefined>(undefined)
  useEffect(() => {
    ;(live ? loadLive : loadBundle)(name).then(
      (bundle) => {
        current.current = bundle
        setState({ bundle })
      },
      (e) => setState({ error: e instanceof LoadError ? e : new LoadError('불러오기 실패', String(e)) }),
    )
  }, [name, live])
  // 실시간 저장소: 2초마다 새 이벤트를 받아 같은 검사로 다시 접는다(T30, B-7). 바뀐 것이 있을 때만 다시 그린다
  useEffect(() => {
    if (!live) return
    let busy = false
    const t = setInterval(() => {
      const b = current.current
      if (!b || busy) return
      busy = true
      refreshLive(b)
        .then((next) => {
          if (next === current.current) return
          current.current = next
          setState({ bundle: next })
        })
        .finally(() => (busy = false))
    }, 2000)
    return () => clearInterval(t)
  }, [live])
  if (state.error)
    return (
      <main className="mx-auto max-w-2xl p-6">
        <Alert variant="destructive">
          <AlertTitle>{state.error.kind}: {live ? 'Project 저장소를' : '데이터 묶음을'} 불러올 수 없습니다.</AlertTitle>
          <AlertDescription>
            <p>{state.error.message}</p>
            <p>{state.error.kind === '검사 실패' ? '기록에 규칙 위반이 있어 현황을 표시하지 않았습니다.' : '데이터를 받지 못했습니다.'}</p>
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
        <RawViewerProvider>{BASELINE ? <BaselinePage /> : <Screen />}</RawViewerProvider>
      </CatenaProvider>
    </TooltipProvider>
  )
}
