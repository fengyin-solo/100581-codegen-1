import { cloneState, commitFlood, floodState, resetFlood } from './store'
import type {
  Actor,
  AlertKind,
  FloodState,
  Keeper,
  MaterialAlert,
  Requisition,
  ServiceResult,
  Stock,
  StocktakeRowInput,
  Voucher,
  VoucherKind,
} from './types'

// ---------------------------------------------------------------------------
// 只读查询
// ---------------------------------------------------------------------------

export type StockViewRow = Stock & {
  zoneCode: string
  zoneName: string
  locationName: string
  materialName: string
  unit: string
  /** 还能发多少：可用量 - 在途占用 - 储备定额。 */
  free: number
}

function materialName(s: FloodState, code: string): { name: string; unit: string } {
  const item = s.materials.find((m) => m.code === code)
  return { name: item?.name ?? code, unit: item?.unit ?? '' }
}

function locationInfo(s: FloodState, code: string) {
  const loc = s.locations.find((l) => l.code === code)
  const zone = s.zones.find((z) => z.code === loc?.zoneCode)
  return { loc, zone }
}

export function listStock(zoneCode?: string): StockViewRow[] {
  const s = floodState()
  return s.stocks
    .filter((row) => !zoneCode || row.locationCode.startsWith(`${zoneCode}-`))
    .map((row) => {
      const { loc, zone } = locationInfo(s, row.locationCode)
      const meta = materialName(s, row.materialCode)
      return {
        ...row,
        zoneCode: zone?.code ?? '',
        zoneName: zone?.name ?? '',
        locationName: loc?.name ?? row.locationCode,
        materialName: meta.name,
        unit: meta.unit,
        free: row.available - row.holding - row.quota,
      }
    })
}

export type VoucherView = Voucher & {
  zoneCode: string
  locationName: string
  materialName: string
  kindLabel: string
}

export function listVouchers(zoneCode?: string): VoucherView[] {
  const s = floodState()
  return s.vouchers
    .slice()
    .sort((a, b) => (a.happenedAt < b.happenedAt ? 1 : -1))
    .filter((v) => {
      if (!zoneCode) return true
      return locationInfo(s, v.locationCode).zone?.code === zoneCode
    })
    .map((v) => {
      const { loc, zone } = locationInfo(s, v.locationCode)
      return {
        ...v,
        zoneCode: zone?.code ?? '',
        locationName: loc?.name ?? v.locationCode,
        materialName: materialName(s, v.materialCode).name,
        kindLabel: v.kind === 'in' ? '入库' : v.kind === 'out' ? '出库' : '盘点结存',
      }
    })
}

export type RequisitionView = Requisition & {
  zoneName: string
  materialName: string
  unit: string
  fullyIssued: boolean
}

export function listRequisitions(zoneCode?: string): RequisitionView[] {
  const s = floodState()
  return s.requisitions
    .slice()
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
    .filter((r) => !zoneCode || r.zoneCode === zoneCode)
    .map((r) => {
      const meta = materialName(s, r.materialCode)
      return {
        ...r,
        zoneName: s.zones.find((z) => z.code === r.zoneCode)?.name ?? r.zoneCode,
        materialName: meta.name,
        unit: meta.unit,
        fullyIssued: r.status === 'approved' && r.holdingLeft === 0,
      }
    })
}

export type AlertView = MaterialAlert & {
  zoneName: string
  locationName: string
  materialName: string
  kindLabel: string
}

const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  stocktake_diff: '盘点差异',
  requisition_rejected: '领用退回',
  below_quota: '低于定额',
}

export function listAlerts(zoneCode?: string, includeResolved = false): AlertView[] {
  const s = floodState()
  return s.alerts
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .filter((a) => includeResolved || !a.resolved)
    .filter((a) => !zoneCode || a.zoneCode === zoneCode)
    .map((a) => ({
      ...a,
      zoneName: s.zones.find((z) => z.code === a.zoneCode)?.name ?? a.zoneCode,
      locationName: a.locationCode
        ? s.locations.find((l) => l.code === a.locationCode)?.name ?? a.locationCode
        : '',
      materialName: materialName(s, a.materialCode).name,
      kindLabel: ALERT_KIND_LABEL[a.kind],
    }))
}

