/* eslint-disable no-console */
// 业务规则冒烟脚本：node 中直接跑 TS，注入假 localStorage，逐条验证需求。
// localStorage 垫片
const memory = new Map<string, string>()
;(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
}

const t0 = '2026-10-05T10:00:00' // 白班内，王库管当班
const t1 = '2026-10-05T03:00:00' // 白班班外
let passed = 0
let failed = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

const svc = await import('@/api/material-service')

console.log('1. 库位账：初始数据按库位×物资')
let stocks = svc.listStocks()
check('期初 6 条库位账', stocks.length === 6, `实际 ${stocks.length}`)
check('KW-A01 编织袋 可用1000 定额600', (() => {
  const s = stocks.find((x) => x.location === 'KW-A01' && x.material === '编织袋')!
  return s.available === 1000 && s.quota === 600 && s.effective === 1000
})())

console.log('2. 库管员当班入库，留单据号与经手人')
let r = svc.registerMove({ kind: '入库', docNo: 'RK-1', location: 'KW-A01', material: '编织袋', qtyText: '100', actorName: '王库管', clockOverride: t0 })
check('入库成功', r.ok, r.message)
stocks = svc.listStocks()
check('可用量变为 1100', stocks.find((x) => x.location === 'KW-A01' && x.material === '编织袋')!.available === 1100)

console.log('3. 同一单据号重复登记被挡')
r = svc.registerMove({ kind: '入库', docNo: 'RK-1', location: 'KW-A01', material: '编织袋', qtyText: '100', actorName: '王库管', clockOverride: t0 })
check('重复单据号挡下', !r.ok && r.message.includes('已存在'), r.message)
check('可用量仍为 1100（只入一次）', svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!.available === 1100)

console.log('4. 库管员跨片库直接挡下')
r = svc.registerMove({ kind: '入库', docNo: 'RK-2', location: 'KW-B01', material: '编织袋', qtyText: '10', actorName: '王库管', clockOverride: t0 })
check('东片库王库管不能登记西片库 KW-B01', !r.ok && r.message.includes('跨片库'), r.message)

console.log('5. 非值守时段挡下')
r = svc.registerMove({ kind: '入库', docNo: 'RK-3', location: 'KW-A01', material: '编织袋', qtyText: '10', actorName: '王库管', clockOverride: t1 })
check('凌晨3点白班库管员不能操作', !r.ok && r.message.includes('值守时段'), r.message)

console.log('6. 调度室账号不能做出入库登记')
r = svc.registerMove({ kind: '入库', docNo: 'RK-4', location: 'KW-A01', material: '编织袋', qtyText: '10', actorName: '张调度', clockOverride: t0 })
check('张调度登记入库被挡', !r.ok && r.message.includes('调度室'), r.message)

