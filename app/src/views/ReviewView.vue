<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { formatTWD } from '../dates'
import { missingDraftFields, similarTransactionKey, validReviewAmount } from '../review'
import type { DraftTransaction, ReviewSource } from '../types'

const sourceLabels = {
  manual: '手動輸入',
  'ai-text': 'AI 文字解析',
  voice: '語音輸入',
  video: '影片記帳',
  photo: '收據照片',
  invoice: '電子發票／收據',
  'mail-invoice': '郵件發票',
  'mail-card': '信用卡通知',
} satisfies Record<ReviewSource['kind'], string>

const {
  state, receiptPreviews, reviewBook, reviewBusy, reviewError, pendingBatches, reviewTransactions,
  refreshTransactions, editPendingDraft, confirmPendingBatch, discardPendingBatch,
} = useApp()
const editing = ref<{ batchId: string; index: number; draft: DraftTransaction } | null>(null)
const error = ref('')
const notice = ref('')
const warnings = ref<string[]>([])
const busy = computed(() => reviewBusy.value || state.loading || Boolean(reviewError.value))

const batches = computed(() => {
  const booked = new Set(reviewTransactions.value.map(similarTransactionKey))
  const counts = new Map<string, number>()
  const groups = pendingBatches.value.map((batch) => ({
    batch,
    rows: batch.drafts.map((draft) => {
      const key = similarTransactionKey(draft)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
      return { draft, key, missing: missingDraftFields(draft, batch.source) }
    }),
  }))
  return groups.map(({ batch, rows }) => {
    const reviewed = rows.map(({ draft, key, missing }) => ({
      draft,
      missing,
      duplicate: key && (booked.has(key) ? 'booked' : (counts.get(key) ?? 0) > 1 ? 'pending' : ''),
    }))
    return {
      batch,
      rows: reviewed,
      hasDuplicates: reviewed.some(({ duplicate }) => duplicate),
      needsInput: reviewed.some(({ missing }) => missing.length > 0),
    }
  })
})

onMounted(async () => {
  if (!reviewBook.value || busy.value) return
  try {
    await refreshTransactions()
  } catch {
    warnings.value = ['目前無法更新明細，重複提示可能不完整。']
  }
})

async function run(action: () => Promise<void>) {
  if (busy.value) return
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function startEdit(batchId: string, index: number, draft: DraftTransaction) {
  editing.value = { batchId, index, draft: { ...draft } }
}

function applyEdit() {
  const current = editing.value
  if (!current) return
  return run(async () => {
    await editPendingDraft(current.batchId, current.index, current.draft)
    editing.value = null
  })
}

function skip(id: string, index: number) {
  return run(() => editPendingDraft(id, index))
}

function confirmBatch(id: string) {
  return run(async () => {
    const { result, count, warnings: saveWarnings } = await confirmPendingBatch(id)
    notice.value = result === 'already-written'
      ? '這批已入帳，沒有再次寫入。如需更正，請到明細。'
      : `已入帳 ${count} 筆。`
    warnings.value = saveWarnings
  })
}

function stopRetry(id: string) {
  if (!window.confirm('這批可能已入帳。停止重試只會從本機清單移除，不會刪除試算表資料。確定嗎？')) return
  return run(() => discardPendingBatch(id))
}
</script>

<template>
  <div class="page stack">
    <header>
      <h1 class="page-title">待確認入帳</h1>
      <p class="page-sub">檢查金額、日期與來源。確認之前不會寫入 Google 試算表。</p>
    </header>
    <p v-if="reviewError || error" class="banner error" role="alert">{{ reviewError || error }}</p>
    <p v-if="notice" class="banner ok" role="status">{{ notice }}</p>
    <p v-for="warning in warnings" :key="warning" class="banner warn" role="status">{{ warning }}</p>
    <p v-if="!batches.length && !reviewError" class="muted">沒有待確認的記錄。</p>
    <section v-for="{ batch, rows, hasDuplicates, needsInput } in batches" :key="batch.id" class="card stack">
      <h2 style="margin: 0; font-size: 1rem">{{ sourceLabels[batch.source] }}</h2>
      <small v-if="batch.invoiceNumber">發票號碼 {{ batch.invoiceNumber }}</small>
      <small v-if="batch.mailDetail">{{ batch.mailDetail }}</small>
      <p v-if="batch.source === 'mail-invoice' && !batch.submitted" class="banner warn">請核對付款紀錄，已付款再確認入帳。</p>
      <details v-if="receiptPreviews.has(batch.id)" open>
        <summary>核對收據照片</summary>
        <img :src="receiptPreviews.get(batch.id)" alt="本次收據照片" style="width: 100%; max-height: 42vh; object-fit: contain" />
      </details>
      <small v-if="batch.modelUsed" class="muted">模型：{{ batch.modelUsed }}</small>
      <p v-if="batch.submitted" class="banner warn" role="status">
        這批已嘗試寫入。如果上次結果不明，可以安全重試；不會重複入帳。
      </p>
      <div v-for="({ draft, missing, duplicate }, index) in rows" :key="index" class="stack">
        <div class="tx-item">
          <div>
            <div>{{ draft.note || draft.category }} · {{ draft.category }}</div>
            <div class="meta">{{ draft.date || '日期未確認' }} · {{ draft.account || '未指定帳戶' }}</div>
            <div v-if="missing.length" class="meta">待補：{{ missing.join('、') }}</div>
            <div v-if="!batch.submitted && duplicate" class="meta">
              {{ duplicate === 'booked' ? '疑似重複：明細有相同日期、金額和備註' : '疑似重複：待確認清單有相似項目' }}
            </div>
          </div>
          <span v-if="validReviewAmount(draft.amount)" class="amount" :class="draft.type === '收入' ? 'income' : 'expense'">
            {{ draft.type === '收入' ? '+' : '-' }}{{ formatTWD(draft.amount) }}
          </span>
        </div>
        <TransactionForm
          v-if="editing && editing.batchId === batch.id && editing.index === index"
          v-model="editing.draft"
          submit-label="套用修改"
          :disabled="busy"
          @submit="applyEdit"
          @cancel="editing = null"
        />
        <div v-else-if="!batch.submitted" class="row">
          <button type="button" class="btn ghost" :disabled="busy || !!editing" @click="startEdit(batch.id, index, draft)">修改</button>
          <button type="button" class="btn ghost" :disabled="busy || !!editing" @click="skip(batch.id, index)">
            {{ duplicate === 'booked' ? '保留原交易並略過' : '略過' }}
          </button>
        </div>
      </div>
      <button type="button" class="btn accent block" :disabled="busy || needsInput || !!editing" @click="confirmBatch(batch.id)">
        {{ batch.submitted ? '重試確認' : batch.source === 'mail-invoice' ? '已付款，確認入帳' : hasDuplicates ? '保留並確認入帳' : '確認入帳' }}
      </button>
      <button v-if="batch.submitted" type="button" class="btn ghost block" :disabled="busy" @click="stopRetry(batch.id)">
        停止重試
      </button>
    </section>
    <router-link to="/">返回記帳</router-link>
  </div>
</template>

<style scoped>
.page { gap: 16px; }
.page-sub, .banner { margin: 0; }
</style>