export function listReferenceData() {
  const s = floodState()
  return {
    zones: s.zones,
    keepers: s.keepers,
    materials: s.materials,
    locations: s.locations,
  }
}

/** 片库级汇总：领用判定时要把该片库所有库位的同物资合起来算。 */
export function zoneMaterialSummary(zoneCode: string, materialCode: string) {
  const s = floodState()
  const lines = s.stocks.filter(
    (row) => row.locationCode.startsWith(`${zoneCode}-`) && row.materialCode === materialCode,
  )
  const available = lines.reduce((sum, row) => sum + row.available, 0)
  const holding = lines.reduce((sum, row) => sum + row.holding, 0)
  const quota = lines.reduce((sum, row) => sum + row.quota, 0)
  return { available, holding, quota, free: available - holding - quota }
}

// ---------------------------------------------------------------------------
// 权限：值守时段 + 片库归属
// ---------------------------------------------------------------------------

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 时刻是否落在值守时段内，支持跨零点（如 20:00-08:00）。 */
export function isOnDuty(keeper: Keeper, now: string): boolean {
  const time = now.slice(11, 16)
  if (!/^\d{2}:\d{2}$/.test(time)) return false
  const cur = toMinutes(time)
  const start = toMinutes(keeper.dutyStart)
  const end = toMinutes(keeper.dutyEnd)
  if (start === end) return true
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

function resolveKeeper(actor: Actor): Keeper | undefined {
  return floodState().keepers.find((k) => k.code === actor.keeperCode)
}

/** 库管员操作前的统一门禁：身份真实、在值守时段内、库位属于自己的片库。 */
function checkKeeperGate(
  s: FloodState,
  actor: Actor,
  locationCode: string,
): ServiceResult<{ keeper: Keeper }> {
  if (actor.role !== 'keeper') {
    return { ok: false, message: '出入库登记只能由库管员操作，调度室只核对台账', forbidden: true }
  }
  const keeper = s.keepers.find((k) => k.code === actor.keeperCode)
  if (!keeper) {
    return { ok: false, message: `没有编号为 ${actor.keeperCode ?? ''} 的库管员`, forbidden: true }
  }
  if (!isOnDuty(keeper, actor.now)) {
    return {
      ok: false,
      message: `当前时刻 ${actor.now.slice(11, 16)} 不在 ${keeper.name} 的值守时段 ${keeper.dutyStart}-${keeper.dutyEnd} 内，禁止操作`,
      forbidden: true,
    }
  }
  const loc = s.locations.find((l) => l.code === locationCode)
  if (!loc) {
    return { ok: false, message: `没有编号为 ${locationCode} 的库位` }
  }
  if (loc.zoneCode !== keeper.zoneCode) {
    const zoneName = s.zones.find((z) => z.code === loc.zoneCode)?.name ?? loc.zoneCode
    const ownName = s.zones.find((z) => z.code === keeper.zoneCode)?.name ?? keeper.zoneCode
    return {
      ok: false,
      message: `跨片库提交被挡下：${keeper.name} 只负责${ownName}，不能登记${zoneName}的库位 ${locationCode}`,
      forbidden: true,
    }
  }
  return { ok: true, message: '', data: { keeper } }
}

// ---------------------------------------------------------------------------
// 出入库：只能按库位逐条登记
// ---------------------------------------------------------------------------

export type VoucherInput = {
  docNo: string
  kind: VoucherKind
  locationCode: string
  materialCode: string
  qty: number
  happenedAt: string
  remark?: string
}

function findStock(s: FloodState, locationCode: string, materialCode: string): Stock | undefined {
  return s.stocks.find(
    (row) => row.locationCode === locationCode && row.materialCode === materialCode,
  )
}

function pushAlert(
  s: FloodState,
  alert: Omit<MaterialAlert, 'id' | 'resolved'>,
): void {
  s.alerts.push({ ...alert, id: ++s.seq, resolved: false })
}

export function registerVoucher(actor: Actor, input: VoucherInput): ServiceResult {
  const s = cloneState()
  const docNo = input.docNo.trim()
  if (!docNo) return { ok: false, message: '单据号必填，出库入库都要留单据号' }
  if (s.vouchers.some((v) => v.docNo === docNo)) {
    return { ok: false, message: `单据号 ${docNo} 已登记过，不能重复入账`, duplicate: true }
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: '数量必须是正整数' }
  }
  const gate = checkKeeperGate(s, actor, input.locationCode)
  if (!gate.ok || !gate.data) return gate
  if (!s.materials.some((m) => m.code === input.materialCode)) {
    return { ok: false, message: `没有编号为 ${input.materialCode} 的物资` }
  }
  const line = findStock(s, input.locationCode, input.materialCode)
  if (!line) {
    return {
      ok: false,
      message: `库位 ${input.locationCode} 下还没有该物资的库位账（可用量/定额），请先由调度室导入历史盘点建立台账，再逐库位登记`,
    }
  }

  const keeper = gate.data.keeper
  if (input.kind === 'in') {
    line.available += input.qty
  } else if (input.kind === 'out') {
    if (line.available < input.qty) {
      return {
        ok: false,
        message: `库位 ${input.locationCode} 该物资可用量仅 ${line.available}，不足出库 ${input.qty}，不允许按总量透支`,
      }
    }
    line.available -= input.qty
    if (line.available < line.quota) {
      pushAlert(s, {
        kind: 'below_quota',
        zoneCode: keeper.zoneCode,
        locationCode: line.locationCode,
        materialCode: line.materialCode,
        message: `${s.locations.find((l) => l.code === line.locationCode)?.name} ${
          materialName(s, line.materialCode).name
        } 出库 ${input.qty} 后可用量 ${line.available} 已低于储备定额 ${line.quota}，请尽快补充`,
        createdAt: input.happenedAt,
      })
    }
  } else {
    return { ok: false, message: '盘点结存只能由历史盘点导入生成，不能手工登记' }
  }

  const voucher: Voucher = {
    id: ++s.seq,
    docNo,
    kind: input.kind,
    locationCode: input.locationCode,
    materialCode: input.materialCode,
    delta: input.kind === 'in' ? input.qty : -input.qty,
    handler: keeper.name,
    happenedAt: input.happenedAt,
    remark: input.remark?.trim() || undefined,
  }
  s.vouchers.push(voucher)
  commitFlood(s)
  return {
    ok: true,
    message: `${input.kind === 'in' ? '入库' : '出库'}已按库位 ${input.locationCode} 逐条登记，单据号 ${docNo}，经手人 ${keeper.name}`,
  }
}

