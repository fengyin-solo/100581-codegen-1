/**
 * 防汛物资调拨模块的领域类型。
 * 全部数量按「库位 × 物资」记账，任何出入库都只能逐条落到库位，不设可直接修改的总量。
 */

export type Role = 'keeper' | 'dispatcher'

/** 操作人员档案：库管员绑定负责片库与值守时段，调度室跨片库且全天值守。 */
export interface OperatorProfile {
  name: string
  role: Role
  /** 负责片库；调度室为「调度室」。 */
  zone: string
  shiftLabel: string
  /** 值守起止，HH:mm，end 为 24:00 表示到当天 24 点。 */
  dutyStart: string
  dutyEnd: string
}

/** 物资目录：标准计量单位 + 历史盘点旧口径到标准口径的折算系数。 */
export interface MaterialDef {
  name: string
  unit: string
  /** key 为旧口径单位，value 为 1 个旧口径单位折合多少标准单位。 */
  factors: Record<string, number>
}

/** 片库与其下辖库位号。 */
export interface ZoneDef {
  name: string
  locations: string[]
}

/** 库位账：一个库位号下按物资记可用量与储备定额。 */
export interface LocationStock {
  location: string
  zone: string
  material: string
  unit: string
  available: number
  quota: number
  updatedAt: string
}

export type MoveKind = '入库' | '出库'
export type LedgerSource = 'manual' | 'requisition'

/** 出入库流水：单据号全局唯一，逐条留痕经手人。 */
export interface LedgerEntry {
  id: number
  /** 单据号（出库时若与领用单号相同，表示按该领用单出库核销）。 */
  docNo: string
  kind: MoveKind
  location: string
  zone: string
  material: string
  unit: string
  qty: number
  /** 经手人。 */
  handler: string
  source: LedgerSource
  requisitionNo?: string
  createdAt: string
}

export type RequisitionStatus = '已受理' | '已出库' | '已退回'
export type RequisitionChannel = '库管员' | '调度室'

/** 领用单：同单号先到先得，受理后形成在途占用，出库核销后落账。 */
export interface Requisition {
  id: number
  /** 受理顺序号，单调递增，是「先到的一张」的判定依据。 */
  seq: number
  /** 领用单号，全模块唯一。 */
  docNo: string
  location: string
  zone: string
  material: string
  unit: string
  qty: number
  /** 申领经手人。 */
  applicant: string
  /** 提交方：库管员（片库现场）或调度室。 */
  channel: RequisitionChannel
  status: RequisitionStatus
  /** 退回时写明差多少等原因；受理时为空。 */
  reason: string
  createdAt: string
  outboundDocNo?: string
}

/** 盘点导入的一行原始记录（旧口径）。 */
export interface StocktakeRow {
  location: string
  material: string
  legacyUnit: string
  countedQty: number
  legacyQuota: number
}

/** 盘点导入批次：批号唯一，重复跑不生成第二份。 */
export interface StocktakeBatch {
  batchNo: string
  stockDate: string
  importedAt: string
  importedBy: string
  rows: number
  upserted: number
  /** 盘盈条目数。 */
  surplus: number
  /** 盘亏条目数。 */
  deficit: number
  note: string
}

export type AlertKind = '盘点差异' | '储备预警'
export type AlertLevel = 'info' | 'warning' | 'critical'

/** 调度室物资警示。 */
export interface MaterialAlert {
  id: number
  kind: AlertKind
  level: AlertLevel
  zone: string
  location: string
  material: string
  message: string
  /** 来源单据：盘点批号或领用单号。 */
  source: string
  resolved: boolean
  createdAt: string
}

/** 防汛物资模块独立持久化的整库数据。 */
export interface MaterialDB {
  stocks: LocationStock[]
  ledger: LedgerEntry[]
  requisitions: Requisition[]
  batches: StocktakeBatch[]
  alerts: MaterialAlert[]
  seq: { ledger: number; requisition: number; alert: number }
}
