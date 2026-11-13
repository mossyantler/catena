// 대시보드 문구 첨삭 도구. 제작 공정의 인수나 명세 반영과는 별개다.
import { useEffect, useState } from 'react'
import type { CopyData, CopyDecision, CopyItem, CopyReview } from '../../../tools/copy-review-types.ts'
import { PageHeader, Section } from '@/components/page'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

const decisionNames: Record<CopyDecision, string> = { draft: '검토 중', approved: '확정', keep: '현재 표현 유지', deferred: '보류' }
// 검토하지 않았고, 정한 용어만으로 정해지지도 않은 항목
const needsJudgment = (i: CopyItem, reviews: Record<string, CopyReview>) => !i.basis && (!reviews[i.id] || reviews[i.id].decision === 'draft')
const fieldClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm'

export default function CopyReviewPage() {
  const [data, setData] = useState<CopyData>()
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/copy-review', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('첨삭 서버를 불러올 수 없습니다.')
      setData(await response.json())
    }).catch(e => setError(String(e)))
  }, [])
  if (error) return <main className="mx-auto max-w-3xl p-6"><Alert variant="destructive"><AlertTitle>첨삭 화면을 열 수 없습니다.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert></main>
  if (!data) return <main className="p-6">문구 목록을 불러오고 있습니다.</main>
  return <ReviewWorkspace initial={data} />
}

function ReviewWorkspace({ initial }: { initial: CopyData }) {
  const [data, setData] = useState(initial)
  const [id, setId] = useState(() => initial.items.find(i => i.id === location.hash.slice(1))?.id
    ?? initial.items.find(i => needsJudgment(i, initial.reviews))?.id ?? initial.items[0].id)
  const [category, setCategory] = useState('전체')
  const [filter, setFilter] = useState('판단 필요')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const categories = [...new Set(data.items.map(i => i.category))]
  const shown = data.items.filter(i => (category === '전체' || i.category === category)
    && (filter === '전체' || (filter === '판단 필요' ? needsJudgment(i, data.reviews) : filter === '미검토' ? !data.reviews[i.id] || data.reviews[i.id].decision === 'draft' : data.reviews[i.id]?.decision === 'deferred'))
    && `${i.original} ${i.suggested} ${i.id} ${data.reviews[i.id]?.text ?? ''}`.toLowerCase().includes(query.toLowerCase()))
  const item = data.items.find(i => i.id === id)!
  const index = shown.findIndex(i => i.id === id)
  const reviewed = Object.values(data.reviews).filter(r => ['approved', 'keep'].includes(r.decision)).length
  const deferred = Object.values(data.reviews).filter(r => r.decision === 'deferred').length
  const move = (nextId: string) => { setId(nextId); history.replaceState(null, '', `#${nextId}`); window.scrollTo({ top: 0 }) }
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:px-8">
      <PageHeader eyebrow="Catena · 문구 검토" title="표현을 하나씩 다듬기" description="제안을 직접 고치거나 현재 표현을 유지할 수 있습니다. 저장한 첨삭은 다른 기기에서도 이어서 볼 수 있습니다." />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <span>전체 {data.items.length}개 · 검토 완료 {reviewed}개 · 보류 {deferred}개 · 판단 필요 {data.items.filter(i => needsJudgment(i, data.reviews)).length}개</span>
      </div>
      <p className="text-xs text-muted-foreground">첨삭 기록은 별도 파일에 저장됩니다. 명세와 대시보드에는 아직 적용되지 않습니다. ‘확정’은 이 문구 검토에서의 선택입니다.</p>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">분류
          <select className={fieldClass} value={category} onChange={e => setCategory(e.target.value)}><option>전체</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">검토 상태
          <select className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)}><option>판단 필요</option><option>전체</option><option>미검토</option><option>보류</option></select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">문구 검색
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="예: 인수, CLI, T03" />
        </label>
      </fieldset>
      <Editor key={id} item={item} review={data.reviews[id]} index={data.items.indexOf(item) + 1} total={data.items.length}
        previous={shown[index - 1]?.id} next={shown[index + 1]?.id} busy={busy} setBusy={setBusy} move={move}
        shown={shown} reviews={data.reviews}
        saved={review => setData(d => ({ ...d, reviews: { ...d.reviews, [id]: review } }))} />
    </main>
  )
}

