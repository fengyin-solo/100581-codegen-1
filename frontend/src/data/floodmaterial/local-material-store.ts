import { buildInitialDB } from './seed'
import type { MaterialDB } from './types'

// 防汛物资模块的独立持久化：与通用台账的 drainage-pump:entries 分开存。
const STORAGE_KEY = 'drainage-pump:flood-material'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): MaterialDB {
  const fallback = buildInitialDB()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return { ...fallback, ...(JSON.parse(raw) as MaterialDB) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: MaterialDB | null = null

export function materialDB(): MaterialDB {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveMaterialDB(db: MaterialDB): void {
  cache = db
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  }
}

export function resetMaterialDB(): MaterialDB {
  const fresh = clone(buildInitialDB())
  saveMaterialDB(fresh)
  return fresh
}

export function materialStorageKey(): string {
  return STORAGE_KEY
}
