<template>
  <section class="page" data-module="floodmaterial">
    <header class="page-head">
      <div>
        <h2>防汛物资调拨</h2>
        <p class="page-desc">
          管到库位这一层：按「库位 × 物资」记可用量与储备定额，出入库凭单据号留经手人；
          领用单能不能发由系统按储备定额算，同单先到先得；库管员限本片库当班操作。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">恢复示例数据</button>
      </div>
    </header>

    <!-- 身份与时钟：演示跨片库拦截、班外拦截、库管员与调度室同时提交先到先得 -->
    <div class="identity-bar">
      <label class="identity-item">
        <span>当前操作人员</span>
        <select :value="store.operator" @change="switchOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="op in OPERATORS" :key="op.name" :value="op.name">
            {{ op.name }}（{{ op.role === 'keeper' ? '库管员·' + op.zone : '调度室' }}）
          </option>
        </select>
      </label>
      <label class="identity-item">
        <span>当前时间</span>
        <select :value="store.clockOverride" @change="store.setClockOverride(($event.target as HTMLSelectElement).value)">
          <option value="now">真实时间</option>
          <option value="2026-10-05T10:00:00">10-05 10:00（白班内）</option>
          <option value="2026-10-05T22:00:00">10-05 22:00（夜班内）</option>
          <option value="2026-10-05T03:00:00">10-05 03:00（白班班外）</option>
        </select>
      </label>
      <span class="duty-badge" :class="duty.onDuty ? 'on' : 'off'">
        {{ duty.profile.name }} · {{ duty.onDuty ? '值守中' : '非值守时段' }} · {{ duty.profile.shiftLabel }}
      </span>
      <span class="duty-clock">系统时间 {{ duty.nowText }}</span>
    </div>

    <div v-if="banner" class="banner" :class="banner.ok ? 'ok' : 'fail'">
      <span>{{ banner.message }}</span>
      <button class="link" type="button" @click="banner = null">关闭</button>
    </div>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">库位账条数</span>
        <strong class="stat-value">{{ summary.created }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">在途占用单（已受理未出库）</span>
        <strong class="stat-value">{{ summary.inTransit }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">扣占用后低于定额条目</span>
        <strong class="stat-value" :class="{ 'red-text': belowQuotaCount > 0 }">{{ belowQuotaCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未核销物资警示</span>
        <strong class="stat-value" :class="{ 'red-text': summary.openAlerts > 0 }">{{ summary.openAlerts }}</strong>
      </article>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}<span v-if="tab.key === 'alerts' && summary.openAlerts" class="tab-badge">{{ summary.openAlerts }}</span>
      </button>
    </nav>

    <!-- 页签1：库位账 -->
    <div v-show="activeTab === 'stocks'">
      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>片库</span>
          <select v-model="stockFilters.zone">
            <option value="">全部</option>
            <option v-for="zone in ZONES" :key="zone.name" :value="zone.name">{{ zone.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>库位号</span>
          <input v-model="stockFilters.location" placeholder="按库位号检索" />
        </label>
        <label class="filter-item">
          <span>物资</span>
          <input v-model="stockFilters.material" placeholder="按物资检索" />
        </label>
        <button class="btn" type="submit">查询</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>片库</th><th>库位号</th><th>物资</th><th>单位</th>
            <th>可用量</th><th>在途占用</th><th>扣占用后可发</th><th>储备定额</th><th>账实判定</th><th>最后更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in stocks" :key="row.location + row.material" :class="{ 'row-warn': row.belowQuota }">
            <td>{{ row.zone }}</td>
            <td>{{ row.location }}</td>
            <td>{{ row.material }}</td>
            <td>{{ row.unit }}</td>
            <td>{{ row.available }}</td>
            <td>{{ row.occupied }}</td>
            <td>{{ row.effective }}</td>
            <td>{{ row.quota }}</td>
            <td>
              <span class="tag" :class="row.belowQuota ? 'tag-danger' : 'tag-ok'">
                {{ row.belowQuota ? '扣占用后低于定额' : '满足定额' }}
              </span>
            </td>
            <td>{{ row.updatedAt }}</td>
          </tr>
          <tr v-if="!stocks.length">
            <td colspan="10" class="empty-state">没有符合条件的库位账</td>
          </tr>
        </tbody>
      </table>
      <p class="hint-text">可用量只能通过下一个页签的入库/出库逐条登记变化，页面不提供绕开库位直接改总量的入口。</p>
    </div>

    <!-- 页签2：出入库登记 -->
    <div v-show="activeTab === 'move'">
      <form class="entry-form" @submit.prevent="submitMove">
        <div class="form-grid">
          <label class="form-item">
            <span>出入库类型</span>
            <select v-model="moveForm.kind">
              <option>入库</option>
              <option>出库</option>
            </select>
          </label>
          <label class="form-item">
            <span>单据号</span>
            <input v-model="moveForm.docNo" placeholder="如 RK-A01-001；按已受理领用单出库时填领用单号" />
          </label>
          <label class="form-item">
            <span>库位号（逐条登记）</span>
            <select v-model="moveForm.location">
              <option value="">请选择</option>
              <option v-for="loc in LOCATIONS_ALL" :key="loc" :value="loc">{{ loc }}（{{ zoneNameOf(loc) }}）</option>
            </select>
          </label>
          <label class="form-item">
            <span>物资</span>
            <select v-model="moveForm.material">
              <option value="">请选择</option>
              <option v-for="mat in MATERIALS" :key="mat.name" :value="mat.name">{{ mat.name }}（{{ mat.unit }}）</option>
            </select>
          </label>
          <label class="form-item">
            <span>数量</span>
            <input v-model="moveForm.qty" inputmode="numeric" placeholder="正整数" />
          </label>
          <label class="form-item">
            <span>经手人</span>
            <input :value="store.operator" disabled />
          </label>
        </div>
        <div class="form-foot">
          <button class="btn primary" type="submit">登记{{ moveForm.kind }}</button>
          <button class="btn" type="button" @click="newMoveDocNo">换一张单据号</button>
          <span class="hint-text">
            库管员只能在值守时段操作自己负责的片库；单据号重复登记直接挡下。
            出库时单据号填已受理的领用单号，会自动核销该单的在途占用。
          </span>
        </div>
      </form>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>检索流水（单据号/经手人/库位/物资）</span>
          <input v-model="ledgerKeyword" placeholder="关键字" />
        </label>
        <button class="btn" type="submit">查询</button>
      </form>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>类型</th><th>单据号</th><th>片库</th><th>库位号</th><th>物资</th><th>数量</th><th>经手人</th><th>来源</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in ledger" :key="row.id">
            <td>{{ row.createdAt }}</td>
            <td><span class="tag" :class="row.kind === '入库' ? 'tag-ok' : 'tag-info'">{{ row.kind }}</span></td>
            <td>{{ row.docNo }}</td>
            <td>{{ row.zone }}</td>
            <td>{{ row.location }}</td>
            <td>{{ row.material }}</td>
            <td>{{ row.kind === '入库' ? '+' : '-' }}{{ row.qty }}{{ row.unit }}</td>
            <td>{{ row.handler }}</td>
            <td>{{ row.source === 'requisition' ? '领用单出库' + (row.requisitionNo ? '·' + row.requisitionNo : '') : '手工登记' }}</td>
          </tr>
          <tr v-if="!ledger.length"><td colspan="9" class="empty-state">暂无出入库流水</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 页签3：领用单 -->
    <div v-show="activeTab === 'requisition'">
      <form class="entry-form" @submit.prevent>
        <div class="form-grid">
          <label class="form-item">
            <span>领用单号</span>
            <input v-model="reqForm.docNo" placeholder="如 LY-20261005-001" />
          </label>
          <label class="form-item">
            <span>领用库位号</span>
            <select v-model="reqForm.location">
              <option value="">请选择</option>
              <option v-for="loc in LOCATIONS_ALL" :key="loc" :value="loc">{{ loc }}（{{ zoneNameOf(loc) }}）</option>
            </select>
          </label>
          <label class="form-item">
            <span>物资</span>
            <select v-model="reqForm.material">
              <option value="">请选择</option>
              <option v-for="mat in MATERIALS" :key="mat.name" :value="mat.name">{{ mat.name }}（{{ mat.unit }}）</option>
            </select>
          </label>
          <label class="form-item">
            <span>领用数量</span>
            <input v-model="reqForm.qty" inputmode="numeric" placeholder="正整数" />
          </label>
          <label class="form-item">
            <span>申领经手人</span>
            <input :value="store.operator" disabled />
          </label>
        </div>
        <div class="form-foot">
          <button class="btn primary" type="button" @click="submitReq('库管员')">库管员提交（限本片库当班）</button>
          <button class="btn" type="button" @click="submitReq('调度室')">调度室提交（跨片库）</button>
          <button class="btn ghost" type="button" @click="newReqDocNo">换一张领用单号</button>
          <span class="hint-text">
            规则：发放后「可用量−在途占用」低于储备定额的退回并写明差多少；同单号重复点两次只扣一次；
            库管员与调度室同时提交同单号时只认先到，后到按重复挡回。
          </span>
        </div>
      </form>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>状态</span>
          <select v-model="reqStatusFilter">
            <option value="">全部</option>
            <option>已受理</option>
            <option>已出库</option>
            <option>已退回</option>
          </select>
        </label>
        <label class="filter-item">
          <span>检索（单号/经手人/库位/物资）</span>
          <input v-model="reqKeyword" placeholder="关键字" />
        </label>
        <button class="btn" type="submit">查询</button>
      </form>
      <table class="data-table">
        <thead>
          <tr><th>受理序</th><th>领用单号</th><th>片库</th><th>库位号</th><th>物资</th><th>数量</th><th>提交方</th><th>经手人</th><th>状态</th><th>系统判定/退回原因</th><th>提交时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in requisitions" :key="row.id" :class="{ 'row-warn': row.status === '已退回' }">
            <td>{{ row.seq }}</td>
            <td>{{ row.docNo }}</td>
            <td>{{ row.zone }}</td>
            <td>{{ row.location }}</td>
            <td>{{ row.material }}</td>
            <td>{{ row.qty }}{{ row.unit }}</td>
            <td>{{ row.channel }}</td>
            <td>{{ row.applicant }}</td>
            <td><span class="tag" :class="statusTagClass(row.status)">{{ row.status }}</span></td>
            <td class="reason-cell">{{ row.reason || '扣占用后不低于储备定额，计入在途占用' }}</td>
            <td>{{ row.createdAt }}</td>
            <td>
              <button v-if="row.status === '已受理'" class="link" type="button" @click="fillOutbound(row)">
                带去出库登记
              </button>
              <span v-else class="hint-text">—</span>
            </td>
          </tr>
          <tr v-if="!requisitions.length"><td colspan="12" class="empty-state">暂无领用单</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 页签4：历史盘点导入 -->
    <div v-show="activeTab === 'stocktake'">
      <form class="entry-form" @submit.prevent="submitImport">
        <div class="form-grid">
          <label class="form-item">
            <span>盘点批号（重复跑不生成第二份）</span>
            <input v-model="importForm.batchNo" placeholder="如 PD-202608" />
          </label>
          <label class="form-item">
            <span>盘点日期</span>
            <input v-model="importForm.stockDate" type="date" />
          </label>
        </div>
        <label class="form-item full">
          <span>历史盘点文本（每行：库位,物资,旧口径单位,盘点数量,旧口径定额）</span>
          <textarea v-model="importForm.text" rows="8" class="code-input"></textarea>
        </label>
        <div class="form-foot">
          <button class="btn primary" type="submit">按当时口径折算导入</button>
          <span class="hint-text">
            旧口径按物资目录折算系数换成标准单位后覆盖库位可用量与储备定额；盘盈盘亏落到调度室物资警示。
            库管员只能导本片库，跨片库整批挡下；同一批号再跑一次不会生成第二份。
          </span>
        </div>
      </form>

      <h3 class="sub-title">折算口径对照</h3>
      <table class="data-table compact">
        <thead><tr><th>物资</th><th>标准单位</th><th>旧口径折算</th></tr></thead>
        <tbody>
          <tr v-for="mat in MATERIALS" :key="mat.name">
            <td>{{ mat.name }}</td>
            <td>{{ mat.unit }}</td>
            <td>
              <span v-for="(factor, legacyUnit) in mat.factors" :key="legacyUnit" class="legend-item">
                1{{ legacyUnit }} = {{ factor }}{{ mat.unit }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="sub-title">已导入批次</h3>
      <table class="data-table">
        <thead><tr><th>批号</th><th>盘点日期</th><th>导入时间</th><th>导入人</th><th>行数</th><th>盘盈</th><th>盘亏</th><th>备注</th></tr></thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.batchNo">
            <td>{{ batch.batchNo }}</td>
            <td>{{ batch.stockDate }}</td>
            <td>{{ batch.importedAt }}</td>
            <td>{{ batch.importedBy }}</td>
            <td>{{ batch.rows }}</td>
            <td>{{ batch.surplus }}</td>
            <td :class="{ 'red-text': batch.deficit > 0 }">{{ batch.deficit }}</td>
            <td>{{ batch.note }}</td>
          </tr>
          <tr v-if="!batches.length"><td colspan="8" class="empty-state">还没有导入过盘点批次</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 页签5：物资警示（调度室） -->
    <div v-show="activeTab === 'alerts'">
      <table class="data-table">
        <thead><tr><th>编号</th><th>类型</th><th>级别</th><th>片库</th><th>库位号</th><th>物资</th><th>警示内容</th><th>来源</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="alert in alerts" :key="alert.id">
            <td>{{ alert.id }}</td>
            <td>{{ alert.kind }}</td>
            <td><span class="tag" :class="alertLevelClass(alert.level)">{{ alertLevelText(alert.level) }}</span></td>
            <td>{{ alert.zone }}</td>
            <td>{{ alert.location }}</td>
            <td>{{ alert.material }}</td>
            <td class="reason-cell">{{ alert.message }}</td>
            <td>{{ alert.source }}</td>
            <td>{{ alert.createdAt }}</td>
            <td><span class="tag" :class="alert.resolved ? 'tag-info' : 'tag-danger'">{{ alert.resolved ? '已核销' : '待处理' }}</span></td>
            <td>
              <button v-if="!alert.resolved" class="link" type="button" @click="resolveAlert(alert.id)">调度室核销</button>
              <span v-else class="hint-text">—</span>
            </td>
          </tr>
          <tr v-if="!alerts.length"><td colspan="11" class="empty-state">没有待处理警示</td></tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>数据独立持久化在浏览器 localStorage（drainage-pump:flood-material），只通过库位账变更，不存在可直接改的总量。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  LOCATIONS_ALL,
  MATERIALS,
  OPERATORS,
  ZONES,
  locationZone,
} from '@/data/floodmaterial/catalog'
import { materialDB } from '@/data/floodmaterial/local-material-store'
import type {
  LedgerEntry,
  MaterialAlert,
  Requisition,
  RequisitionChannel,
  StocktakeBatch,
} from '@/data/floodmaterial/types'
import { useSessionStore } from '@/stores/session'
import {
  dutyView,
  importStocktake,
  listAlerts,
  listLedger,
  listRequisitions,
  listStocks,
  materialSummary,
  registerMove,
  resetMaterialData,
  resolveAlert as resolveAlertAction,
  submitRequisition,
  type MaterialActionResult,
  type StockView,
} from '@/api/material-service'
import type { MaterialSummary } from '@/api/material-service'

const store = useSessionStore()

const tabs = [
  { key: 'stocks', label: '库位账' },
  { key: 'move', label: '出入库登记' },
  { key: 'requisition', label: '领用单' },
  { key: 'stocktake', label: '历史盘点导入' },
  { key: 'alerts', label: '物资警示' },
] as const

type TabKey = (typeof tabs)[number]['key']
const activeTab = ref<TabKey>('stocks')

const banner = ref<MaterialActionResult | null>(null)
const stocks = ref<StockView[]>([])
const ledger = ref<LedgerEntry[]>([])
const requisitions = ref<Requisition[]>([])
const alerts = ref<MaterialAlert[]>([])
const batches = ref<StocktakeBatch[]>([])
const summary = ref<MaterialSummary>(materialSummary())

const stockFilters = reactive({ zone: '', location: '', material: '' })
const ledgerKeyword = ref('')
const reqKeyword = ref('')
const reqStatusFilter = ref('')

const duty = computed(() => dutyView(store.operator, store.clockOverride))
const belowQuotaCount = computed(() => stocks.value.filter((item) => item.belowQuota).length)

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}
function serial(): string {
  return `${Date.now().toString(36)}${pad2(Math.floor(Math.random() * 100))}`.slice(-8).toUpperCase()
}
function zoneNameOf(location: string): string {
  return locationZone(location) || '未知片库'
}

const moveForm = reactive({
  kind: '入库' as '入库' | '出库',
  docNo: '',
  location: 'KW-A01',
  material: '编织袋',
  qty: '100',
})
const reqForm = reactive({ docNo: '', location: 'KW-A01', material: '编织袋', qty: '200' })
const importForm = reactive({
  batchNo: 'PD-202608',
  stockDate: '2026-08-25',
  text: [
    'KW-A01,编织袋,捆,18,12',
    'KW-A02,土工布,卷,4,3',
    'KW-B02,块石,吨,300,350',
  ].join('\n'),
})

function newMoveDocNo() {
  moveForm.docNo = `${moveForm.kind === '入库' ? 'RK' : 'CK'}-${serial()}`
}
function newReqDocNo() {
  reqForm.docNo = `LY-${serial()}`
}

function switchOperator(name: string) {
  const profile = OPERATORS.find((item) => item.name === name)
  if (profile) {
    store.setOperator({ name: profile.name, role: profile.role, zone: profile.zone, shiftLabel: profile.shiftLabel })
  }
}

function switchTab(tab: TabKey) {
  activeTab.value = tab
  reload()
}

function show(result: MaterialActionResult, successTab?: TabKey) {
  banner.value = result
  reload()
  if (result.ok && successTab) {
    activeTab.value = successTab
  }
}

function submitMove() {
  const result = registerMove({
    kind: moveForm.kind,
    docNo: moveForm.docNo,
    location: moveForm.location,
    material: moveForm.material,
    qtyText: moveForm.qty,
    actorName: store.operator,
    clockOverride: store.clockOverride,
  })
  show(result)
  if (result.ok) {
    moveForm.qty = ''
    newMoveDocNo()
  }
}

function submitReq(channel: RequisitionChannel) {
  const result = submitRequisition({
    docNo: reqForm.docNo,
    location: reqForm.location,
    material: reqForm.material,
    qtyText: reqForm.qty,
    actorName: store.operator,
    channel,
    clockOverride: store.clockOverride,
  })
  show(result)
  if (result.ok) {
    newReqDocNo()
  }
}

function fillOutbound(row: Requisition) {
  moveForm.kind = '出库'
  moveForm.docNo = row.docNo
  moveForm.location = row.location
  moveForm.material = row.material
  moveForm.qty = String(row.qty)
  activeTab.value = 'move'
  banner.value = {
    ok: true,
    message: `已把领用单 ${row.docNo} 带到出库登记：请由该片库当班库管员点「登记出库」完成在途核销`,
  }
}

function submitImport() {
  const result = importStocktake({
    batchNo: importForm.batchNo,
    stockDate: importForm.stockDate,
    text: importForm.text,
    actorName: store.operator,
    clockOverride: store.clockOverride,
  })
  show(result, 'alerts')
}

function resolveAlert(id: number) {
  show(resolveAlertAction(id, store.operator))
}

function resetDemo() {
  banner.value = resetMaterialData()
  reload()
}

function statusTagClass(status: Requisition['status']): string {
  if (status === '已受理') return 'tag-info'
  if (status === '已出库') return 'tag-ok'
  return 'tag-danger'
}
function alertLevelClass(level: MaterialAlert['level']): string {
  if (level === 'critical') return 'tag-danger'
  if (level === 'warning') return 'tag-warn'
  return 'tag-info'
}
function alertLevelText(level: MaterialAlert['level']): string {
  return level === 'critical' ? '盘亏' : level === 'warning' ? '预警' : '盘盈'
}

function reload() {
  stocks.value = listStocks(stockFilters)
  ledger.value = listLedger({ keyword: ledgerKeyword.value })
  requisitions.value = listRequisitions({ keyword: reqKeyword.value, status: reqStatusFilter.value })
  alerts.value = listAlerts(false)
  // 批次表直接从本地库读（仅页面展示，不产生业务判断）
  batches.value = materialDB().batches.slice().sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  summary.value = materialSummary()
}

newMoveDocNo()
newReqDocNo()
reload()
</script>
