/**
 * 防汛物资调拨模块的领域类型。
 * 与通用 EntryRow 不同：这个模块的账必须落到「库位 × 物资」这一层，
 * 总量只允许由库位流水推导，任何写操作都只能按库位逐条登记。
 */

/** 角色：库管员（只能管自己的片库）或调度室（全局视角）。 */
export type ActorRole = 'keeper' | 'dispatcher'

/** 业务操作的发起上下文。 */
export type Actor = {
  role: ActorRole
  /** 对应 keeper.code；调度室为空。 */
  keeperCode?: string
  name: string
  /** 发起操作的时刻（可由页面上的模拟时钟给定），用于值守时段判定。 */
  now: string
}

export type Zone = {
  code: string
  name: string
}

/** 库管员：绑定一个片库与一段值守时段。 */
export type Keeper = {
  code: string
  name: string
  zoneCode: string
  /** 值守起止，格式 HH:MM，支持跨零点（如 20:00-08:00）。 */
  dutyStart: string
  dutyEnd: string
}

export type Material = {
  code: string
  name: string
  unit: string
  /** 历史盘点折算系数：1 个历史口径单位 = factor 个现用计量单位。 */
  factor: number
}

/** 库位：隶属于片库。 */
export type Location = {
  code: string
  name: string
  zoneCode: string
}

/**
 * 库位账：一个库位号下按物资记可用量与储备定额。
 * 这是全模块唯一的数量来源，页面上没有任何直接修改它的入口，
 * 只能通过 registerVoucher / 导入盘点在 service 内部变更。
 */
export type Stock = {
  locationCode: string
  materialCode: string
  available: number
  quota: number
  /** 该库位上被已批未发领用单占用的在途量。 */
  holding: number
}

export type VoucherKind = 'in' | 'out' | 'stocktake'

/** 出入库流水：逐条按库位登记，必须留经手人与单据号。 */
export type Voucher = {
  id: number
  /** 业务唯一：重复单据号直接挡回。 */
  docNo: string
  kind: VoucherKind
  locationCode: string
  materialCode: string
  /** 入库为正、出库为负、盘点为盘点后结存差值。 */
  delta: number
  handler: string
  happenedAt: string
  /** 出库关联的领用单号；盘点关联的盘点批次号。 */
  refNo?: string
  remark?: string
}

export type RequisitionStatus = 'approved' | 'rejected'

/** 库位级发放记录：只能逐库位出库，不允许一次性改总量。 */
export type IssueLine = {
  id: number
  locationCode: string
  qty: number
  docNo: string
  handler: string
  issuedAt: string
}

/** 领用单：库管员和调度室都可能提交，按单据号做幂等。 */
export type Requisition = {
  id: number
  /** 业务唯一：库管员、调度室谁先提交认谁，后到按重复挡回。 */
  reqNo: string
  zoneCode: string
  materialCode: string
  qty: number
  /** 提交方角色。 */
  source: ActorRole
  submitter: string
  submittedAt: string
  status: RequisitionStatus
  /** 退回时写明还差多少。 */
  shortage?: number
  decidedAt: string
  /** 已批未发的在途占用余量（批准时 = qty，逐库位发放时递减）。 */
  holdingLeft: number
  issued: number
  issueLines: IssueLine[]
}

/** 历史盘点导入的一行，按当时的口径折算成库位可用量与储备定额。 */
export type StocktakeRowInput = {
  locationCode: string
  materialCode: string
  /** 当时口径单位。 */
  legacyUnit: string
  /** 折算系数：历史数量 × factor = 现用单位数量。 */
  factor: number
  physicalQty: number
  bookQuota: number
}

export type StocktakeBatch = {
  id: number
  /** 业务唯一：同一个批次重复导入不生成第二份。 */
  batchNo: string
  stocktakeDate: string
  handler: string
  caliberNote: string
  importedAt: string
  rows: StocktakeRowInput[]
}

export type AlertKind = 'stocktake_diff' | 'requisition_rejected' | 'below_quota'

/** 落到调度室的物资警示。 */
export type MaterialAlert = {
  id: number
  kind: AlertKind
  zoneCode: string
  locationCode?: string
  materialCode: string
  message: string
  createdAt: string
  resolved: boolean
}

export type FloodState = {
  zones: Zone[]
  keepers: Keeper[]
  materials: Material[]
  locations: Location[]
  stocks: Stock[]
  vouchers: Voucher[]
  requisitions: Requisition[]
  stocktakes: StocktakeBatch[]
  alerts: MaterialAlert[]
  seq: number
}

/** 统一的业务结果：挡回类错误都带明确原因，不抛异常给页面。 */
export type ServiceResult<T = unknown> = {
  ok: boolean
  message: string
  /** 重复提交（单据号/领用单号/盘点批次已存在）。 */
  duplicate?: boolean
  /** 越权：非值守时段或跨片库。 */
  forbidden?: boolean
  data?: T
}
