import { defineStore } from 'pinia'

// 会话：防汛物资模块按「当前操作人员 + 当前时间」判定值守时段与片库权限。
// clockOverride 为 'now' 时用真实时间，也可指定 ISO 字符串模拟白班/夜班/班外。
export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '王库管',
    role: 'keeper' as 'keeper' | 'dispatcher',
    zone: '东片库',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市排水防涝泵站运行与内涝处置管理平台',
    clockOverride: 'now',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setOperator(payload: { name: string; role: 'keeper' | 'dispatcher'; zone: string; shiftLabel: string }) {
      this.operator = payload.name
      this.role = payload.role
      this.zone = payload.zone
      this.shiftLabel = payload.shiftLabel
    },
    setClockOverride(value: string) {
      this.clockOverride = value
    },
  },
})