// ---------------------------------------------------------------------------
// 领用单：系统自己算能不能发；单据号幂等；库管员/调度室先到先得
// ---------------------------------------------------------------------------

export type RequisitionInput = {
  reqNo: string
  zoneCode: string
  materialCode: string
  qty: number
}

type SubmitOutcome = {
  approved: boolean
  shortage?: number
}

function submitOne(s: FloodState, actor: Actor, input: RequisitionInput): ServiceResult<SubmitOutcome> {
  const reqNo = input.reqNo.trim()
  if (!reqNo) return { ok: false, message: '领用单号必填' }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: '领用数量必须是正整数' }
  }
  if (!s.zones.some((z) => z.code === input.zoneCode)) {
    return { ok: false, message: `没有编号为 ${input.zoneCode} 的片库` }
  }
  if (!s.materials.some((m) => m.code === input.materialCode)) {
    return { ok: false, message: `没有编号为 ${input.materialCode} 的物资` }
  }

  // 库管员只能为自己负责的片库提交；跨片库直接挡下。
  let submitter = '调度室'
  if (actor.role === 'keeper') {
    const keeper = resolveKeeper(actor)
    if (!keeper) {
      return { ok: false, message: `没有编号为 ${actor.keeperCode ?? ''} 的库管员`, forbidden: true }
    }
    if (!isOnDuty(keeper, actor.now)) {
      return {
        ok: false,
        message: `当前时刻 ${actor.now.slice(11, 16)} 不在 ${keeper.name} 的值守时段 ${keeper.dutyStart}-${keeper.dutyEnd} 内，禁止提交领用单`,
        forbidden: true,
      }
    }
    if (keeper.zoneCode !== input.zoneCode) {
      return {
        ok: false,
        message: `跨片库提交被挡下：${keeper.name} 只负责 ${s.zones.find((z) => z.code === keeper.zoneCode)?.name}，不能替 ${s.zones.find((z) => z.code === input.zoneCode)?.name} 提交领用单`,
        forbidden: true,
      }
    }
    submitter = keeper.name
  }

  // 幂等：同一张领用单不管点几次、不管谁点，都只认第一张。
  const existing = s.requisitions.find((r) => r.reqNo === reqNo)
  if (existing) {
    const sourceLabel = existing.source === 'keeper' ? `库管员${existing.submitter}` : '调度室'
    return {
      ok: false,
      duplicate: true,
      message: `领用单 ${reqNo} 已由${sourceLabel}于 ${existing.submittedAt} 提交在先（当前「${
        existing.status === 'approved' ? '已批准' : `已退回，还差 ${existing.shortage ?? 0}`
      }」），本次按重复挡回，不重复扣减`,
    }
  }

  // 判定：可用量扣掉在途占用后，够不到储备定额就退回，并写明还差多少。
  const summary = zoneMaterialSummary(input.zoneCode, input.materialCode)
  const approved = input.qty <= summary.free
  const shortage = approved ? undefined : input.qty - summary.free
  const decidedAt = actor.now
  const requisition: Requisition = {
    id: ++s.seq,
    reqNo,
    zoneCode: input.zoneCode,
    materialCode: input.materialCode,
    qty: input.qty,
    source: actor.role,
    submitter,
    submittedAt: decidedAt,
    status: approved ? 'approved' : 'rejected',
    shortage,
    decidedAt,
    holdingLeft: approved ? input.qty : 0,
    issued: 0,
    issueLines: [],
  }
  s.requisitions.push(requisition)

  if (approved) {
    distributeHolding(s, input.zoneCode, input.materialCode, input.qty)
    return {
      ok: true,
      message: `领用单 ${reqNo} 批准：片库可用 ${summary.available}，在途占用 ${summary.holding}，储备定额 ${summary.quota}，可发余量 ${summary.free} ≥ ${input.qty}`,
      data: { approved: true },
    }
  }

  const material = s.materials.find((m) => m.code === input.materialCode)
  pushAlert(s, {
    kind: 'requisition_rejected',
    zoneCode: input.zoneCode,
    materialCode: input.materialCode,
    message: `领用单 ${reqNo} 退回：${material?.name} 可发余量仅 ${summary.free}（可用 ${summary.available} - 在途 ${summary.holding} - 定额 ${summary.quota}），申请 ${input.qty}，还差 ${shortage}`,
    createdAt: decidedAt,
  })
  return {
    ok: true,
    message: `领用单 ${reqNo} 退回：可用 ${summary.available} 扣在途占用 ${summary.holding} 并保住储备定额 ${summary.quota} 后可发余量仅 ${summary.free}，申请 ${input.qty}，还差 ${shortage}`,
    data: { approved: false, shortage },
  }
}

