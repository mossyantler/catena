// 데이터 묶음(data/) 불러오기. 원문은 받을 때 해시를 다시 계산한다.
import * as RM from '@/lib/rm'
import * as PF from '../../../tools/planfold.ts'

/** origin 'plan'은 Catena 제작 계획이다: plan·accepted가 가리키는 계획 파일과 사람 인수 기록을 읽는다(events.jsonl 없음). */
export type Manifest = { dataset_id?: string; project_id?: string; origin: string; schema_version: number; default_position?: number; description?: string; plan?: string; accepted?: string }
export type RawFile = { ok: true; text: string } | { ok: false; err: string }
/** accepted·accept: 계획 파일의 사람 인수 기록. 이벤트가 아니므로(0-11) 접은 모델에 따로 더한다. */
/** live: 실시간 저장소(?live=)면 그 경로와 마지막 갱신 결과. 갱신이 검사에 실패하면 그 앞까지만 보이고 이유를 남긴다(처리 규칙 7). */
export type Bundle = { manifest: Manifest; events: RM.Event[]; files: Map<string, RawFile>; total: number; accepted?: any[]; accept?: (m: RM.Model) => void;
  live?: { base: string; error?: string } }

/** 네트워크 오류는 '불러오기 실패', 규칙 위반은 '검사 실패'로 나눠 보여 준다. */
export class LoadError extends Error {
  kind: '불러오기 실패' | '검사 실패'
  constructor(kind: LoadError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

// 묶음은 주소 쿼리로 고른다: ?data=expense → data/expense/. 없으면 프로젝트 목록(data/index.json)을 보여 준다.
const PARAMS = new URLSearchParams(window.location.search)
/** 고른 데이터 묶음 이름. 없으면 null(프로젝트 목록). */
export const DATASET = PARAMS.get('data')
/** 실시간으로 볼 Project 저장소(?live=<project_id>, T30). 묶음(?data=)과 함께 쓰지 않는다(C-11). */
export const LIVE = DATASET ? null : PARAMS.get('live')
/** 실시간 Project 화면 주소. */
export const liveHref = (id: string) => `?live=${encodeURIComponent(id)}#overview`
/** 묶음 이름으로 그 프로젝트 화면 주소를 만든다. */
export const datasetHref = (name: string) => `?data=${encodeURIComponent(name)}#overview`
/** 사용자 시험의 비교 기준 화면(?mode=baseline): Task 목록과 실행 로그만 보여 준다. */
export const BASELINE = PARAMS.get('mode') === 'baseline'

// 네트워크 실패는 몇 번 다시 시도하고, 그래도 안 되면 검사 실패와 구분해 알린다.
async function get(url: string, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fetch(url)
    } catch {
      if (i >= tries) throw new LoadError('불러오기 실패', `${url}을(를) 받지 못했습니다(네트워크 오류).`)
    }
  }
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const refCheckOf = (files: Map<string, RawFile>) => (r: RM.Ref) => {
  const f = files.get(r.id.slice(7))
  if (!f) return '원문 파일 없음'
  return f.ok ? undefined : f.err
}

export async function loadBundle(name: string): Promise<Bundle> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new LoadError('불러오기 실패', `묶음 이름은 영문 소문자·숫자·하이픈만 씁니다: ${name}`)
  return loadFrom(`data/${name}/`, `데이터 묶음 ${name}`)
}

/** 실시간 Project 저장소를 묶음과 같은 검사로 불러온다(T30). 출처는 live만 받는다. */
export async function loadLive(id: string): Promise<Bundle> {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id)) throw new LoadError('불러오기 실패', `Project ID에 쓸 수 없는 글자가 있습니다: ${id}`)
  const b = await loadFrom(`live/${id}/`, `Project 저장소 ${id}`)
  if (b.manifest.origin !== 'live') throw new LoadError('검사 실패', `E10: 실시간 저장소의 출처가 live가 아닙니다(${b.manifest.origin}).`)
  return { ...b, live: { base: `live/${id}/` } }
}

// 원문 파일을 받아 해시를 다시 계산한다. 이미 받은 것은 다시 받지 않는다.
async function fetchFiles(base: string, events: RM.Event[], files: Map<string, RawFile>) {
  const hexes = [...new Set(RM.refsOf(events).map((r) => r.id.slice(7)))].filter((h) => !files.has(h))
  await Promise.all(
    hexes.map(async (h) => {
      const res = await get(`${base}artifacts/sha256/${h}`)
      if (!res.ok) return files.set(h, { ok: false, err: '원문 파일 없음' })
      const buf = await res.arrayBuffer()
      const dig = hex(await crypto.subtle.digest('SHA-256', buf))
      files.set(h, dig === h ? { ok: true, text: new TextDecoder().decode(buf) } : { ok: false, err: '해시 불일치' })
    }),
  )
}

/** 실시간 저장소의 새 이벤트를 받아 지금까지 받은 것과 함께 다시 검사한다. 새 이벤트가 없으면 같은 묶음을 돌려준다.
 *  검사에 실패하면 이전 묶음을 그대로 두고 이유만 남긴다(ExecutionEvent 처리 규칙 7: 그 앞까지만 반영, 조용히 건너뛰지 않음). */
