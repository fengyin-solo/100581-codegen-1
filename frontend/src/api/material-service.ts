import {
  LOCATIONS_ALL,
  MATERIAL_BY_NAME,
  OPERATOR_BY_NAME,
  ZONES,
  locationZone,
} from '@/data/floodmaterial/catalog'
import { materialDB, resetMaterialDB, saveMaterialDB } from '@/data/floodmaterial/local-material-store'
import type {
  AlertKind,
  AlertLevel,
  LedgerEntry,
  MaterialAlert,
  MaterialDB,
  MoveKind,
  OperatorProfile,
  Requisition,
  RequisitionChannel,
  StocktakeRow,
} from '@/data/floodmaterial/types'

/** 服务统一返回：ok=false 表示被业务规则挡下，调用方不得再读列表当成功。 */
export interface MaterialActionResult {
  ok: boolean
  message: string
  duplicated?: boolean
}

export interface StockView {
  location: string
  zone: string
  material: string
  unit: string
  available: number
  quota: number
  /** 在途占用：已受理但尚未出库核销的领用单合计。 */
  occupied: number
  /** 扣掉在途占用后真正还能发的量。 */
  effective: number
  belowQuota: boolean
  updatedAt: string
}

export interface DutyView {
  profile: OperatorProfile
  onDuty: boolean
  nowText: string
}

export interface MaterialSummary {
  created: number
  pending: number
  abnormal: number
  openAlerts: number
  inTransit: number
}

// ---------- 时间与值守 ----------

function resolveNow(override?: string): Date {
  if (override && override !== 'now') {
    return new Date(override)
  }
  return new Date()
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function toMinutes(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number)
  return hour * 60 + minute
}

/** 是否落在值守时段内；跨零点的班（如 20:00-08:00）按回绕处理。 */
export function isOnDuty(profile: OperatorProfile, date: Date): boolean {
  const current = date.getHours() * 60 + date.getMinutes()
  const start = toMinutes(profile.dutyStart)
  const end = profile.dutyEnd === '24:00' ? 24 * 60 : toMinutes(profile.dutyEnd)
  if (start <= end) {
    return current >= start && current < end
  }
  return current >= start || current < end
}

function requireOperator(actorName: string): OperatorProfile {
  const profile = OPERATOR_BY_NAME.get(actorName)
  if (!profile) {
    throw new Error(`没有登记操作人员「${actorName}」`)
  }
  return profile
}

export function dutyView(actorName: string, clockOverride?: string): DutyView {
  const profile = requireOperator(actorName)
  const now = resolveNow(clockOverride)
  return { profile, onDuty: isOnDuty(profile, now), nowText: formatDateTime(now) }
}

// ---------- 库位账 ----------

function stockIndex(db: MaterialDB, location: string, material: string): number {
  return db.stocks.findIndex((item) => item.location === location && item.material === material)
}

/** 在途占用只由「已受理」领用单构成；已出库的已核销、已退回的从未占用。 */
export function occupiedQty(db: MaterialDB, location: string, material: string): number {
  return db.requisitions
    .filter((item) => item.status === '已受理' && item.location === location && item.material === material)
    .reduce((sum, item) => sum + item.qty, 0)
}

export function listStocks(filters: { zone?: string; location?: string; material?: string } = {}): StockView[] {
  const db = materialDB()
  return db.stocks
    .map((item) => {
      const occupied = occupiedQty(db, item.location, item.material)
      const effective = item.available - occupied
      return { ...item, occupied, effective, belowQuota: effective < item.quota }
    })
    .filter((item) =>
      (!filters.zone || item.zone.includes(filters.zone))
      && (!filters.location || item.location.includes(filters.location.trim()))
      && (!filters.material || item.material.includes(filters.material.trim())),
    )
    .sort((a, b) =>
      a.location === b.location ? a.material.localeCompare(b.material, 'zh') : a.location.localeCompare(b.location),
    )
}

// ---------- 出入库流水 ----------

export interface MoveInput {
  kind: MoveKind
  docNo: string
  location: string
  material: string
  qtyText: string
  actorName: string
  clockOverride?: string
}