function Editor({ item, review, index, total, previous, next, busy, setBusy, move, saved, shown, reviews }: {
  item: CopyItem; review?: CopyReview; index: number; total: number; previous?: string; next?: string;
  busy: boolean; setBusy: (b: boolean) => void; move: (id: string) => void; saved: (r: CopyReview) => void;
  shown: CopyItem[]; reviews: Record<string, CopyReview>;
}) {
  const draftKey = `catena-copy-draft:${item.id}`
  const [draft] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) ?? 'null')
      return value && typeof value.text === 'string' && typeof value.note === 'string'
        && Object.hasOwn(decisionNames, value.decision) && Number.isSafeInteger(value.revision) ? value as CopyReview : null
    } catch { return null }
  })
  const [text, setText] = useState(draft?.text ?? review?.text ?? item.suggested)
  const [note, setNote] = useState(draft?.note ?? review?.note ?? '')
  const [decision, setDecision] = useState<CopyDecision>(draft?.decision ?? review?.decision ?? 'draft')
  const [revision, setRevision] = useState(draft?.revision ?? review?.revision ?? 0)
  const [dirty, setDirty] = useState(!!draft)
  const [message, setMessage] = useState(draft ? '이 브라우저에 남아 있던 임시 문구를 복원했습니다.' : '')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  async function persist(choice: CopyDecision = decision, target?: string) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (dirty || choice !== decision || !review) {
        const response = await fetch(`/api/copy-review/${item.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, note, decision: choice, revision }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        saved(result); setRevision(result.revision); setDecision(result.decision); setText(result.text); setDirty(false)
        try { localStorage.removeItem(draftKey) } catch { /* 저장한 내용은 서버 파일에 남아 있다. */ }
      }
      setMessage('서버에 저장했습니다.')
      if (target) move(target)
      return true
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다. 입력 내용은 그대로 남아 있습니다.'); return false }
    finally { setBusy(false) }
  }
  const edit = (nextText: string, nextNote: string, nextDecision: CopyDecision) => {
    setText(nextText); setNote(nextNote); setDecision(nextDecision)
    setDirty(true); setMessage('입력 중 · 아직 서버에 저장하지 않았습니다.')
    try { localStorage.setItem(draftKey, JSON.stringify({ text: nextText, note: nextNote, decision: nextDecision, revision })) }
    catch { setError('이 기기에 임시 문구를 보관할 수 없습니다. 저장한 뒤 이동해 주세요.') }
  }
  return (
    <div id="copy-editor" className="flex flex-col gap-4">
      <Section title={`${index} / ${total} · ${item.category}`} description={`${item.id} · ${decisionNames[decision]}`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border p-3"><p className="text-xs text-muted-foreground">현재 표현</p><p className="whitespace-pre-wrap break-words text-base font-medium">{item.original}</p></div>
          <div className="flex flex-col gap-2 rounded-lg border p-3"><p className="text-xs text-muted-foreground">처음 제안한 표현</p><p className="whitespace-pre-wrap break-words text-base">{item.suggested}</p></div>
        </div>
        <p className="text-sm text-muted-foreground">{item.context}</p>
        {item.basis ? <p className="text-sm text-muted-foreground">정한 용어로 정해진 항목입니다: {item.basis}. 검토하지 않아도 이 제안을 씁니다.</p> : null}
        <label className="flex flex-col gap-2 text-sm font-medium" htmlFor="copy-text">내가 쓸 표현
          <textarea id="copy-text" rows={3} maxLength={6000} className={fieldClass} value={text} disabled={busy} onChange={e => edit(e.target.value, note, 'draft')} />
        </label>
        <label className="flex flex-col gap-2 text-sm" htmlFor="copy-note">메모 <span className="text-xs text-muted-foreground">마음에 안 드는 이유나 사용 조건을 적어도 됩니다.</span>
          <textarea id="copy-note" rows={2} maxLength={6000} className={fieldClass} value={note} disabled={busy} onChange={e => edit(text, e.target.value, decision)} />
        </label>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{busy ? '저장하고 있습니다.' : message || (review ? '서버에 저장된 첨삭입니다.' : '표현을 고친 뒤 확정하거나, 현재 표현을 유지하세요.')}</p>
        {revision !== (review?.revision ?? 0) ? <div className="flex flex-col gap-2"><p className="text-sm">다른 기기에서 저장한 문구: {review?.text} · 이 브라우저의 임시 문구와 비교해 주세요.</p><Button variant="outline" disabled={busy} onClick={() => {
          setText(review?.text ?? item.suggested); setNote(review?.note ?? ''); setDecision(review?.decision ?? 'draft'); setRevision(review?.revision ?? 0); setDirty(false); setError(''); setMessage('서버에 저장된 내용으로 되돌렸습니다.'); localStorage.removeItem(draftKey)
        }}>서버에 저장된 내용으로 되돌리기</Button></div> : null}
        {error ? <Alert variant="destructive"><AlertTitle>저장하지 못했습니다.</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !text.trim()} onClick={() => void persist('approved', next)}>{next ? '이 표현으로 확정하고 다음' : '이 표현으로 확정'}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void persist('keep', next)}>현재 표현 유지</Button>
          <Button variant="outline" disabled={busy} onClick={() => void persist('deferred', next)}>보류</Button>
          <Button variant="outline" disabled={busy} onClick={() => void persist()}>저장</Button>
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
          <Button variant="ghost" disabled={busy || !previous} onClick={() => void persist(decision, previous)}>이전 항목</Button>
          <Button variant="ghost" disabled={busy} onClick={() => edit(item.suggested, note, 'draft')}>제안으로 되돌리기</Button>
          <Button variant="ghost" disabled={busy || !next} onClick={() => void persist(decision, next)}>저장하고 다음</Button>
        </div>
      </Section>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={async () => { if (await persist()) location.assign('/api/copy-review/export.md') }}>저장하고 명세용 Markdown 받기</Button>
        <Button variant="outline" disabled={busy} onClick={async () => { if (await persist()) location.assign('/api/copy-review/export.json') }}>저장하고 전체 JSON 받기</Button>
      </div>
      <Section title={`항목 바로 찾기 · ${shown.length}개`} description="분류·상태·검색 조건에 맞는 목록입니다. 다른 항목으로 이동하면 입력 중인 내용을 먼저 저장합니다.">
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {shown.length ? shown.map(i => <Button key={i.id} variant={i.id === item.id ? 'secondary' : 'ghost'} disabled={busy} onClick={() => void persist(decision, i.id)} className="h-auto justify-start py-2">
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1 whitespace-normal text-left"><span className="text-xs text-muted-foreground">{i.id} · {i.category} · {reviews[i.id] ? decisionNames[reviews[i.id].decision] : '미검토'}</span><span className="break-words">{i.original}</span></span>
          </Button>) : <p className="text-sm text-muted-foreground">조건에 맞는 항목이 없습니다. 위에서 분류나 검색어를 바꿔 주세요.</p>}
        </div>
      </Section>
    </div>
  )
}
