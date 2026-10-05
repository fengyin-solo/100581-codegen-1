<template>
  <section class="page flood-page">
    <header class="page-head">
      <div>
        <h2>防汛物资库位调拨</h2>
        <p class="page-desc">
          台账管到库位：一个库位号下按物资记可用量与储备定额，出入库只准逐库位登记并留经手人、单据号；
          领用能不能发由系统按「可用 − 在途占用 − 定额」自动判定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="resetData">恢复示例数据</button>
      </div>
    </header>

    <div class="session-bar">
      <div class="session-group">
        <span class="session-label">当前身份</span>
        <button
          class="role-btn"
          :class="{ active: session.role === 'keeper' }"
          type="button"
          @click="session.setRole('keeper')"
        >
          库管员
        </button>
        <button
          class="role-btn"
          :class="{ active: session.role === 'dispatcher' }"
          type="button"
          @click="session.setRole('dispatcher')"
        >
          调度室
        </button>
        <select
          v-if="session.role === 'keeper'"
          class="role-select"
          :value="session.keeperCode"
          @change="session.setKeeper(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="k in refs.keepers" :key="k.code" :value="k.code">
            {{ k.name }} · {{ zoneName(k.zoneCode) }}（{{ k.dutyStart }}-{{ k.dutyEnd }}）
          </option>
        </select>
      </div>
      <div class="session-group">
        <span class="session-label">模拟操作时刻</span>
        <input class="role-select" type="datetime-local" :value="localTime" @change="onTimeChange" />
        <button class="btn" type="button" @click="setQuick('09:00')">白班 09:00</button>
        <button class="btn" type="button" @click="setQuick('15:00')">白班 15:00</button>
        <button class="btn" type="button" @click="setQuick('22:30')">夜班 22:30</button>
        <span v-if="session.role === 'keeper'" class="duty-pill" :class="session.onDuty ? 'duty-on' : 'duty-off'">
          {{ session.onDuty ? '值守时段内' : '非值守时段（操作将被挡下）' }}
        </span>
      </div>
      <div class="session-scope">{{ session.scopeLabel }}</div>
    </div>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <Transition name="fade" mode="out-in">
      <StockPanel v-if="activeTab === 'stock'" key="stock" />
      <VoucherPanel v-else-if="activeTab === 'voucher'" key="voucher" @result="showResult" />
      <RequisitionPanel v-else-if="activeTab === 'requisition'" key="requisition" @result="showResult" />
      <StocktakePanel v-else-if="activeTab === 'stocktake'" key="stocktake" @result="showResult" />
      <AlertPanel v-else key="alert" @result="showResult" />
    </Transition>

    <footer class="page-foot feedback-bar" :class="feedback?.ok ? 'ok-text' : 'error-text'">
      <span v-if="feedback">{{ feedback.message }}</span>
      <span v-else>操作结果会在这里反馈；所有数量变更都可在「出入库台账」里追溯到单据号与经手人。</span>
      <button v-if="feedback" class="link" type="button" @click="feedback = null">清除</button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFloodSession } from '@/stores/flood-session'
import { listReferenceData, resetFloodData } from '@/data/floodmaterial/service'
import StockPanel from './components/StockPanel.vue'
import VoucherPanel from './components/VoucherPanel.vue'
import RequisitionPanel from './components/RequisitionPanel.vue'
import StocktakePanel from './components/StocktakePanel.vue'
import AlertPanel from './components/AlertPanel.vue'

const session = useFloodSession()
const refs = listReferenceData()

const tabs = [
  { key: 'stock', label: '库位库存账' },
  { key: 'voucher', label: '出入库登记' },
  { key: 'requisition', label: '领用单与发放' },
  { key: 'stocktake', label: '历史盘点导入' },
  { key: 'alert', label: '调度室物资警示' },
] as const
const activeTab = ref<(typeof tabs)[number]['key']>('stock')
const feedback = ref<{ ok: boolean; message: string } | null>(null)

function zoneName(code: string): string {
  return refs.zones.find((z) => z.code === code)?.name ?? code
}

const localTime = ref(session.time.replace(' ', 'T'))
function onTimeChange(event: Event) {
  const value = (event.target as HTMLInputElement).value
  localTime.value = value
  session.setTime(value.replace('T', ' '))
}
function setQuick(hhmm: string) {
  const date = session.time.slice(0, 10)
  const next = `${date} ${hhmm}`
  session.setTime(next)
  localTime.value = next.replace(' ', 'T')
}

function showResult(payload: { ok: boolean; message: string }) {
  feedback.value = payload
}

function resetData() {
  const result = resetFloodData()
  feedback.value = { ok: result.ok, message: result.message }
}
</script>