function parseQty(text: string, label: string): number {
  if (!/^\d+$/.test(text.trim())) {
    throw new Error(`${label}必须是大于 0 的整数`)
  }
  const value = Number(text.trim())
  if (value <= 0) {
    throw new Error(`${label}必须是大于 0 的整数`)
  }
  return value
}

/** 库管员出入库的统一闸门：本人、当班、本片库、按库位逐条登记。 */
function assertKeeperOnDutyInZone(profile: OperatorProfile, location: string, now: Date): string {
  if (profile.role !== 'keeper') {
    return `出入库只能由库管员在片库逐条登记，${profile.name}是调度室账号`
  }
  if (!isOnDuty(profile, now)) {
    return `当前不在${profile.name}的值守时段（${profile.shiftLabel}），不能登记出入库`
  }
  const zone = locationZone(location)
  if (!zone) {
    return `库位号「${location}」不存在`
  }
  if (zone !== profile.zone) {
    return `库位号「${location}」属于${zone}，${profile.name}只负责${profile.zone}，跨片库提交直接挡下`
  }
  return ''
}

/** 按库位逐条登记出入库；单据号唯一，流水留痕，不允许绕开库位直接改总量。 */
export function registerMove(input: MoveInput): MaterialActionResult {
  const now = resolveNow(input.clockOverride)
  let profile: OperatorProfile
  try {
    profile = requireOperator(input.actorName)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const docNo = input.docNo.trim()
  if (!docNo) {
    return { ok: false, message: '单据号不能为空，出入库必须留下单据号' }
  }
  const location = input.location.trim()
  const blocked = assertKeeperOnDutyInZone(profile, location, now)
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const materialDef = MATERIAL_BY_NAME.get(input.material)
  if (!materialDef) {
    return { ok: false, message: `物资「${input.material}」不在物资目录里` }
  }
  let qty: number
  try {
    qty = parseQty(input.qtyText, '出入库数量')
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const db: MaterialDB = structuredCloneSafe(materialDB())
  const existed = db.ledger.find((item) => item.docNo === docNo)
  if (existed) {
    return {
      ok: false,
      message: `单据号「${docNo}」已存在（${existed.kind}，经手人 ${existed.handler}，${existed.createdAt}），不能重复登记`,
    }
  }

  const index = stockIndex(db, location, materialDef.name)
  const zone = profile.zone
  const timestamp = formatDateTime(now)

  if (input.kind === '入库') {
    if (index < 0) {
      db.stocks.push({
        location,
        zone,
        material: materialDef.name,
        unit: materialDef.unit,
        available: 0,
        quota: 0,
        updatedAt: timestamp,
      })
    }
    const target = db.stocks[stockIndex(db, location, materialDef.name)]
    target.available += qty
    target.updatedAt = timestamp
    db.seq.ledger += 1
    const entry: LedgerEntry = {
      id: db.seq.ledger,
      docNo,
      kind: '入库',
      location,
      zone,
      material: materialDef.name,
      unit: materialDef.unit,
      qty,
      handler: profile.name,
      source: 'manual',
      createdAt: timestamp,
    }
    db.ledger.push(entry)
    saveMaterialDB(db)
    return {
      ok: true,
      message: `入库已登记：${location} ${materialDef.name} +${qty}${materialDef.unit}，可用量 ${target.available}${materialDef.unit}，单据号 ${docNo}，经手人 ${profile.name}`,
    }
  }

  // 出库：先看有没有同单号的已受理领用单，有就核销它的在途占用。
  if (index < 0) {
    return { ok: false, message: `${location} 下没有「${materialDef.name}」的库位账，不能出库` }
  }
  const stock = db.stocks[index]
  const linked = db.requisitions.find((item) => item.docNo === docNo && item.status === '已受理')
  if (linked && (linked.location !== location || linked.material !== materialDef.name)) {
    return {
      ok: false,
      message: `单据号「${docNo}」是领用单 ${linked.location} ${linked.material} ${linked.qty}${linked.unit}，与本次出库库位/物资不符`,
    }
  }
  if (linked && linked.qty !== qty) {
    return {
      ok: false,
      message: `单据号「${docNo}」领用数量为 ${linked.qty}${linked.unit}，出库数量必须与领用单一致`,
    }
  }

  const occupiedOthers = occupiedQty(db, location, materialDef.name) - (linked ? qty : 0)
  if (stock.available - occupiedOthers < qty) {
    const free = stock.available - occupiedQty(db, location, materialDef.name)
    return {
      ok: false,
      message: `${location} ${materialDef.name} 可用量 ${stock.available}${stock.unit}，在途占用 ${occupiedQty(db, location, materialDef.name)}${stock.unit}，实可发 ${free}${stock.unit}，不够出库 ${qty}${stock.unit}`,
    }
  }

  stock.available -= qty
  stock.updatedAt = timestamp
  db.seq.ledger += 1
  const entry: LedgerEntry = {
    id: db.seq.ledger,
    docNo,
    kind: '出库',
    location,
    zone,
    material: materialDef.name,
    unit: materialDef.unit,
    qty,
    handler: profile.name,
    source: linked ? 'requisition' : 'manual',
    requisitionNo: linked?.docNo,
    createdAt: timestamp,
  }
  db.ledger.push(entry)
  let suffix = ''
  if (linked) {
    linked.status = '已出库'
    linked.outboundDocNo = docNo
    suffix = `；领用单 ${docNo} 的在途占用已核销`
  }
  saveMaterialDB(db)
  return {
    ok: true,
    message: `出库已登记：${location} ${materialDef.name} -${qty}${materialDef.unit}，可用量 ${stock.available}${materialDef.unit}，单据号 ${docNo}，经手人 ${profile.name}${suffix}`,
  }
}

export function listLedger(filters: { keyword?: string } = {}): LedgerEntry[] {
  const keyword = filters.keyword?.trim()
  return materialDB()
    .ledger.filter((item) =>
      !keyword
      || item.docNo.includes(keyword)
      || item.handler.includes(keyword)
      || item.location.includes(keyword)
      || item.material.includes(keyword),
    )
    .sort((a, b) => b.id - a.id)
}

// ---------- 领用单 ----------

export interface RequisitionInput {
  docNo: string
  location: string
  material: string
  qtyText: string
  actorName: string
  /** 提交方：库管员在片库现场提交，或调度室提交。 */
  channel: RequisitionChannel
  clockOverride?: string
}

function assertChannelAllowed(
  profile: OperatorProfile,
  channel: RequisitionChannel,
  location: string,
  now: Date,
): string {
  const zone = locationZone(location)
  if (!zone) {
    return `库位号「${location}」不存在，领用单必须落到具体库位`
  }
  if (channel === '库管员') {
    if (profile.role !== 'keeper') {
      return `调度室账号 ${profile.name} 不能以「库管员」名义提交领用单`
    }
    if (!isOnDuty(profile, now)) {
      return `当前不在${profile.name}的值守时段（${profile.shiftLabel}），不能提交领用单`
    }
    if (zone !== profile.zone) {
      return `库位号「${location}」属于${zone}，${profile.name}只负责${profile.zone}，跨片库提交直接挡下`
    }
    return ''
  }
  if (profile.role !== 'dispatcher') {
    return `库管员 ${profile.name} 不能以「调度室」名义跨片库提交领用单`
  }
  return ''
}

function pushAlert(
  db: MaterialDB,
  payload: {
    kind: AlertKind
    level: AlertLevel
    zone: string
    location: string
    material: string
    message: string
    source: string
    createdAt: string
  },
): void {
  db.seq.alert += 1
  const alert: MaterialAlert = { id: db.seq.alert, resolved: false, ...payload }
  db.alerts.push(alert)
}

/**
 * 领用单受理：能不能发由系统算——
 * 可用量扣掉在途占用后，发放完够不到储备定额就退回并写明还差多少；
 * 同单号重复提交（含库管员与调度室同时各点一张）只认先到的，后到按重复挡回。
 */
export function submitRequisition(input: RequisitionInput): MaterialActionResult {
  const now = resolveNow(input.clockOverride)
  let profile: OperatorProfile
  try {
    profile = requireOperator(input.actorName)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const docNo = input.docNo.trim()
  if (!docNo) {
    return { ok: false, message: '领用单号不能为空' }
  }
  const location = input.location.trim()
  const materialDef = MATERIAL_BY_NAME.get(input.material)
  if (!materialDef) {
    return { ok: false, message: `物资「${input.material}」不在物资目录里` }
  }
  let qty: number
  try {
    qty = parseQty(input.qtyText, '领用数量')
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const channelBlocked = assertChannelAllowed(profile, input.channel, location, now)
  if (channelBlocked) {
    return { ok: false, message: channelBlocked }
  }

  const db: MaterialDB = structuredCloneSafe(materialDB())
  const timestamp = formatDateTime(now)

  // 先到先得：单号一旦登记（受理或退回都算先到），后到的一张一律按重复挡回。
  const existing = db.requisitions.find((item) => item.docNo === docNo)
  if (existing) {
    return {
      ok: false,
      duplicated: true,
      message: `领用单 ${docNo} 已由${existing.channel}（${existing.applicant}）于 ${existing.createdAt} 先到登记（${existing.status}），本次${input.channel}（${profile.name}）后到的一张按重复挡回，只认先到的那一张`,
    }
  }

  const zone = locationZone(location)
  const index = stockIndex(db, location, materialDef.name)
  const stock = index < 0 ? undefined : db.stocks[index]
  const available = stock?.available ?? 0
  const occupied = stock ? occupiedQty(db, location, materialDef.name) : 0
  const effective = available - occupied
  const remaining = effective - qty
  const quota = stock?.quota ?? 0

  db.seq.requisition += 1
  const base: Omit<Requisition, 'status' | 'reason'> = {
    id: db.seq.requisition,
    seq: db.seq.requisition,
    docNo,
    location,
    zone,
    material: materialDef.name,
    unit: materialDef.unit,
    qty,
    applicant: profile.name,
    channel: input.channel,
    createdAt: timestamp,
  }

  // 系统判发放：发放后扣掉在途占用的可用量够不到储备定额 → 退回，写明还差多少。
  if (remaining < quota) {
    const shortage = quota - remaining
    const reason = `发放 ${qty}${materialDef.unit} 后可用量仅剩 ${Math.max(remaining, 0)}${materialDef.unit}，低于储备定额 ${quota}${materialDef.unit}，还差 ${shortage}${materialDef.unit}`
    db.requisitions.push({ ...base, status: '已退回', reason })
    pushAlert(db, {
      kind: '储备预警',
      level: 'warning',
      zone: zone || '未知片库',
      location,
      material: materialDef.name,
      message: `领用单 ${docNo} 退回：${location} ${materialDef.name} ${reason}`,
      source: docNo,
      createdAt: timestamp,
    })
    saveMaterialDB(db)
    return { ok: false, message: `领用单退回：${location} ${materialDef.name} ${reason}` }
  }

  db.requisitions.push({ ...base, status: '已受理', reason: '' })
  saveMaterialDB(db)
  return {
    ok: true,
    message: `领用单 ${docNo} 受理（${input.channel} ${profile.name}）：${location} ${materialDef.name} 发出 ${qty}${materialDef.unit} 计入在途占用；扣占用后余量 ${remaining}${materialDef.unit}，不低于储备定额 ${quota}${materialDef.unit}。出库时用同一单据号登记即核销`,
  }
}

export function listRequisitions(filters: { keyword?: string; status?: string } = {}): Requisition[] {
  const keyword = filters.keyword?.trim()
  return materialDB()
    .requisitions.filter((item) =>
      (!filters.status || item.status === filters.status)
      && (!keyword
        || item.docNo.includes(keyword)
        || item.applicant.includes(keyword)
        || item.location.includes(keyword)
        || item.material.includes(keyword)),
    )
    .sort((a, b) => b.seq - a.seq)
}

// ---------- 历史盘点导入 ----------

export interface StocktakeImportInput {
  batchNo: string
  stockDate: string
  text: string
  actorName: string
  clockOverride?: string
}

/** 解析旧口径盘点文本：库位,物资,旧口径单位,盘点数量,旧口径定额；空行与 # 注释跳过。 */
export function parseStocktakeText(text: string): { rows: StocktakeRow[]; error: string } {
  const rows: StocktakeRow[] = []
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  for (const [lineIndex, line] of lines.entries()) {
    const cells = line.split(',').map((cell) => cell.trim())
    if (cells.length !== 5) {
      return { rows: [], error: `第 ${lineIndex + 1} 行列数不对，应为「库位,物资,旧口径单位,盘点数量,旧口径定额」` }
    }
    const [location, material, legacyUnit, countedText, quotaText] = cells
    if (!locationZone(location)) {
      return { rows: [], error: `第 ${lineIndex + 1} 行库位号「${location}」不存在` }
    }
    const materialDef = MATERIAL_BY_NAME.get(material)
    if (!materialDef) {
      return { rows: [], error: `第 ${lineIndex + 1} 行物资「${material}」不在物资目录里` }
    }
    if (!(legacyUnit in materialDef.factors)) {
      return {
        rows: [],
        error: `第 ${lineIndex + 1} 行旧口径「${legacyUnit}」没有登记折算系数（${material} 支持：${Object.keys(materialDef.factors).join('、')}）`,
      }
    }
    if (!/^\d+(\.\d+)?$/.test(countedText) || !/^\d+(\.\d+)?$/.test(quotaText)) {
      return { rows: [], error: `第 ${lineIndex + 1} 行数量必须是非负数字` }
    }
    rows.push({
      location,
      material,
      legacyUnit,
      countedQty: Number(countedText),
      legacyQuota: Number(quotaText),
    })
  }
  if (rows.length === 0) {
    return { rows: [], error: '没有可导入的盘点行' }
  }
  return { rows, error: '' }
}

/**
 * 历史盘点导入：按当时的旧口径折算成库位可用量与储备定额；
 * 批号唯一，重复跑不生成第二份；盘点差异落到调度室物资警示。
 */
export function importStocktake(input: StocktakeImportInput): MaterialActionResult {
  const now = resolveNow(input.clockOverride)
  let profile: OperatorProfile
  try {
    profile = requireOperator(input.actorName)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const batchNo = input.batchNo.trim()
  if (!batchNo) {
    return { ok: false, message: '盘点批号不能为空' }
  }
  if (!input.stockDate.trim()) {
    return { ok: false, message: '盘点日期不能为空' }
  }

  const db0 = materialDB()
  if (db0.batches.some((item) => item.batchNo === batchNo)) {
    return { ok: true, duplicated: true, message: `盘点批号「${batchNo}」已导入过，重复跑不生成第二份，库位账与警示均无变化` }
  }

  const { rows, error } = parseStocktakeText(input.text)
  if (error) {
    return { ok: false, message: `导入已整批挡下：${error}` }
  }

  // 库管员只能导自己片库的盘点；跨片库的行整批挡下。
  if (profile.role === 'keeper') {
    if (!isOnDuty(profile, now)) {
      return { ok: false, message: `当前不在${profile.name}的值守时段（${profile.shiftLabel}），不能导入盘点` }
    }
    const foreign = rows.find((row) => locationZone(row.location) !== profile.zone)
    if (foreign) {
      return { ok: false, message: `${foreign.location} 不属于${profile.zone}，库管员不能跨片库导入，整批挡下` }
    }
  }

  const db: MaterialDB = structuredCloneSafe(db0)
  const timestamp = formatDateTime(now)
  let surplus = 0
  let deficit = 0

  for (const row of rows) {
    const materialDef = MATERIAL_BY_NAME.get(row.material)!
    const factor = materialDef.factors[row.legacyUnit]
    // 按当时口径折算：旧口径数量 × 折算系数 = 标准口径，四舍五入成整数记账。
    const stdQty = Math.round(row.countedQty * factor)
    const stdQuota = Math.round(row.legacyQuota * factor)
    const zone = locationZone(row.location)
    const index = stockIndex(db, row.location, row.material)
    const before = index < 0 ? null : db.stocks[index]
    const variance = stdQty - (before?.available ?? 0)

    if (variance > 0) {
      surplus += 1
      pushAlert(db, {
        kind: '盘点差异',
        level: 'info',
        zone,
        location: row.location,
        material: row.material,
        message: `${row.location} ${row.material} 盘盈 ${variance}${materialDef.unit}：账面 ${before?.available ?? 0}${materialDef.unit}，${input.stockDate} 盘点 ${stdQty}${materialDef.unit}（${row.countedQty}${row.legacyUnit} 按 ${factor} 折算）`,
        source: batchNo,
        createdAt: timestamp,
      })
    } else if (variance < 0) {
      deficit += 1
      pushAlert(db, {
        kind: '盘点差异',
        level: 'critical',
        zone,
        location: row.location,
        material: row.material,
        message: `${row.location} ${row.material} 盘亏 ${Math.abs(variance)}${materialDef.unit}：账面 ${before?.available ?? 0}${materialDef.unit}，${input.stockDate} 盘点 ${stdQty}${materialDef.unit}（${row.countedQty}${row.legacyUnit} 按 ${factor} 折算）`,
        source: batchNo,
        createdAt: timestamp,
      })
    }

    if (index < 0) {
      db.stocks.push({
        location: row.location,
        zone,
        material: row.material,
        unit: materialDef.unit,
        available: stdQty,
        quota: stdQuota,
        updatedAt: timestamp,
      })
    } else {
      db.stocks[index].available = stdQty
      db.stocks[index].quota = stdQuota
      db.stocks[index].updatedAt = timestamp
    }
  }

  db.batches.push({
    batchNo,
    stockDate: input.stockDate.trim(),
    importedAt: timestamp,
    importedBy: profile.name,
    rows: rows.length,
    upserted: rows.length,
    surplus,
    deficit,
    note: '旧口径按折算系数折成标准口径，库位可用量与储备定额同步覆盖',
  })
  saveMaterialDB(db)
  return {
    ok: true,
    message: `盘点批次 ${batchNo} 导入完成：${rows.length} 条库位账已按当时口径折算覆盖，盘盈 ${surplus} 条、盘亏 ${deficit} 条，差异已落到调度室物资警示`,
  }
}

// ---------- 警示 ----------

export function listAlerts(includeResolved = false): MaterialAlert[] {
  return materialDB()
    .alerts.filter((item) => includeResolved || !item.resolved)
    .sort((a, b) => b.id - a.id)
}

export function resolveAlert(id: number, actorName: string): MaterialActionResult {
  let profile: OperatorProfile
  try {
    profile = requireOperator(actorName)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  if (profile.role !== 'dispatcher') {
    return { ok: false, message: '物资警示由调度室核销，库管员无权操作' }
  }
  const db: MaterialDB = structuredCloneSafe(materialDB())
  const target = db.alerts.find((item) => item.id === id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的警示` }
  }
  if (target.resolved) {
    return { ok: false, message: '该警示已核销，不用重复操作' }
  }
  target.resolved = true
  saveMaterialDB(db)
  return { ok: true, message: `警示 ${id} 已由调度室 ${profile.name} 核销` }
}

// ---------- 概览与重置 ----------

export function materialSummary(): MaterialSummary {
  const db = materialDB()
  const openAlerts = db.alerts.filter((item) => !item.resolved).length
  const inTransit = db.requisitions.filter((item) => item.status === '已受理').length
  return { created: db.stocks.length, pending: openAlerts, abnormal: inTransit, openAlerts, inTransit }
}

export function resetMaterialData(): MaterialActionResult {
  resetMaterialDB()
  return { ok: true, message: '防汛物资数据已恢复为示例期初数据' }
}

// structuredClone 在目标环境可用（ES2020 lib + 现代浏览器）；留个保险。
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export { LOCATIONS_ALL, ZONES }