/** 批准后把在途占用摊到片库各库位（按各库位扣除定额后的可发余量顺序占）。 */
function distributeHolding(
  s: FloodState,
  zoneCode: string,
  materialCode: string,
  qty: number,
): void {
  const lines = s.stocks
    .filter((row) => row.locationCode.startsWith(`${zoneCode}-`) && row.materialCode === materialCode)
    .map((row) => ({ row, capacity: Math.max(0, row.available - row.quota) - row.holding }))
    .sort((a, b) => b.capacity - a.capacity)
  let remaining = qty
  for (const item of lines) {
    if (remaining <= 0) break
    const take = Math.min(remaining, Math.max(0, item.capacity))
    item.row.holding += take
    remaining -= take
  }
  // 极端情况下余量为正（理论上不会，因为片库汇总已通过），摊到第一个库位兜底。
  if (remaining > 0 && lines.length > 0) {
    lines[0].row.holding += remaining
  }
}

export function submitRequisition(actor: Actor, input: RequisitionInput): ServiceResult<SubmitOutcome> {
  const s = cloneState()
  const result = submitOne(s, actor, input)
  if (result.ok) commitFlood(s)
  return result
}

export type ConcurrentParty = { actor: Actor; input: RequisitionInput; partyLabel: string }
export type ConcurrentResultItem = {
  partyLabel: string
  ok: boolean
  duplicate: boolean
  message: string
}

/**
 * 模拟库管员与调度室同时提交同一张领用单：先到的认账，后到的按重复挡回。
 * service 内串行判定，谁先进入临界区谁赢，页面上随机排序两边的到达顺序。
 */
