import { defineStore } from 'pinia'

import { floodState } from '@/data/floodmaterial/store'
import { isOnDuty } from '@/data/floodmaterial/service'
import type { Actor } from '@/data/floodmaterial/types'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function nowText(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 防汛物资工作台的会话：可在库管员/调度室之间切换，并给定一个模拟时刻验证值守规则。
export const useFloodSession = defineStore('flood-session', {
  state: () => ({
    role: 'keeper' as 'keeper' | 'dispatcher',
    keeperCode: 'K01',
    time: nowText(),
  }),
  getters: {
    keeper(state) {
      return floodState().keepers.find((k) => k.code === state.keeperCode)
    },
    onDuty(): boolean {
      if (this.role === 'dispatcher') return true
      const keeper = this.keeper
      return keeper ? isOnDuty(keeper, this.time) : false
    },
    scopeLabel(): string {
      if (this.role === 'dispatcher') return '调度室 · 全部片库'
      const keeper = this.keeper
      const zone = floodState().zones.find((z) => z.code === keeper?.zoneCode)
      return keeper ? `库管员 ${keeper.name} · ${zone?.name ?? ''}（值守 ${keeper.dutyStart}-${keeper.dutyEnd}）` : '未指定库管员'
    },
  },
  actions: {
    setRole(role: 'keeper' | 'dispatcher') {
      this.role = role
    },
    setKeeper(code: string) {
      this.keeperCode = code
    },
    setTime(time: string) {
      this.time = time
    },
    toActor(): Actor {
      if (this.role === 'dispatcher') {
        return { role: 'dispatcher', name: '调度室', now: this.time }
      }
      return {
        role: 'keeper',
        keeperCode: this.keeperCode,
        name: this.keeper?.name ?? '',
        now: this.time,
      }
    },
  },
})
