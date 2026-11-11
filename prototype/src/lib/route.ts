// 해시 라우팅: #overview, #wbs[-id], #dag[-id], #task-<id>, #agent-<id>, #approval-<id>, #phase, #milestone
import { useSyncExternalStore } from 'react'

export type View = 'overview' | 'wbs' | 'dag' | 'task' | 'agent' | 'approval' | 'phase' | 'milestone'
export type Route = { view: View; id?: string }

const VIEWS: View[] = ['overview', 'wbs', 'dag', 'task', 'agent', 'approval', 'phase', 'milestone']

export function parseHash(hash: string): Route {
  const h = decodeURIComponent(hash.replace(/^#/, '')) || 'overview'
  const i = h.indexOf('-')
  const view = (i < 0 ? h : h.slice(0, i)) as View
  return VIEWS.includes(view) ? { view, id: i < 0 ? undefined : h.slice(i + 1) } : { view: 'overview' }
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useHash() {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}

/** 화면 위쪽 탭에서 어느 화면 아래에 있는지(Task·Agent는 공정표 아래, 승인은 개요 아래). */
export const tabOf = (v: View): View => ({ task: 'wbs', agent: 'wbs', approval: 'overview' } as Partial<Record<View, View>>)[v] ?? v
