import { floodSeed } from './seed'
import type { FloodState } from './types'

// 防汛物资模块单独持久化，键名带模块前缀与版本，避免和通用条目表互相污染。
const STORAGE_KEY = 'drainage-pump:floodmaterial:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): FloodState {
  const fallback = floodSeed()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as FloodState
    // 基础数据以代码为准合并：历史存档缺了新库位/物资时能自动补齐。
    return {
      ...fallback,
      ...parsed,
      zones: fallback.zones,
      keepers: fallback.keepers,
      materials: fallback.materials,
      locations: fallback.locations,
    }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: FloodState | null = null

export function floodState(): FloodState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

/** service 内部所有变更都走这里：改完即落盘，保证两本账合一。 */
export function commitFlood(next: FloodState): FloodState {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  return next
}

export function resetFlood(): FloodState {
  const fresh = floodSeed()
  return commitFlood(fresh)
}

export function floodStorageKey(): string {
  return STORAGE_KEY
}

export function cloneState(): FloodState {
  return clone(floodState())
}
