// 데이터 묶음(data/) 불러오기. 원문은 받을 때 해시를 다시 계산한다.
import * as RM from '@/lib/rm'

export type Manifest = { dataset_id: string; origin: string; schema_version: number; default_position?: number; description?: string }
export type RawFile = { ok: true; text: string } | { ok: false; err: string }
export type Bundle = { manifest: Manifest; events: RM.Event[]; files: Map<string, RawFile>; total: number }

/** 네트워크 오류는 '불러오기 실패', 규칙 위반은 '검사 실패'로 나눠 보여 준다. */
export class LoadError extends Error {
  kind: '불러오기 실패' | '검사 실패'
  constructor(kind: LoadError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

const BASE = 'data/'

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

export async function loadBundle(): Promise<Bundle> {
  const mres = await get(BASE + 'dataset.json')
  if (!mres.ok) throw new LoadError('불러오기 실패', '데이터 묶음(dataset.json)을 찾지 못했습니다.')
  const manifest: Manifest = await mres.json()
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
