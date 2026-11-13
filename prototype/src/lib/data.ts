// 데이터 묶음(data/) 불러오기. 원문은 받을 때 해시를 다시 계산한다.
import * as RM from '@/lib/rm'
import * as PF from '../../../tools/planfold.ts'

/** origin 'plan'은 Catena 제작 계획이다: plan·accepted가 가리키는 계획 파일과 사람 인수 기록을 읽는다(events.jsonl 없음). */
export type Manifest = { dataset_id: string; origin: string; schema_version: number; default_position?: number; description?: string; plan?: string; accepted?: string }
export type RawFile = { ok: true; text: string } | { ok: false; err: string }
/** accepted·accept: 계획 파일의 사람 인수 기록. 이벤트가 아니므로(0-11) 접은 모델에 따로 더한다. */
export type Bundle = { manifest: Manifest; events: RM.Event[]; files: Map<string, RawFile>; total: number; accepted?: any[]; accept?: (m: RM.Model) => void }

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
  const BASE = `data/${name}/`
  const mres = await get(BASE + 'dataset.json')
  // 없는 묶음이면 개발 서버가 404 대신 index.html을 돌려주므로 JSON이 아닌 것도 '찾지 못함'으로 본다.
  const manifest: Manifest | undefined = mres.ok ? await mres.json().catch(() => undefined) : undefined
  if (!manifest) throw new LoadError('불러오기 실패', `데이터 묶음 ${name}(dataset.json)을 찾지 못했습니다.`)
  if (manifest.origin === 'plan') return loadPlan(BASE, manifest)
  const text = await (await get(BASE + 'events.jsonl')).text()
  try {
    const events = RM.checkStream(manifest, text.split('\n').filter(Boolean))
    const files = new Map<string, RawFile>()
    const hexes = [...new Set(RM.refsOf(events).map((r) => r.id.slice(7)))]
    await Promise.all(
      hexes.map(async (h) => {
        const res = await get(`${BASE}artifacts/sha256/${h}`)
        if (!res.ok) return files.set(h, { ok: false, err: '원문 파일 없음' })
        const buf = await res.arrayBuffer()
        const dig = hex(await crypto.subtle.digest('SHA-256', buf))
        files.set(h, dig === h ? { ok: true, text: new TextDecoder().decode(buf) } : { ok: false, err: '해시 불일치' })
      }),
    )
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
export type ProjectEntry = { name: string } & (
  | { ok: true; manifest: Manifest; project: string; accepted: number; total: number; counts: [string, number][] }
  | { ok: false; error: LoadError }
)

/** data/index.json에 적힌 묶음을 모두 불러와 끝까지 접고, 프로젝트 이름과 검증된 완료 조건을 돌려준다. */
export async function listProjects(): Promise<ProjectEntry[]> {
  const index = await json('data/', 'index.json')
  const names: string[] = Array.isArray(index?.datasets) ? index.datasets : []
  return Promise.all(
    names.map(async (name): Promise<ProjectEntry> => {
      try {
        const b = await loadBundle(name)
        const m = RM.foldAll(b.events, refCheckOf(b.files))
        b.accept?.(m)
        const a = RM.aggregate(m, RM.tasksUnder(m))
        return { name, ok: true, manifest: b.manifest, project: m.project.name, accepted: a.acc, total: a.tot, counts: [...a.counts] }
      } catch (e) {
        return { name, ok: false, error: e instanceof LoadError ? e : new LoadError('불러오기 실패', String(e)) }
      }
    }),
  )
}
