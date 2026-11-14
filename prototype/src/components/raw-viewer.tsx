// 원문 보기: transcript 발췌, diff, 검사 로그. 해시를 확인한 원문만 보여 준다.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Ref } from '@/lib/rm'
import { useCatena } from '@/lib/store'

type Open = (ref: Ref, title: string) => void
const Ctx = createContext<Open>(() => {})

export function DiffText({ text }: { text: string }) {
  return (
    <pre className="diff max-h-[60vh] overflow-auto rounded-lg border bg-muted p-3 text-xs whitespace-pre-wrap break-words">
      {text.split('\n').map((l, i) => (
        <span key={i} className={/^(\+\+\+|---|@@)/.test(l) ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : undefined}>
          {l}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

export function RawViewerProvider({ children }: { children: ReactNode }) {
  const { bundle, sim } = useCatena()
  const [shown, setShown] = useState<{ hex: string; title: string } | null>(null)
  const open = useCallback<Open>((ref, title) => setShown({ hex: ref.id.slice(7), title }), [])
  const f = shown ? bundle.files.get(shown.hex) : undefined
  return (
    <Ctx.Provider value={open}>
      {children}
      <Dialog open={!!shown} onOpenChange={(o) => !o && setShown(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{shown?.title}</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{f?.ok ? `sha256:${shown!.hex.slice(0, 12)}… · 해시 확인됨${sim ? ' · 시뮬레이션 원문' : ''}` : (f?.err ?? '원문을 찾을 수 없습니다')}</span>
            </DialogDescription>
          </DialogHeader>
          <DiffText text={f?.ok ? f.text : ''} />
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  )
}

/** 원문 참조가 있을 때만 보이는 작은 링크 버튼. */
export function RawButton({ refId, title, label = '원문 보기' }: { refId?: Ref; title: string; label?: string }) {
  const open = useContext(Ctx)
  if (!refId) return null
  return (
    <Button variant="link" size="xs" className="h-auto px-0" onClick={() => open(refId, title)}>
      {label}
    </Button>
  )
}
