// 상태 이름 → 색의 뜻(Tone). 색은 이 표에 있는 공정 상태에만 쓴다(DESIGN.md 2절).
import type { Wait } from '@/lib/rm'

export type Tone = 'ok' | 'run' | 'wait' | 'fail' | 'user' | 'ready' | 'muted'

const TONE: Record<string, Tone> = {
  인수됨: 'ok', 성공: 'ok', 통과: 'ok', 승인: 'ok', '사용 가능': 'ok',
  '실행 중': 'run', '검증 통과(인수 대기)': 'run',
  대기: 'wait', '일시 중단': 'wait', 중단: 'wait', '인수 전': 'wait',
  실패: 'fail', '결과 불명': 'fail', '검증 실패': 'fail', skip: 'fail', 미실행: 'fail', 반려: 'fail', 거부: 'fail',
  '검증 중': 'user', '결정 전': 'user',
  '착수 가능': 'ready',
}
export const toneOf = (state: string): Tone => TONE[state] ?? 'muted'

// 화면에 보이는 상태 이름. 읽기 모델의 상태 값(명세 용어)은 그대로 두고 화면 문구만 바꾼다(2026-11-14 문구 결정: 인수→검수, 착수→시작, 검증→검사)
const LABEL: Record<string, string> = {
  인수됨: '검수됨', '인수 전': '검수 전', 미인수: '검수 전', '착수 가능': '시작 가능', '검증 중': '승인 대기',
  '검증 통과(인수 대기)': '검사 통과(검수 대기)', '검증 실패': '검사 실패', 미검증: '확인 전',
}
// Task 대표 상태에만 쓰는 이름. 같은 값이 검사 결과·노드 결과에도 나오므로 따로 둔다
const REP_LABEL: Record<string, string> = { 실패: '실행 실패', 종료: '실행 종료', 취소: '실행 취소', 대기: '대기 중' }
export const label = (state: string, rep = false) => (rep && REP_LABEL[state]) || LABEL[state] || state

/** 색 막대·점처럼 배지가 아닌 곳에 쓰는 배경 클래스(정적 클래스여야 Tailwind가 만든다). */
export const TONE_BG: Record<Tone, string> = {
  ok: 'bg-ok', run: 'bg-run', wait: 'bg-wait', fail: 'bg-fail', user: 'bg-user', ready: 'bg-ready', muted: 'bg-field',
}

export const WAIT_LABEL: Record<string, string> = {
  dependency: '선행 Task 대기', approval: '승인 대기', decision: '결정 필요', resource: '자원 대기', external: '외부 응답 대기', migration: '변경 적용 중', revalidation: '재검증 필요',
}
export const waitLabel = (w: Wait) => WAIT_LABEL[w.type] ?? w.type

export const EXECUTOR: Record<string, string> = { agent: 'Agent', code: '검사 코드', human: '사용자' }

/** 차단 이유에서 해소 행동 화면으로 가는 주소. */
export const waitHref = (taskId: string, w: Wait) =>
  w.type === 'approval' ? `#approval-${w.source}` : w.type === 'dependency' && w.source ? `#task-${w.source}` : `#task-${taskId}`

/** 데이터 출처 표시. plan은 Catena 제작 계획(계획 파일과 사람 인수 기록)이다. */
export const originLabel = (origin: string) => ({ simulated: '시뮬레이션 데이터', recorded: '기록 재생', plan: '계획 파일' })[origin] ?? origin

export const when = (iso?: string) => (iso ? `${+iso.slice(5, 7)}월 ${+iso.slice(8, 10)}일 ${iso.slice(11, 16)}` : '')
export const hm = (iso?: string) => (iso ? iso.slice(11, 16) : '')

export type Profile = { runtime: string; model: string; effort?: string }
export const profText = (p?: Profile) => (p ? `${p.runtime} · ${p.model}` : '')

/** Q8: 가장 최근 Run의 수정 반복 회차와 통과하지 못한 검사 수. */
export const reworkText = (r?: { round: number; failed: unknown[] }) =>
  r ? `Agent ${r.round}회차${r.round > 1 ? ` · 수정 ${r.round - 1}회` : ''}${r.failed.length ? ` · 통과 못 한 검사 ${r.failed.length}` : ''}` : '실행 없음'