export function submitRequisitionConcurrent(parties: ConcurrentParty[]): ServiceResult<{
  order: string[]
  results: ConcurrentResultItem[]
}> {
  const s = cloneState()
  const order: string[] = []
  const results: ConcurrentResultItem[] = []
  for (const party of parties) {
    order.push(party.partyLabel)
    const result = submitOne(s, party.actor, party.input)
    if (result.ok) commitFlood(s)
    results.push({
      partyLabel: party.partyLabel,
      ok: result.ok,
      duplicate: Boolean(result.duplicate),
      message: result.message,
    })
  }
  return { ok: true, message: '并发提交已按到达顺序裁决', data: { order, results } }
}

// ---------------------------------------------------------------------------
// 发放：批准后的领用单只能逐库位出库
// ---------------------------------------------------------------------------

export type IssueInput = {
  reqNo: string
  locationCode: string
  qty: number
  docNo: string
}

export function issueRequisition(actor: Actor, input: IssueInput): ServiceResult {
  const s = cloneState()
  const docNo = input.docNo.trim()
  if (!docNo) return { ok: false, message: '出库单据号必填' }
  if (s.vouchers.some((v) => v.docNo === docNo)) {
    return { ok: false, message: `单据号 ${docNo} 已登记过，不能重复出库`, duplicate: true }
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: '发放数量必须是正整数' }
  }
  const req = s.requisitions.find((r) => r.reqNo === input.reqNo.trim())
  if (!req) return { ok: false, message: `没有领用单 ${input.reqNo}` }
  if (req.status !== 'approved') {
    return { ok: false, message: `领用单 ${req.reqNo} 已被退回，不能发放` }
  }
  if (req.holdingLeft <= 0) {
    return { ok: false, message: `领用单 ${req.reqNo} 已全部发放完毕，再次提交按重复挡回`, duplicate: true }
  }
  const gate = checkKeeperGate(s, actor, input.locationCode)
  if (!gate.ok || !gate.data) return gate
  if (!input.locationCode.startsWith(`${req.zoneCode}-`)) {
    return { ok: false, message: `库位 ${input.locationCode} 不属于领用单的片库，不能从该库位发放` }
  }
  if (input.qty > req.holdingLeft) {
    return { ok: false, message: `本次发放 ${input.qty} 超过领用单待发量 ${req.holdingLeft}` }
  }
  const line = findStock(s, input.locationCode, req.materialCode)
  if (!line || line.available < input.qty) {
    return {
      ok: false,
      message: `库位 ${input.locationCode} 可用量仅 ${line?.available ?? 0}，发不出 ${input.qty}，请改选其他库位逐条发放`,
    }
  }

  const keeper = gate.data.keeper
  // 占用是片库池化的：优先释放所选库位的在途，不足部分摊到片库其他库位，
  // 保证「全片库在途占用合计 == 各已批领用单 holdingLeft 合计」始终成立。
  let releaseLeft = input.qty
  const zoneLines = s.stocks
    .filter((row) => row.locationCode.startsWith(`${req.zoneCode}-`) && row.materialCode === req.materialCode)
    .sort((a, b) => (a.locationCode === input.locationCode ? -1 : b.locationCode === input.locationCode ? 1 : 0))
  for (const row of zoneLines) {
    if (releaseLeft <= 0) break
    const take = Math.min(releaseLeft, row.holding)
    row.holding -= take
    releaseLeft -= take
  }
  line.available -= input.qty
  req.holdingLeft -= input.qty
  req.issued += input.qty
  req.issueLines.push({
    id: ++s.seq,
    locationCode: input.locationCode,
    qty: input.qty,
    docNo,
    handler: keeper.name,
    issuedAt: actor.now,
  })
  s.vouchers.push({
    id: ++s.seq,
    docNo,
    kind: 'out',
    locationCode: input.locationCode,
    materialCode: req.materialCode,
    delta: -input.qty,
    handler: keeper.name,
    happenedAt: actor.now,
    refNo: req.reqNo,
    remark: `领用单 ${req.reqNo} 发放`,
  })
  if (line.available < line.quota) {
    pushAlert(s, {
      kind: 'below_quota',
      zoneCode: req.zoneCode,
      locationCode: line.locationCode,
      materialCode: line.materialCode,
      message: `${s.locations.find((l) => l.code === line.locationCode)?.name} ${
        materialName(s, line.materialCode).name
      } 发放后可用量 ${line.available} 已低于储备定额 ${line.quota}，请尽快补充`,
      createdAt: actor.now,
    })
  }
  commitFlood(s)
  const tail = req.holdingLeft === 0 ? '，领用单已全部发完' : `，还剩 ${req.holdingLeft} 待发`
  return {
    ok: true,
    message: `已按库位 ${input.locationCode} 发放 ${input.qty}，单据号 ${docNo}，经手人 ${keeper.name}${tail}`,
  }
}

