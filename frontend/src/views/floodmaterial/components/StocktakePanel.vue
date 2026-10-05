<template>
  <section>
    <div class="form-card">
      <h3>历史盘点导入（按当时口径折算成库位可用量与储备定额）</h3>
      <p class="hint">
        每行按「库位号 × 物资」折算：折算后实物量覆盖库位可用量，折算后账面定额覆盖储备定额；
        与账面不符的逐行生成调度室物资警示。同一批次号重复跑不生成第二份。
      </p>
      <form class="entry-form" @submit.prevent="doImport">
        <label class="filter-item">
          <span>盘点批次号</span>
          <input v-model="form.batchNo" placeholder="如 PD-2026-06" />
        </label>
        <label class="filter-item">
          <span>盘点日期</span>
          <input v-model="form.stocktakeDate" type="date" />
        </label>
        <label class="filter-item grow">
          <span>口径说明</span>
          <input v-model="form.caliberNote" placeholder="如：老台账编织袋按捆记账，1 捆 = 50 条" />
        </label>
        <label class="filter-item full">
          <span>盘点明细（CSV，列：库位号,物资编号,历史口径单位,盘点数量,账面定额,折算系数）</span>
          <textarea v-model="form.csvText" rows="9" class="csv-input"></textarea>
        </label>
        <div class="form-actions">
          <button class="btn primary" type="submit">按批次导入</button>
          <button class="btn" type="button" @click="repeatImport">同批次再跑一次（验证不生成第二份）</button>
          <button class="btn ghost" type="button" @click="form.csvText = SAMPLE_CSV">填入示例文本</button>
        </div>
      </form>
    </div>

    <h3>已导入盘点批次</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>批次号</th>
          <th>盘点日期</th>
          <th>口径说明</th>
          <th>导入时间</th>
          <th>导入人</th>
          <th>明细（折算后）</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="batch in batches" :key="batch.id">
          <td>{{ batch.batchNo }}</td>
          <td>{{ batch.stocktakeDate }}</td>
          <td>{{ batch.caliberNote }}</td>
          <td>{{ batch.importedAt }}</td>
          <td>{{ batch.handler }}</td>
          <td>
            <div v-for="row in batch.rows" :key="`${row.locationCode}-${row.materialCode}`" class="issue-line">
              {{ row.locationCode }} · {{ materialName(row.materialCode) }}：
              实物 {{ row.physicalQty }} / 定额 {{ row.bookQuota }}
              <span class="hint">（{{ row.legacyUnit }} × {{ row.factor }}）</span>
            </div>
          </td>
        </tr>
        <tr v-if="!batches.length">
          <td colspan="6" class="empty-state">还没有导入过历史盘点</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'

import { useFloodSession } from '@/stores/flood-session'
import {
  importStocktake,
  listReferenceData,
  listStocktakes,
} from '@/data/floodmaterial/service'
import type { StocktakeBatch } from '@/data/floodmaterial/types'

const emit = defineEmits<{ (e: 'result', payload: { ok: boolean; message: string }): void }>()

const session = useFloodSession()
const refs = listReferenceData()

const SAMPLE_CSV = `库位号,物资编号,历史口径单位,盘点数量,账面定额,折算系数
A-01,M-BZD,捆,28,20,50
A-02,M-BZD,条,650,500,
B-01,M-SBT,条,300,200,
B-02,M-JSY,件,95,100,`

const form = reactive({
  batchNo: 'PD-2026-06',
  stocktakeDate: '2026-06-15',
  caliberNote: '老台账编织袋按捆记账，1 捆 = 50 条',
  csvText: SAMPLE_CSV,
})

const tick = ref(0)
const batches = ref<StocktakeBatch[]>([])
function refresh() {
  tick.value += 1
  batches.value = listStocktakes()
}
refresh()

function materialName(code: string): string {
  return refs.materials.find((m) => m.code === code)?.name ?? code
}

function doImport() {
  const result = importStocktake(session.toActor(), { ...form })
  emit('result', { ok: result.ok, message: result.message })
  if (result.ok) refresh()
}

function repeatImport() {
  const result = importStocktake(session.toActor(), { ...form })
  emit('result', {
    ok: result.ok,
    message: result.duplicate ? result.message : `再次导入结果：${result.message}`,
  })
  refresh()
}
</script>
