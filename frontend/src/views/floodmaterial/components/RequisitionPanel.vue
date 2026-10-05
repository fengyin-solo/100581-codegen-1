<template>
  <section>
    <div class="form-card">
      <h3>领用单提交（系统自动判定能不能发）</h3>
      <p class="hint">
        判定口径：片库各库位「可用量合计 − 在途占用合计 − 储备定额合计」为可发余量，申请量够不到定额即退回并写明差额；
        同一领用单号重复点两次只扣一次。
      </p>
      <form class="entry-form" @submit.prevent="submitReq">
        <label class="filter-item">
          <span>领用单号</span>
          <input v-model="form.reqNo" :placeholder="`如 LYD-2026-09${String(10 + requisitions.length).slice(-2)}`" />
        </label>
        <label class="filter-item">
          <span>片库</span>
          <select v-model="form.zoneCode">
            <option v-for="z in refs.zones" :key="z.code" :value="z.code">{{ z.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>物资</span>
          <select v-model="form.materialCode">
            <option v-for="m in refs.materials" :key="m.code" :value="m.code">{{ m.name }}（{{ m.unit }}）</option>
          </select>
        </label>
        <label class="filter-item">
          <span>申请数量</span>
          <input v-model.number="form.qty" type="number" min="1" step="1" />
        </label>
        <div class="form-actions">
          <button class="btn primary" type="submit">提交领用单</button>
          <button class="btn" type="button" @click="submitDuplicate">重复点第二次（验证只扣一次）</button>
        </div>
      </form>
      <dl class="summary-line">
        <template v-if="summary">
          <span>该片库该物资：可用 {{ summary.available }}</span>
          <span>在途占用 {{ summary.holding }}</span>
          <span>储备定额 {{ summary.quota }}</span>
          <span :class="summary.free < 0 ? 'danger-text' : 'ok-text'">可发余量 {{ summary.free }}</span>
        </template>
      </dl>
    </div>

    <div class="form-card concurrency-card">
      <h3>并发场景：库管员与调度室同时提交同一张领用单</h3>
      <p class="hint">
        两边在同一刻各提交一张相同单号的领用单，系统按到达先后裁决：只认先到的一张，后到的一张按重复挡回。
        点击后到达顺序随机，多试几次可以看到两种「先到方」结果。
      </p>
      <form class="entry-form" @submit.prevent="runConcurrent">
        <label class="filter-item">
          <span>领用单号</span>
          <input v-model="concurrent.reqNo" placeholder="双方共用同一单号" />
        </label>
        <label class="filter-item">
          <span>片库</span>
          <select v-model="concurrent.zoneCode">
            <option v-for="z in refs.zones" :key="z.code" :value="z.code">{{ z.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>物资</span>
          <select v-model="concurrent.materialCode">
            <option v-for="m in refs.materials" :key="m.code" :value="m.code">{{ m.name }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>数量</span>
          <input v-model.number="concurrent.qty" type="number" min="1" step="1" />
        </label>
        <div class="form-actions">
          <button class="btn primary" type="submit">模拟双方同时提交</button>
        </div>
      </form>
      <div v-if="concurrentReport" class="concurrency-result">
        <p class="hint">到达顺序：{{ concurrentReport.order.join(' → ') }}</p>
        <ul>
          <li v-for="item in concurrentReport.results" :key="item.partyLabel">
            <strong>{{ item.partyLabel }}：</strong>
            <span :class="item.duplicate ? 'warn-text' : item.ok ? 'ok-text' : 'danger-text'">
              {{ item.duplicate ? '按重复挡回' : item.ok ? '已受理' : '未受理' }}
            </span>
            — {{ item.message }}
          </li>
        </ul>
      </div>
    </div>

    <h3>领用单台账与逐库位发放</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>领用单号</th>
          <th>片库</th>
          <th>物资</th>
          <th>申请量</th>
          <th>提交方</th>
          <th>提交时间</th>
          <th>判定</th>
          <th>发放进度</th>
          <th>逐库位发放</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in requisitions" :key="r.id">
          <td>{{ r.reqNo }}</td>
          <td>{{ r.zoneName }}</td>
          <td>{{ r.materialName }}（{{ r.unit }}）</td>
          <td>{{ r.qty }}</td>
          <td>{{ r.source === 'keeper' ? `库管员 ${r.submitter}` : '调度室' }}</td>
          <td>{{ r.submittedAt }}</td>
          <td>
            <span v-if="r.status === 'approved'" class="tag tag-ok">已批准</span>
            <span v-else class="tag tag-danger">已退回，还差 {{ r.shortage }}</span>
          </td>
          <td>
            <template v-if="r.status === 'approved'">
              已发 {{ r.issued }} / 在途待发 {{ r.holdingLeft }}
              <div v-for="line in r.issueLines" :key="line.id" class="issue-line">
                {{ line.issuedAt }} · {{ line.locationCode }} 出 {{ line.qty }} · {{ line.docNo }} · {{ line.handler }}
              </div>
            </template>
            <span v-else>—</span>
          </td>
          <td>
            <form v-if="r.status === 'approved' && r.holdingLeft > 0" class="issue-form" @submit.prevent="issue(r)">
              <select v-model="issueDraft[r.reqNo].locationCode">
                <option v-for="l in locsOfZone(r.zoneCode)" :key="l.code" :value="l.code">{{ l.code }}</option>
              </select>
              <input v-model.number="issueDraft[r.reqNo].qty" type="number" min="1" :max="r.holdingLeft" />
              <input v-model="issueDraft[r.reqNo].docNo" placeholder="出库单据号" />
              <button class="btn" type="submit">发放</button>
            </form>
            <span v-else-if="r.fullyIssued" class="tag tag-ok">已发完</span>
            <span v-else class="hint">退回单不发放</span>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { useFloodSession } from '@/stores/flood-session'
import {
  issueRequisition,
  listReferenceData,
  listRequisitions,
  submitRequisition,
  submitRequisitionConcurrent,
  zoneMaterialSummary,
  type ConcurrentResultItem,
  type RequisitionView,
} from '@/data/floodmaterial/service'

const emit = defineEmits<{ (e: 'result', payload: { ok: boolean; message: string }): void }>()

const session = useFloodSession()
const refs = listReferenceData()

const form = reactive({ reqNo: '', zoneCode: 'A', materialCode: refs.materials[0]?.code ?? '', qty: 100 })
const tick = ref(0)

const requisitions = computed<RequisitionView[]>(() => {
  void tick.value
  return listRequisitions()
})

const summary = computed(() => {
  void tick.value
  return zoneMaterialSummary(form.zoneCode, form.materialCode)
})

function locsOfZone(zoneCode: string) {
  return refs.locations.filter((l) => l.zoneCode === zoneCode)
}

const issueDraft = reactive<Record<string, { locationCode: string; qty: number; docNo: string }>>({})
function ensureDraft(r: RequisitionView) {
  if (!issueDraft[r.reqNo]) {
    issueDraft[r.reqNo] = { locationCode: locsOfZone(r.zoneCode)[0]?.code ?? '', qty: r.holdingLeft, docNo: '' }
  }
}
watch(
  requisitions,
  (list) => list.forEach(ensureDraft),
  { deep: false },
)

function submitReq() {
  const result = submitRequisition(session.toActor(), {
    reqNo: form.reqNo,
    zoneCode: form.zoneCode,
    materialCode: form.materialCode,
    qty: Number(form.qty),
  })
  emit('result', { ok: result.ok, message: result.message })
  if (result.ok) {
    tick.value += 1
    form.reqNo = ''
  }
}

// 同一张领用单再点一次：即使内容一模一样，也应被幂等挡回，不再扣减。
function submitDuplicate() {
  const result = submitRequisition(session.toActor(), {
    reqNo: form.reqNo,
    zoneCode: form.zoneCode,
    materialCode: form.materialCode,
    qty: Number(form.qty),
  })
  emit('result', {
    ok: result.ok,
    message: result.duplicate ? result.message : `第二次提交结果：${result.message}`,
  })
  tick.value += 1
}

const concurrent = reactive({
  reqNo: 'LYD-2026-RACE',
  zoneCode: 'A',
  materialCode: 'M-BZD',
  qty: 50,
})
const concurrentReport = ref<{ order: string[]; results: ConcurrentResultItem[] } | null>(null)

function shuffle<T>(list: T[]): T[] {
  const arr = [...list]
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function runConcurrent() {
  const keeper = refs.keepers.find((k) => k.zoneCode === concurrent.zoneCode)
  const base = {
    reqNo: concurrent.reqNo.trim(),
    zoneCode: concurrent.zoneCode,
    materialCode: concurrent.materialCode,
    qty: Number(concurrent.qty),
  }
  const parties = shuffle([
    {
      partyLabel: `库管员 ${keeper?.name ?? ''}`,
      actor: { role: 'keeper' as const, keeperCode: keeper?.code, name: keeper?.name ?? '', now: session.time },
      input: base,
    },
    {
      partyLabel: '调度室',
      actor: { role: 'dispatcher' as const, name: '调度室', now: session.time },
      input: base,
    },
  ])
  const result = submitRequisitionConcurrent(parties)
  if (result.ok && result.data) {
    concurrentReport.value = result.data
    result.data.results.forEach((item) =>
      emit('result', { ok: item.ok, message: `${item.partyLabel}：${item.message}` }),
    )
    tick.value += 1
  }
}

function issue(r: RequisitionView) {
  const draft = issueDraft[r.reqNo]
  const docNo = draft.docNo.trim() || `CK-${Date.now().toString().slice(-8)}`
  const result = issueRequisition(session.toActor(), {
    reqNo: r.reqNo,
    locationCode: draft.locationCode,
    qty: Number(draft.qty),
    docNo,
  })
  emit('result', { ok: result.ok, message: result.message })
  if (result.ok) {
    draft.docNo = ''
    tick.value += 1
  }
}
</script>
