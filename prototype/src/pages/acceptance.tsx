// 검수표(T36): 사람 확인 조건이 남은 Task에 결정을 남기고, 사용자 시험 측정표를 채운다. 어느 기기에서든 Tailscale HTTPS로 연다.
// 결정은 저장소 밖 파일에 남고, 검수 기록(plan/accepted.json)은 Claude가 이 결정을 근거로 적는다.
import { useEffect, useState } from 'react'
import type { Decision, ReviewItem } from '../../../tools/acceptance-types.ts'
import { Notice, PageHeader, Section } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type Row = Record<string, string>
type Sheet = { header: string[]; rows: Row[]; revision: string }
type Data = { items: ReviewItem[]; decisions: Record<string, Decision>; sheet: Sheet }

const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm'
// 대시보드는 같은 기기의 5180 포트다. 측정표의 주소(127.0.0.1)를 지금 연 주소의 기기 이름으로 바꾼다
const dashboard = (path: string) => `${location.protocol}//${location.hostname}:5180${path}`
const toHere = (url: string) => url.replace(/^https?:\/\/127\.0\.0\.1:5180/, `${location.protocol}//${location.hostname}:5180`)

async function put(url: string, body: unknown) {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json()
  if (!res.ok) throw new Error(out.error ?? '저장하지 못했습니다.')
  return out
}

