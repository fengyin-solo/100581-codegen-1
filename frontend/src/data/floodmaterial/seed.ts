import type { FloodState } from './types'

// 防汛物资初始数据：两片库、两个库管员、四个库位、四种物资。
// 特意留了一条已批未发的领用单（LYD-2026-0901），用来演示在途占用对定额判定的影响。
export function floodSeed(): FloodState {
  return {
    zones: [
      { code: 'A', name: '城东片库' },
      { code: 'B', name: '城西片库' },
    ],
    keepers: [
      { code: 'K01', name: '王建国', zoneCode: 'A', dutyStart: '08:00', dutyEnd: '20:00' },
      { code: 'K02', name: '李秀兰', zoneCode: 'B', dutyStart: '20:00', dutyEnd: '08:00' },
    ],
    materials: [
      { code: 'M-BZD', name: '编织袋', unit: '条', factor: 1 },
      { code: 'M-SBT', name: '沙袋(吨袋)', unit: '条', factor: 1 },
      { code: 'M-FXJ', name: '防汛橡皮艇', unit: '艘', factor: 1 },
      { code: 'M-JSY', name: '救生衣', unit: '件', factor: 1 },
    ],
    locations: [
      { code: 'A-01', name: '城东1号库位', zoneCode: 'A' },
      { code: 'A-02', name: '城东2号库位', zoneCode: 'A' },
      { code: 'B-01', name: '城西1号库位', zoneCode: 'B' },
      { code: 'B-02', name: '城西2号库位', zoneCode: 'B' },
    ],
    stocks: [
      { locationCode: 'A-01', materialCode: 'M-BZD', available: 1200, quota: 1000, holding: 300 },
      { locationCode: 'A-02', materialCode: 'M-BZD', available: 600, quota: 500, holding: 0 },
      { locationCode: 'A-01', materialCode: 'M-JSY', available: 120, quota: 100, holding: 0 },
      { locationCode: 'A-02', materialCode: 'M-FXJ', available: 6, quota: 4, holding: 0 },
      { locationCode: 'B-01', materialCode: 'M-SBT', available: 300, quota: 200, holding: 0 },
      { locationCode: 'B-02', materialCode: 'M-JSY', available: 80, quota: 100, holding: 0 },
    ],
    vouchers: [
      {
        id: 1,
        docNo: 'RK-2026-0001',
        kind: 'in',
        locationCode: 'A-01',
        materialCode: 'M-BZD',
        delta: 200,
        handler: '王建国',
        happenedAt: '2026-09-20 09:12',
        remark: '市级补充调拨',
      },
      {
        id: 2,
        docNo: 'CK-2026-0001',
        kind: 'out',
        locationCode: 'A-01',
        materialCode: 'M-BZD',
        delta: -100,
        handler: '王建国',
        happenedAt: '2026-09-25 15:40',
        refNo: 'LYD-2026-0831',
        remark: '老护城河段抢险',
      },
    ],
    requisitions: [
      {
        id: 1,
        reqNo: 'LYD-2026-0901',
        zoneCode: 'A',
        materialCode: 'M-BZD',
        qty: 300,
        source: 'dispatcher',
        submitter: '调度室',
        submittedAt: '2026-10-01 09:05',
        status: 'approved',
        decidedAt: '2026-10-01 09:05',
        holdingLeft: 300,
        issued: 0,
        issueLines: [],
      },
    ],
    stocktakes: [],
    alerts: [
      {
        id: 1,
        kind: 'below_quota',
        zoneCode: 'B',
        locationCode: 'B-02',
        materialCode: 'M-JSY',
        message: '城西2号库位 救生衣 可用量 80 件已低于储备定额 100 件，请尽快补充',
        createdAt: '2026-10-02 08:30',
        resolved: false,
      },
    ],
    seq: 100,
  }
}