// ---------------------------------------------------------------------------
// 历史盘点导入：按当时口径折算；批次号幂等；差异落到调度室警示
// ---------------------------------------------------------------------------

export type StocktakeImportInput = {
  batchNo: string
  stocktakeDate: string
  caliberNote: string
  csvText: string
}

type ParsedRow = {
  locationCode: string
  materialCode: string
  legacyUnit: string
  factor: number
  physicalQty: number
  bookQuota: number
}

function parseCsvLine(line: string): string[] {
  return line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
}

/** 解析历史盘点文本，表头支持：库位号/物资编号/历史口径单位/盘点数量/账面定额/折算系数(可空)。 */
export function parseStocktakeCsv(s: FloodState, csvText: string): ServiceResult<ParsedRow[]> {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return { ok: false, message: '盘点内容为空：至少要有表头和一行数据' }
  }
  const header = parseCsvLine(lines[0])
  const idx = {
    location: header.findIndex((h) => h.includes('库位')),
    material: header.findIndex((h) => h.includes('物资')),
    legacy: header.findIndex((h) => h.includes('口径') || h.includes('历史')),
    qty: header.findIndex((h) => h.includes('盘点') || h.includes('实物') || h.includes('数量')),
    quota: header.findIndex((h) => h.includes('定额')),
    factor: header.findIndex((h) => h.includes('系数') || h.includes('折算')),
  }
  if (idx.location < 0 || idx.material < 0 || idx.qty < 0 || idx.quota < 0) {
    return { ok: false, message: '表头缺少必需列：库位号、物资编号、盘点数量、账面定额' }
  }

  const rows: ParsedRow[] = []
  for (const [lineNo, line] of lines.slice(1).entries()) {
    const cells = parseCsvLine(line)
    const locationCode = cells[idx.location] ?? ''
    const materialCode = cells[idx.material] ?? ''
    const loc = s.locations.find((l) => l.code === locationCode)
    if (!loc) {
      return { ok: false, message: `第 ${lineNo + 2} 行：库位号 ${locationCode} 不存在，整批不导入` }
    }
    const material = s.materials.find((m) => m.code === materialCode)
    if (!material) {
      return { ok: false, message: `第 ${lineNo + 2} 行：物资编号 ${materialCode} 不存在，整批不导入` }
    }
    const physicalRaw = Number(cells[idx.qty])
    const quotaRaw = Number(cells[idx.quota])
    if (!Number.isFinite(physicalRaw) || physicalRaw < 0 || !Number.isFinite(quotaRaw) || quotaRaw < 0) {
      return { ok: false, message: `第 ${lineNo + 2} 行：盘点数量或账面定额不是合法数字，整批不导入` }
    }
    const factorCell = idx.factor >= 0 ? cells[idx.factor] : ''
    const factor = factorCell === '' ? material.factor : Number(factorCell)
    if (!Number.isFinite(factor) || factor <= 0) {
      return { ok: false, message: `第 ${lineNo + 2} 行：折算系数必须为正数，整批不导入` }
    }
    rows.push({
      locationCode,
      materialCode,
      legacyUnit: idx.legacy >= 0 ? cells[idx.legacy] || material.unit : material.unit,
      factor,
      physicalQty: physicalRaw,
      bookQuota: quotaRaw,
    })
  }
  return { ok: true, message: '', data: rows }
}

