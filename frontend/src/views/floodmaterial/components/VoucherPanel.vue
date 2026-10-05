<template>
  <section>
    <div class="form-card">
      <h3>逐库位出入库登记</h3>
      <p class="hint">必须按库位逐条登记并留下经手人、单据号；没有「按总量改库存」的入口。</p>
      <form class="entry-form" @submit.prevent="submit">
        <label class="filter-item">
          <span>类型</span>
          <select v-model="form.kind">
            <option value="in">入库</option>
            <option value="out">出库</option>
          </select>
        </label>
        <label class="filter-item">
          <span>片库</span>
          <select v-model="form.zoneCode">
            <option v-for="z in refs.zones" :key="z.code" :value="z.code">{{ z.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>库位号</span>
          <select v-model="form.locationCode">
            <option value="">请选择库位</option>
            <option v-for="l in locationsInZone" :key="l.code" :value="l.code">{{ l.code }} {{ l.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>物资</span>
          <select v-model="form.materialCode">
            <option v-for="m in refs.materials" :key="m.code" :value="m.code">{{ m.name }}（{{ m.unit }}）</option>
          </select>
        </label>
        <label class="filter-item">
          <span>数量</span>
          <input v-model.number="form.qty" type="number" min="1" step="1" />
        </label>
        <label class="filter-item">
          <span>单据号</span>
          <input v-model="form.docNo" :placeholder="suggestedDocNo" />
        </label>
        <label class="filter-item">
          <span>发生时间</span>
          <input v-model="form.happenedAt" type="datetime-local" />
        </label>
        <label class="filter-item grow">
          <span>备注</span>
          <input v-model="form.remark" placeholder="用途、来货单位等（选填）" />
        </label>
        <div class="form-actions">
          <button class="btn primary" type="submit">{{ form.kind === 'in' ? '登记入库' : '登记出库' }}</button>
          <span class="hint">经手人：{{ session.scopeLabel }}</span>
        </div>
      </form>
    </div>

    <h3>出入库 / 盘点台账</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>类型</th>
          <th>单据号</th>
          <th>片库</th>
          <th>库位号</th>
          <th>物资</th>
          <th>变动量</th>
          <th>经手人</th>
          <th>关联单据/备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in vouchers" :key="v.id">
          <td>{{ v.happenedAt }}</td>
          <td>{{ v.kindLabel }}</td>
          <td>{{ v.docNo }}</td>
          <td>{{ v.zoneCode }}</td>
          <td>{{ v.locationCode }}</td>
          <td>{{ v.materialName }}</td>
          <td :class="v.delta < 0 ? 'danger-text' : 'ok-text'">{{ v.delta > 0 ? '+' : '' }}{{ v.delta }}</td>
          <td>{{ v.handler }}</td>
          <td>{{ [v.refNo, v.remark].filter(Boolean).join(' / ') || '—' }}</td>
        </tr>
        <tr v-if="!vouchers.length">
          <td colspan="9" class="empty-state">暂无台账流水</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { useFloodSession } from '@/stores/flood-session'
import {
  listReferenceData,
  listVouchers,
  registerVoucher,
  type VoucherView,
} from '@/data/floodmaterial/service'
import type { VoucherKind } from '@/data/floodmaterial/types'

const emit = defineEmits<{ (e: 'result', payload: { ok: boolean; message: string }): void }>()

const session = useFloodSession()
const refs = listReferenceData()

const form = reactive({
  kind: 'out' as VoucherKind,
  zoneCode: 'A',
  locationCode: '',
  materialCode: refs.materials[0]?.code ?? '',
  qty: 1,
  docNo: '',
  happenedAt: '',
  remark: '',
})

const locationsInZone = computed(() => refs.locations.filter((l) => l.zoneCode === form.zoneCode))
watch(
  locationsInZone,
  (list) => {
    if (!list.some((l) => l.code === form.locationCode)) {
      form.locationCode = list[0]?.code ?? ''
    }
  },
  { immediate: true },
)

const seq = ref(0)
const vouchers = computed<VoucherView[]>(() => {
  void seq.value
  return listVouchers()
})

const suggestedDocNo = computed(() => `${form.kind === 'in' ? 'RK' : 'CK'}-${Date.now().toString().slice(-8)}`)

function toLocalInput(time: string): string {
  return time.replace(' ', 'T')
}

watch(
  () => session.time,
  (time) => {
    form.happenedAt = toLocalInput(time)
  },
  { immediate: true },
)

function submit() {
  const result = registerVoucher(session.toActor(), {
    docNo: form.docNo || suggestedDocNo.value,
    kind: form.kind,
    locationCode: form.locationCode,
    materialCode: form.materialCode,
    qty: Number(form.qty),
    happenedAt: form.happenedAt.replace('T', ' ') || session.time,
    remark: form.remark,
  })
  emit('result', { ok: result.ok, message: result.message })
  if (result.ok) {
    form.docNo = ''
    form.qty = 1
    form.remark = ''
    seq.value += 1
  }
}
</script>