export default function AcceptancePage() {
  const [data, setData] = useState<Data>()
  const [error, setError] = useState('')
  useEffect(() => {
    document.title = '검수표 - Catena'
    fetch('/api/acceptance', { cache: 'no-store' })
      .then(async (r) => (r.ok ? setData(await r.json()) : Promise.reject(new Error('검수표 서버에 연결할 수 없습니다.'))))
      .catch((e) => setError(String(e)))
  }, [])
  if (error) return <main className="mx-auto max-w-3xl p-6"><Alert variant="destructive"><AlertTitle>검수표를 열 수 없습니다.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></main>
  if (!data) return <main className="p-6">검수표를 불러오고 있습니다.</main>
  const now = data.items.filter((i) => i.now)
  const later = data.items.filter((i) => !i.now)
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Catena 제작" title="검수표" description="사용자 확인이 필요한 조건입니다. 결정은 이 컴퓨터의 파일에 남고, 검수 기록은 Claude가 이 결정을 보고 적습니다." />
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href={dashboard('/?data=catena#overview')}>Catena 개발 현황</a></Button>
        <Button asChild variant="outline"><a href="/?review=copy">화면 문구 검토</a></Button>
      </div>
      <Section title={`지금 검수할 것 ${now.length}개`} description="선행 Task가 모두 검수돼 지금 확인할 수 있는 Task입니다.">
        {now.length ? now.map((it) => <ItemCard key={it.task_id} item={it} decisions={data.decisions} />) : <Notice>지금 검수할 Task가 없습니다.</Notice>}
      </Section>
      <SheetForm initial={data.sheet} />
      <Section title={`선행 Task를 기다리는 것 ${later.length}개`} description="선행 Task가 검수되면 위로 올라옵니다.">
        <ul className="flex flex-col gap-2 text-sm">
          {later.map((it) => (
            <li key={it.task_id} className="rounded-lg border px-3 py-2.5">
              <span className="font-medium text-strong">{it.task_id}: {it.name}</span>
              <p className="mt-1 text-xs text-muted-foreground">{it.conditions.map((c) => `${c.id} ${c.text}`).join(' · ')}</p>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}

function ItemCard({ item, decisions }: { item: ReviewItem; decisions: Record<string, Decision> }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-strong">{item.task_id}: {item.name}</span>
        <Button asChild size="sm" variant="outline"><a href={dashboard(`/?data=catena#task-${item.task_id}`)}>Task 상세</a></Button>
      </div>
      <p className="text-sm text-muted-foreground">{item.goal}</p>
      {item.task_id === 'T06' ? <p className="text-sm">아래 사용자 시험 측정표를 채운 뒤 결정을 남겨 주세요.</p> : null}
      {item.task_id === 'T35' ? <p className="text-sm"><a href="/?review=copy" className="underline-offset-4 hover:underline">화면 문구 검토</a>에서 확인한 뒤 결정을 남겨 주세요.</p> : null}
      {item.conditions.map((c) => <DecisionForm key={c.id} id={c.id} text={c.text} saved={decisions[c.id]} />)}
    </div>
  )
}

function DecisionForm({ id, text, saved }: { id: string; text: string; saved?: Decision }) {
  const [cur, setCur] = useState(saved)
  const [note, setNote] = useState(saved?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const save = async (decision: Decision['decision']) => {
    setBusy(true); setMsg('')
    try {
      const r = await put(`/api/acceptance/decision/${id}`, { decision, note, revision: cur?.revision ?? 0 })
      setCur(r); setMsg('저장했습니다.')
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-muted-foreground">{id}</span>
        <span>{text}</span>
        {cur ? <Badge variant={cur.decision === '승인' ? 'ok' : cur.decision === '반려' ? 'fail' : 'wait'}>{cur.decision} · {cur.updatedAt.slice(0, 16).replace('T', ' ')}</Badge> : <Badge variant="muted">결정 전</Badge>}
      </div>
      <textarea rows={2} maxLength={4000} className={fieldClass} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="메모(반려할 때는 이유를 적어 주세요)" aria-label={`${id} 메모`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void save('승인')}>승인</Button>
        <Button disabled={busy} variant="outline" onClick={() => void save('반려')}>반려</Button>
        <Button disabled={busy} variant="outline" onClick={() => void save('보류')}>보류</Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{msg}</span>
      </div>
    </div>
  )
}

const FIELDS: { col: string; label: string; area?: boolean; num?: boolean }[] = [
  { col: '답(요약)', label: '답', area: true }, { col: '판단 이유', label: '판단 이유', area: true },
  { col: '이동 수', label: '이동 수', num: true }, { col: '탐색 시간(초)', label: '탐색 시간(초, 선택)', num: true },
  { col: '막힌 지점', label: '막힌 지점', area: true }, { col: '메모', label: '메모' },
]

function SheetForm({ initial }: { initial: Sheet }) {
  const [sheet, setSheet] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const edit = (i: number, col: string, v: string) => {
    setSheet((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, [col]: v } : r)) }))
    setDirty(true); setMsg('입력 중 · 아직 저장하지 않았습니다.')
  }
  const save = async () => {
    setBusy(true)
    try { setSheet(await put('/api/acceptance/sheet', { revision: sheet.revision, rows: sheet.rows })); setDirty(false); setMsg('측정표를 저장했습니다.') }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const blocks = [...new Set(sheet.rows.map((r) => r['블록']))]
  return (
    <Section title="사용자 시험 측정표 (T06)" description="정답과 오해 유형은 보지 말고 화면만 보고 답합니다. 이동 수는 보이는 화면이나 선택을 바꾼 횟수입니다(스크롤·검색어 입력은 세지 않음).">
      {blocks.map((b) => {
        const rows = sheet.rows.map((r, i) => [r, i] as const).filter(([r]) => r['블록'] === b)
        const first = rows[0][0]
        return (
          <div key={b} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-strong">블록 {b}: {first['방식']} · {first['시나리오']}</span>
              <Button asChild size="sm" variant="outline"><a href={toHere(first['주소'])} target="_blank" rel="noreferrer">이 블록 화면 열기</a></Button>
            </div>
            {rows.map(([r, i]) => (
              <div key={`${b}-${r['과제']}`} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm"><span className="font-mono text-muted-foreground">{r['과제']}</span> {r['과제 문장']}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {FIELDS.map((f) => (
                    <label key={f.col} className="flex flex-col gap-1 text-xs text-muted-foreground">{f.label}
                      {f.area
                        ? <textarea rows={2} maxLength={2000} className={fieldClass} value={r[f.col] ?? ''} disabled={busy} onChange={(e) => edit(i, f.col, e.target.value)} />
                        : <Input inputMode={f.num ? 'numeric' : undefined} value={r[f.col] ?? ''} disabled={busy} onChange={(e) => edit(i, f.col, e.target.value)} />}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !dirty} onClick={() => void save()}>측정표 저장</Button>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{msg}</span>
      </div>
    </Section>
  )
}
