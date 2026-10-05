import { MATERIALS } from './catalog'
import type { LedgerEntry, LocationStock, MaterialDB } from './types'

// 期初库位账：按「库位 × 物资」一条一条记，没有总量账可改。
const OPENING: Array<[string, string, string, number, number]> = [
  // 库位, 片库, 物资, 可用量, 储备定额
  ['KW-A01', '东片库', '编织袋', 1000, 600],
  ['KW-A01', '东片库', '防汛沙箱', 120, 80],
  ['KW-A02', '东片库', '土工布', 500, 300],
  ['KW-A03', '东片库', '抽水泵', 12, 6],
  ['KW-B01', '西片库', '编织袋', 800, 600],
  ['KW-B02', '西片库', '块石', 200, 150],
]

function unitOf(material: string): string {
  return MATERIALS.find((item) => item.name === material)?.unit ?? ''
}

const openingTime = '2026-09-01 08:00:00'

const stocks: LocationStock[] = OPENING.map(([location, zone, material, available, quota]) => ({
  location,
  zone,
  material,
  unit: unitOf(material),
  available,
  quota,
  updatedAt: openingTime,
}))

// 每笔期初库存都有一条入库流水，库管员的领用单与这张账对得上。
const ledger: LedgerEntry[] = OPENING.map(([location, zone, material, available], index) => ({
  id: index + 1,
  docNo: `QC-${location.replace('-', '')}-${String(index + 1).padStart(3, '0')}`,
  kind: '入库',
  location,
  zone,
  material,
  unit: unitOf(material),
  qty: available,
  handler: '期初建账',
  source: 'manual',
  createdAt: openingTime,
}))

// 首次打开播种：无领用单、无盘点批次、无警示，全部留给页面操作产生。
export function buildInitialDB(): MaterialDB {
  return {
    stocks,
    ledger,
    requisitions: [],
    batches: [],
    alerts: [],
    seq: { ledger: ledger.length, requisition: 0, alert: 0 },
  }
}
