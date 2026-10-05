<template>
  <section>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value" :class="card.danger ? 'danger-text' : ''">{{ card.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>片库</span>
        <select v-model="zoneCode">
          <option value="">全部片库</option>
          <option v-for="z in refs.zones" :key="z.code" :value="z.code">{{ z.name }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>物资</span>
        <select v-model="materialCode">
          <option value="">全部物资</option>
          <option v-for="m in refs.materials" :key="m.code" :value="m.code">{{ m.name }}</option>
        </select>
      </label>
      <button class="btn" type="button" @click="reload">查询</button>
      <button class="btn ghost" type="button" @click="zoneCode = ''; materialCode = ''">重置</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>片库</th>
          <th>库位号</th>
          <th>物资</th>
          <th>可用量</th>
          <th>在途占用</th>
          <th>储备定额</th>
          <th>可发余量</th>
          <th>账况</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="`${row.locationCode}-${row.materialCode}`" :class="{ 'row-danger': row.free < 0 }">
          <td>{{ row.zoneName }}</td>
          <td>{{ row.locationCode }} {{ row.locationName }}</td>
          <td>{{ row.materialName }}（{{ row.unit }}）</td>
          <td>{{ row.available }}</td>
          <td>{{ row.holding }}</td>
          <td>{{ row.quota }}</td>
          <td :class="row.free < 0 ? 'danger-text' : ''">{{ row.free }}</td>
          <td>
            <span v-if="row.available < row.quota" class="tag tag-danger">可用已破定额</span>
            <span v-else-if="row.free < 0" class="tag tag-warn">占用后不可再发</span>
            <span v-else class="tag tag-ok">正常</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="8" class="empty-state">当前筛选条件下没有库位账</td>
        </tr>
      </tbody>
    </table>
    <p class="hint">总量不允许直接修改：可用量、在途占用只能由逐库位的出入库登记、领用发放和盘点导入推导。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { listReferenceData, listStock, type StockViewRow } from '@/data/floodmaterial/service'

const refs = listReferenceData()
const zoneCode = ref('')
const materialCode = ref('')
const tick = ref(0)

const rows = computed<StockViewRow[]>(() => {
  void tick.value
  return listStock(zoneCode.value || undefined).filter(
    (row) => !materialCode.value || row.materialCode === materialCode.value,
  )
})

const cards = computed(() => {
  void tick.value
  const all = listStock(zoneCode.value || undefined)
  return [
    { label: '库位账条数', value: all.length, danger: false },
    { label: '在途占用总量', value: all.reduce((s, r) => s + r.holding, 0), danger: false },
    {
      label: '可用已破定额库位',
      value: all.filter((r) => r.available < r.quota).length,
      danger: true,
    },
    {
      label: '占用后不可再发',
      value: all.filter((r) => r.free < 0).length,
      danger: true,
    },
  ]
})

function reload() {
  tick.value += 1
}

defineExpose({ reload })
</script>
