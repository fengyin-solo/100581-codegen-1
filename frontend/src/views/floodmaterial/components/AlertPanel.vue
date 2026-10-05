<template>
  <section>
    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">未核销警示</span>
        <strong class="stat-value danger-text">{{ openAlerts.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">盘点差异</span>
        <strong class="stat-value">{{ countOf('stocktake_diff') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">领用退回</span>
        <strong class="stat-value">{{ countOf('requisition_rejected') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">低于定额</span>
        <strong class="stat-value">{{ countOf('below_quota') }}</strong>
      </article>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>类型</th>
          <th>片库</th>
          <th>库位号</th>
          <th>物资</th>
          <th>警示内容</th>
          <th>状态</th>
          <th v-if="session.role === 'dispatcher'">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in alerts" :key="a.id">
          <td>{{ a.createdAt }}</td>
          <td><span class="tag" :class="tagClass(a.kind)">{{ a.kindLabel }}</span></td>
          <td>{{ a.zoneName }}</td>
          <td>{{ a.locationName || '片库汇总' }}</td>
          <td>{{ a.materialName }}</td>
          <td>{{ a.message }}</td>
          <td>{{ a.resolved ? '已核销' : '待处理' }}</td>
          <td v-if="session.role === 'dispatcher'">
            <button v-if="!a.resolved" class="link" type="button" @click="resolve(a.id)">核销</button>
            <span v-else>—</span>
          </td>
        </tr>
        <tr v-if="!alerts.length">
          <td :colspan="session.role === 'dispatcher' ? 8 : 7" class="empty-state">没有物资警示</td>
        </tr>
      </tbody>
    </table>
    <p class="hint">库管员只能看到本片区的警示；盘点差异、领用退回、出库后破定额都会自动汇总到这里。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useFloodSession } from '@/stores/flood-session'
import { listAlerts, resolveAlert, type AlertView } from '@/data/floodmaterial/service'
import type { AlertKind } from '@/data/floodmaterial/types'

const emit = defineEmits<{ (e: 'result', payload: { ok: boolean; message: string }): void }>()

const session = useFloodSession()
const tick = ref(0)

const zoneScope = computed(() => (session.role === 'keeper' ? session.keeper?.zoneCode : undefined))
const alerts = computed<AlertView[]>(() => {
  void tick.value
  return listAlerts(zoneScope.value, true)
})
const openAlerts = computed(() => alerts.value.filter((a) => !a.resolved))

function countOf(kind: AlertKind): number {
  return openAlerts.value.filter((a) => a.kind === kind).length
}

function tagClass(kind: AlertKind): string {
  if (kind === 'stocktake_diff') return 'tag-warn'
  if (kind === 'requisition_rejected') return 'tag-danger'
  return 'tag-warn'
}

function resolve(id: number) {
  const result = resolveAlert(session.toActor(), id)
  emit('result', { ok: result.ok, message: result.message })
  if (result.ok) tick.value += 1
}
</script>
