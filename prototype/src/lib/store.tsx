// 화면 전체가 함께 쓰는 상태: 불러온 묶음, 재생 위치, 그 위치까지 접은 읽기 모델.
// 상태 판단은 하지 않는다. 값은 모두 읽기 모델 질의(@/lib/rm)로 계산한다.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { refCheckOf, type Bundle } from '@/lib/data'
import * as RM from '@/lib/rm'

type Catena = {
  bundle: Bundle
  model: RM.Model
  pos: number
  setPos: (n: number) => void
  showClosed: boolean
  setShowClosed: (b: boolean) => void
  /** 시뮬레이션·기록 재생이면 true. live가 아니면 화면 어디서나 출처를 보인다. */
  sim: boolean
  node: (id: string) => any
  nameOf: (id: string) => string
  phaseName: (phaseId?: string) => string | undefined
}

const Ctx = createContext<Catena | null>(null)

export function CatenaProvider({ bundle, children }: { bundle: Bundle; children: ReactNode }) {
  const [pos, setPos] = useState(() => Math.min(bundle.manifest.default_position ?? bundle.total, bundle.total))
  const [showClosed, setShowClosed] = useState(false)
  const model = useMemo(() => RM.foldAll(bundle.events, refCheckOf(bundle.files), pos), [bundle, pos])
  const value = useMemo<Catena>(
    () => ({
      bundle,
      model,
      pos,
      setPos,
      showClosed,
      setShowClosed,
      sim: bundle.manifest.origin !== 'live',
      node: (id) => model.nodes.get(id),
      nameOf: (id) => model.nodes.get(id)?.name ?? id,
      phaseName: (p) => model.project.phases.find((x: any) => x.phase_id === p)?.name,
    }),
    [bundle, model, pos, showClosed],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCatena() {
  const c = useContext(Ctx)
  if (!c) throw new Error('CatenaProvider 밖에서 useCatena를 썼습니다.')
  return c
}