export async function refreshLive(b: Bundle): Promise<Bundle> {
  const base = b.live!.base
  try {
    const res = await get(`${base}events.jsonl?after=${b.total}`, 1)
    if (!res.ok) throw new LoadError('불러오기 실패', `${base}events.jsonl: ${res.status}`)
    const fresh = (await res.text()).split('\n').filter(Boolean)
    if (!fresh.length) return b.live!.error ? { ...b, live: { base } } : b
    const events = RM.checkStream(b.manifest, [...b.events.map((e) => JSON.stringify(e)), ...fresh])
    const files = new Map(b.files)
    await fetchFiles(base, events, files)
    RM.foldAll(events, refCheckOf(files))
    return { ...b, events, files, total: events.length, live: { base } }
  } catch (err) {
    const kind = err instanceof LoadError ? err.kind : '검사 실패'
    return { ...b, live: { base, error: `${kind}: ${(err as Error).message}` } }
  }
}

/** 화면 승인·반려(T31): 화면에 보인 제출 기록과 함께 보낸다. 결과는 다음 갱신 때 이벤트로 들어온다. */
export async function decideApproval(b: Bundle, approval_id: string, body: { decision: '승인' | '반려'; comment: string; submission_id: string }) {
  const res = await fetch(`${b.live!.base}approvals/${encodeURIComponent(approval_id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const r = await res.json().catch(() => ({ ok: false, reason: '불러오기 실패', message: `${res.status}` }))
  if (!r.ok) throw new Error(`${r.reason}: ${r.message}`)
}

async function loadFrom(BASE: string, what: string): Promise<Bundle> {
  const mres = await get(BASE + 'dataset.json')
  // 없는 묶음이면 개발 서버가 404 대신 index.html을 돌려주므로 JSON이 아닌 것도 '찾지 못함'으로 본다.
  const manifest: Manifest | undefined = mres.ok ? await mres.json().catch(() => undefined) : undefined
  if (!manifest) throw new LoadError('불러오기 실패', `${what}(dataset.json)을 찾지 못했습니다.`)
  if (manifest.origin === 'plan') return loadPlan(BASE, manifest)
  const text = await (await get(BASE + 'events.jsonl')).text()
  try {
    const events = RM.checkStream(manifest, text.split('\n').filter(Boolean))
    const files = new Map<string, RawFile>()
    await fetchFiles(BASE, events, files)
    RM.foldAll(events, refCheckOf(files)) // 묶음 전체를 먼저 검사한다. 실패하면 아무것도 보여 주지 않는다.
    return { manifest, events, files, total: events.length }
  } catch (err) {
    if (err instanceof LoadError) throw err
    throw new LoadError('검사 실패', (err as Error).message)
  }
}

async function json(base: string, file?: string) {
  const res = file ? await get(base + file) : undefined
  const v = res?.ok ? await res.json().catch(() => undefined) : undefined
  if (!v) throw new LoadError('불러오기 실패', `${base}${file ?? '(파일 이름 없음)'}을(를) 찾지 못했습니다.`)
  return v
}

// Catena 제작 계획: tools/plan.ts와 같은 코드(planfold.ts)로 접는다. 계약 원문의 해시는 미리 계산해 둔다.
async function loadPlan(base: string, manifest: Manifest): Promise<Bundle> {
  const [plan, accepted] = await Promise.all([json(base, manifest.plan), json(base, manifest.accepted)])
  try {
    const texts = [...PF.contractTexts(plan).values()]
    const digest = new Map(await Promise.all(texts.map(async (t) => [t, hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))] as const)))
    const { events, contractHash } = PF.foldPlan(plan, accepted, (t) => digest.get(t)!)
    const files = new Map<string, RawFile>([...digest].map(([text, h]) => [h, { ok: true, text }]))
    return { manifest, events, files, total: events.length, accepted, accept: (m) => PF.acceptAll(m, accepted, contractHash) }
  } catch (err) {
    throw new LoadError('검사 실패', (err as Error).message)
  }
}

/** 프로젝트 목록의 한 줄. 묶음마다 따로 불러와 검사하므로, 하나가 실패해도 나머지는 보인다. */
export type ProjectEntry = { name: string; href: string } & (
  | { ok: true; manifest: Manifest; project: string; accepted: number; total: number; counts: [string, number][] }
  | { ok: false; error: LoadError }
)

/** data/index.json에 적힌 묶음을 모두 불러와 끝까지 접고, 프로젝트 이름과 검증된 완료 조건을 돌려준다. */
export async function listProjects(): Promise<ProjectEntry[]> {
  const index = await json('data/', 'index.json')
  const names: string[] = Array.isArray(index?.datasets) ? index.datasets : []
  // 실시간 저장소 목록은 개발·미리보기 서버에만 있다(게시본에는 없으므로 없으면 건너뛴다)
  const live = await get('live/index.json', 1).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined)
  const ids: string[] = Array.isArray(live?.projects) ? live.projects : []
  const one = (name: string, href: string, load: () => Promise<Bundle>) => async (): Promise<ProjectEntry> => {
      try {
        const b = await load()
        const m = RM.foldAll(b.events, refCheckOf(b.files))
        b.accept?.(m)
        const a = RM.aggregate(m, RM.tasksUnder(m))
        return { name, href, ok: true, manifest: b.manifest, project: m.project.name, accepted: a.acc, total: a.tot, counts: [...a.counts] }
      } catch (e) {
        return { name, href, ok: false, error: e instanceof LoadError ? e : new LoadError('불러오기 실패', String(e)) }
      }
    }
  return Promise.all([...ids.map((id) => one(id, liveHref(id), () => loadLive(id))), ...names.map((n) => one(n, datasetHref(n), () => loadBundle(n)))].map((f) => f()))
}