export function importStocktake(
  actor: Actor,
  input: StocktakeImportInput,
): ServiceResult<{ alerts: number; lines: number }> {
  if (actor.role !== 'dispatcher') {
    return { ok: false, message: '历史盘点只能由调度室导入，库管员无此权限', forbidden: true }
  }
  const s = cloneState()
  const batchNo = input.batchNo.trim()
  if (!batchNo) return { ok: false, message: '盘点批次号必填' }
  // 幂等：同一个批次重复跑，不生成第二份批次、第二份差异警示，也不二次调账。
  if (s.stocktakes.some((b) => b.batchNo === batchNo)) {
    return {
      ok: false,
      duplicate: true,
      message: `盘点批次 ${batchNo} 已导入过，重复执行不生成第二份台账与差异`,
    }
  }

  const parsed = parseStocktakeCsv(s, input.csvText)
  if (!parsed.ok || !parsed.data) {
    return { ok: false, message: parsed.message }
  }

  const converted: StocktakeRowInput[] = []
  let alertCount = 0
  parsed.data.forEach((row, i) => {
    const physical = Math.round(row.physicalQty * row.factor)
    const quota = Math.round(row.bookQuota * row.factor)
    converted.push({
      locationCode: row.locationCode,
      materialCode: row.materialCode,
      legacyUnit: row.legacyUnit,
      factor: row.factor,
      physicalQty: physical,
      bookQuota: quota,
    })

    let line = findStock(s, row.locationCode, row.materialCode)
    const bookBefore = line?.available ?? 0
    const diff = physical - bookBefore
    if (line) {
      line.available = physical
      line.quota = quota
    } else {
      s.stocks.push({
        locationCode: row.locationCode,
        materialCode: row.materialCode,
        available: physical,
        quota,
        holding: 0,
      })
      line = s.stocks[s.stocks.length - 1]
    }

    // 差异逐库位逐物资落到调度室物资警示；无差异不产生警示。
    if (diff !== 0) {
      const loc = s.locations.find((l) => l.code === row.locationCode)
      const material = s.materials.find((m) => m.code === row.materialCode)
      pushAlert(s, {
        kind: 'stocktake_diff',
        zoneCode: loc?.zoneCode ?? '',
        locationCode: row.locationCode,
        materialCode: row.materialCode,
        message: `盘点批次 ${batchNo}：${loc?.name} ${material?.name} 按「${row.legacyUnit} × ${row.factor}」折算，账面 ${bookBefore}、实物 ${physical}，差异 ${diff > 0 ? '+' : ''}${diff}`,
        createdAt: actor.now,
      })
      alertCount += 1
      s.vouchers.push({
        id: ++s.seq,
        docNo: `PD-${batchNo}-${String(i + 1).padStart(2, '0')}`,
        kind: 'stocktake',
        locationCode: row.locationCode,
        materialCode: row.materialCode,
        delta: diff,
        handler: actor.name,
        happenedAt: actor.now,
        refNo: batchNo,
        remark: `历史盘点结存调整（${row.legacyUnit} × ${row.factor}）`,
      })
    }
  })

  s.stocktakes.push({
    id: ++s.seq,
    batchNo,
    stocktakeDate: input.stocktakeDate,
    handler: actor.name,
    caliberNote: input.caliberNote.trim() || '按历史口径折算',
    importedAt: actor.now,
    rows: converted,
  })
  commitFlood(s)
  return {
    ok: true,
    message: `盘点批次 ${batchNo} 已按当时口径折算入库位账，共 ${converted.length} 条，${alertCount} 条差异已生成调度室物资警示`,
    data: { alerts: alertCount, lines: converted.length },
  }
}

export function listStocktakes() {
  const s = floodState()
  return s.stocktakes.slice().sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
}

// ---------------------------------------------------------------------------
// 警示处理 / 重置
// ---------------------------------------------------------------------------

export function resolveAlert(actor: Actor, id: number): ServiceResult {
  if (actor.role !== 'dispatcher') {
    return { ok: false, message: '只有调度室可以核销物资警示', forbidden: true }
  }
  const s = cloneState()
  const alert = s.alerts.find((a) => a.id === id)
  if (!alert) return { ok: false, message: `没有编号为 ${id} 的警示` }
  if (alert.resolved) return { ok: false, message: '该警示已核销', duplicate: true }
  alert.resolved = true
  commitFlood(s)
  return { ok: true, message: '警示已核销' }
}

export function resetFloodData(): ServiceResult {
  resetFlood()
  return { ok: true, message: '防汛物资数据已重置为初始示例' }
}
