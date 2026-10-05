import type { MaterialDef, OperatorProfile, ZoneDef } from './types'

// 片库：库管员负责的库，库位只能落在该片库名下。
export const ZONES: ZoneDef[] = [
  { name: '东片库', locations: ['KW-A01', 'KW-A02', 'KW-A03'] },
  { name: '西片库', locations: ['KW-B01', 'KW-B02', 'KW-B03'] },
]

// 值守时段：库管员只在自己的班内可操作；调度室 00:00-24:00 全天值守。
export const OPERATORS: OperatorProfile[] = [
  { name: '王库管', role: 'keeper', zone: '东片库', shiftLabel: '白班 08:00-20:00', dutyStart: '08:00', dutyEnd: '20:00' },
  { name: '李库管', role: 'keeper', zone: '西片库', shiftLabel: '夜班 20:00-次日08:00', dutyStart: '20:00', dutyEnd: '08:00' },
  { name: '张调度', role: 'dispatcher', zone: '调度室', shiftLabel: '全天值守 00:00-24:00', dutyStart: '00:00', dutyEnd: '24:00' },
]

export const OPERATOR_BY_NAME = new Map(OPERATORS.map((item) => [item.name, item]))

// 物资目录：标准单位为记账口径；factors 登记历史盘点旧口径的折算系数。
export const MATERIALS: MaterialDef[] = [
  { name: '编织袋', unit: '条', factors: { 捆: 50, 条: 1 } },
  { name: '土工布', unit: '平方米', factors: { 卷: 100, 平方米: 1 } },
  { name: '块石', unit: '立方米', factors: { 吨: 0.4, 立方米: 1 } },
  { name: '抽水泵', unit: '台', factors: { 台: 1 } },
  { name: '防汛沙箱', unit: '箱', factors: { 箱: 1 } },
]

export const MATERIAL_BY_NAME = new Map(MATERIALS.map((item) => [item.name, item]))

export const LOCATIONS_ALL = ZONES.flatMap((zone) => zone.locations)

export function zonesOfKeeper(keeper: string): string {
  return OPERATOR_BY_NAME.get(keeper)?.zone ?? ''
}

export function locationZone(location: string): string {
  return ZONES.find((zone) => zone.locations.includes(location))?.name ?? ''
}