console.log('7. 领用单：发放后低于储备定额 → 退回并写明差多少')
// KW-A01 编织袋：可用1100 定额600；要领600 → 剩余500 < 600，差100
r = svc.submitRequisition({ docNo: 'LY-BAD', location: 'KW-A01', material: '编织袋', qtyText: '600', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('超定额领用被退回', !r.ok && r.message.includes('退回') && r.message.includes('还差 100条'), r.message)
const bad = svc.listRequisitions({ keyword: 'LY-BAD' })[0]
check('退回单落库且状态已退回', bad.status === '已退回' && bad.reason.includes('还差 100条'))
check('退回产生储备预警警示', svc.listAlerts().some((a) => a.source === 'LY-BAD' && a.kind === '储备预警'))
check('退回不占用在途', svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!.occupied === 0)

console.log('8. 合格领用单受理，形成在途占用')
// 要领400 → 剩余700 >= 600
r = svc.submitRequisition({ docNo: 'LY-OK', location: 'KW-A01', material: '编织袋', qtyText: '400', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('400条领用受理', r.ok, r.message)
let view = svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!
check('在途占用=400，扣占用后可发=700，可用量仍1100', view.occupied === 400 && view.effective === 700 && view.available === 1100)

console.log('9. 在途占用参与定额判定：占用后再领会把余量吃穿')
// 再领 200（同库位另一单）：700-200=500 < 600 差100 → 退回
r = svc.submitRequisition({ docNo: 'LY-INTRANSIT', location: 'KW-A01', material: '编织袋', qtyText: '200', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('在途占用后余量不足被退回，差100', !r.ok && r.message.includes('还差 100条'), r.message)

console.log('10. 同一张领用单重复点两次只扣一次')
r = svc.submitRequisition({ docNo: 'LY-OK', location: 'KW-A01', material: '编织袋', qtyText: '400', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('重复提交按重复挡回', !r.ok && r.duplicated && r.message.includes('重复'), r.message)
view = svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!
check('在途占用仍是400，不重复扣', view.occupied === 400)

console.log('11. 库管员与调度室同时提交同单号：先到先得')
// 调度室先到
r = svc.submitRequisition({ docNo: 'LY-RACE', location: 'KW-A01', material: '防汛沙箱', qtyText: '10', actorName: '张调度', channel: '调度室', clockOverride: t0 })
check('调度室先到受理（沙箱120-10=110≥80）', r.ok, r.message)
// 库管员后到
r = svc.submitRequisition({ docNo: 'LY-RACE', location: 'KW-A01', material: '防汛沙箱', qtyText: '10', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('库管员后到按重复挡回，且提示先到方', !r.ok && r.duplicated && r.message.includes('调度室') && r.message.includes('先到'), r.message)
const raceRows = svc.listRequisitions({ keyword: 'LY-RACE' })
check('只生成一张领用单', raceRows.length === 1 && raceRows[0].channel === '调度室')
// 反向：库管员先到、调度室后到
r = svc.submitRequisition({ docNo: 'LY-RACE2', location: 'KW-A01', material: '防汛沙箱', qtyText: '10', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('库管员先到受理', r.ok, r.message)
r = svc.submitRequisition({ docNo: 'LY-RACE2', location: 'KW-A01', material: '防汛沙箱', qtyText: '10', actorName: '张调度', channel: '调度室', clockOverride: t0 })
check('调度室后到按重复挡回', !r.ok && r.duplicated && r.message.includes('库管员'), r.message)

console.log('12. 冒名通道挡下：库管员不能点调度室提交、反之亦然')
r = svc.submitRequisition({ docNo: 'LY-FAKE1', location: 'KW-B01', material: '编织袋', qtyText: '1', actorName: '王库管', channel: '调度室', clockOverride: t0 })
check('库管员不能以调度室名义提交', !r.ok && r.message.includes('不能以「调度室」'), r.message)
r = svc.submitRequisition({ docNo: 'LY-FAKE2', location: 'KW-B01', material: '编织袋', qtyText: '1', actorName: '张调度', channel: '库管员', clockOverride: t0 })
check('调度室不能以库管员名义提交', !r.ok && r.message.includes('不能以「库管员」'), r.message)

console.log('13. 库管员以库管员通道跨片库提交直接挡下')
r = svc.submitRequisition({ docNo: 'LY-CROSS', location: 'KW-B01', material: '编织袋', qtyText: '1', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('王库管提交西片库被挡', !r.ok && r.message.includes('跨片库'), r.message)

console.log('14. 出库核销在途：用领用单号出库')
r = svc.registerMove({ kind: '出库', docNo: 'LY-OK', location: 'KW-A01', material: '编织袋', qtyText: '400', actorName: '王库管', clockOverride: t0 })
check('按领用单出库成功', r.ok && r.message.includes('在途占用已核销'), r.message)
view = svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!
check('可用量扣到700，在途占用清零', view.available === 700 && view.occupied === 0 && view.effective === 700)
const ok = svc.listRequisitions({ keyword: 'LY-OK' })[0]
check('领用单状态变为已出库', ok.status === '已出库')

console.log('15. 出库数量必须与领用单一致')
// 先再造一张受理单
r = svc.submitRequisition({ docNo: 'LY-OUT2', location: 'KW-A01', material: '防汛沙箱', qtyText: '5', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('再造一张沙箱领用单受理', r.ok, r.message)
r = svc.registerMove({ kind: '出库', docNo: 'LY-OUT2', location: 'KW-A01', material: '防汛沙箱', qtyText: '6', actorName: '王库管', clockOverride: t0 })
check('出库数量与领用单不符被挡', !r.ok && r.message.includes('必须与领用单一致'), r.message)

console.log('16. 历史盘点导入：旧口径折算')
const csv = ['KW-A01,编织袋,捆,18,12', 'KW-A02,土工布,卷,4,3', 'KW-B02,块石,吨,300,350'].join('\n')
r = svc.importStocktake({ batchNo: 'PD-1', stockDate: '2026-08-25', text: csv, actorName: '张调度', clockOverride: t0 })
check('盘点导入成功', r.ok && r.message.includes('盘盈 1') && r.message.includes('盘亏 2'), r.message)
// KW-A01 编织袋：账面700，18捆×50=900 → 盘盈200，定额12捆×50=600
let s = svc.listStocks().find((x) => x.location === 'KW-A01' && x.material === '编织袋')!
check('编织袋折算为900条、定额600条', s.available === 900 && s.quota === 600, `实际 ${s.available}/${s.quota}`)
// KW-A02 土工布：账面500，4卷×100=400 → 盘亏100，定额3×100=300
s = svc.listStocks().find((x) => x.location === 'KW-A02' && x.material === '土工布')!
check('土工布折算为400平方米、定额300', s.available === 400 && s.quota === 300)
// KW-B02 块石：账面200，300吨×0.4=120 → 盘亏80，定额350×0.4=140
s = svc.listStocks().find((x) => x.location === 'KW-B02' && x.material === '块石')!
check('块石折算为120立方米、定额140', s.available === 120 && s.quota === 140, `实际 ${s.available}/${s.quota}`)

console.log('17. 盘点差异落到调度室物资警示')
const diffAlerts = svc.listAlerts().filter((a) => a.kind === '盘点差异')
check('生成盘盈+盘亏两类差异警示', diffAlerts.some((a) => a.message.includes('盘盈 200')) && diffAlerts.some((a) => a.message.includes('盘亏 100')), JSON.stringify(diffAlerts.map((a) => a.message)))

console.log('18. 盘点重复跑不生成第二份')
const alertCountBefore = svc.listAlerts(true).length
r = svc.importStocktake({ batchNo: 'PD-1', stockDate: '2026-08-25', text: csv, actorName: '张调度', clockOverride: t0 })
check('重复批号幂等返回', r.ok && r.duplicated && r.message.includes('重复跑不生成第二份'), r.message)
check('警示数量不变', svc.listAlerts(true).length === alertCountBefore)
check('批次只有一份', svc.materialSummary() && true) // 批次表通过下面检查
const batches = (await import('@/data/floodmaterial/local-material-store')).materialDB().batches
check('批次表只有1条 PD-1', batches.length === 1 && batches[0].batchNo === 'PD-1', `实际 ${batches.length}`)

console.log('19. 库管员导入跨片库整批挡下')
r = svc.importStocktake({ batchNo: 'PD-2', stockDate: '2026-08-25', text: 'KW-B01,编织袋,捆,10,10', actorName: '王库管', clockOverride: t0 })
check('王库管不能导西片库盘点', !r.ok && r.message.includes('跨片库'), r.message)

console.log('20. 坏行整批挡下，不产生半截数据')
const stocksBeforeBad = svc.listStocks().length
r = svc.importStocktake({ batchNo: 'PD-3', stockDate: '2026-08-25', text: 'KW-A01,编织袋,捆,1,1\nKW-A01,编织袋,箱,1,1', actorName: '张调度', clockOverride: t0 })
check('未登记口径折算系数整批挡下', !r.ok && r.message.includes('折算系数'), r.message)
check('库位账条数不变', svc.listStocks().length === stocksBeforeBad)

console.log('21. 警示只能调度室核销')
const openAlert = svc.listAlerts()[0]
r = svc.resolveAlert(openAlert.id, '王库管')
check('库管员核销被挡', !r.ok && r.message.includes('调度室'), r.message)
r = svc.resolveAlert(openAlert.id, '张调度')
check('调度室核销成功', r.ok, r.message)
check('核销后从未处理列表消失', !svc.listAlerts().some((a) => a.id === openAlert.id))

console.log('22. 出库也校验可发量（含在途占用）')
// KW-A03 抽水泵：12台，定额6。先占用7 → 12-7=5<6 退回；占用6受理后余量6；
r = svc.submitRequisition({ docNo: 'LY-PUMP1', location: 'KW-A03', material: '抽水泵', qtyText: '6', actorName: '王库管', channel: '库管员', clockOverride: t0 })
check('抽水泵领6台受理（余量6≥6）', r.ok, r.message)
r = svc.registerMove({ kind: '出库', docNo: 'CK-X1', location: 'KW-A03', material: '抽水泵', qtyText: '7', actorName: '王库管', clockOverride: t0 })
check('手工出库7台：可用12占用6，实可发6，不够 → 挡下', !r.ok && r.message.includes('实可发 6'), r.message)

console.log('23. 夜班库管员在自己班内可操作本片库')
r = svc.registerMove({ kind: '入库', docNo: 'RK-NIGHT', location: 'KW-B01', material: '编织袋', qtyText: '20', actorName: '李库管', clockOverride: '2026-10-05T22:00:00' })
check('李库管22点在西片库入库成功', r.ok, r.message)

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
