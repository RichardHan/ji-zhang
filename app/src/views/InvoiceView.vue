<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { invoiceCandidate, invoiceEventId, type InvoiceCandidate, type InvoiceInput } from '../invoice'
import { receiptPlugin, nativeReceipts, sharedInvoice, sharedMail } from '../receiptInput'
import { missingDraftFields, validReviewDate } from '../review'

const { checkInvoiceImport, stageDrafts, reviewBook, reviewBusy, state } = useApp()
const router = useRouter()
const pasted = ref('')
const candidate = ref<InvoiceCandidate>()
const error = ref('')
const duplicate = ref('')
const reading = ref(false)
const receivedText = ref('')
let mounted = true
onUnmounted(() => { mounted = false })

watch(() => [candidate.value?.number, candidate.value?.draft.date, reviewBook.value] as const, async ([number, date, book], _, onCleanup) => {
  let current = true
  onCleanup(() => { current = false })
  duplicate.value = ''
  const normalized = number?.replace(/-/g, '').trim().toUpperCase() ?? ''
  if (!book || !date || !validReviewDate(date) || !/^[A-Z]{2}\d{8}$/.test(normalized)) return
  const message = await checkInvoiceImport(invoiceEventId(normalized, date)!, book)
  if (current) duplicate.value = message
})

function read(input: InvoiceInput) {
  error.value = ''
  candidate.value = undefined
  try {
    candidate.value = invoiceCandidate(input)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '無法讀取發票。'
  }
}

function openSharedMail() {
  sharedMail.value = { text: receivedText.value }
  void router.push({ name: 'mail' })
}

function receiveShare() {
  const share = sharedInvoice.value
  if (!share) return
  sharedInvoice.value = undefined
  pasted.value = share.text ?? ''
  receivedText.value = pasted.value
  if (share.error) error.value = share.error
  else read({ text: pasted.value })
}

watch(sharedInvoice, () => {
  if (!candidate.value && !reading.value && !pasted.value) receiveShare()
}, { immediate: true })

async function select(camera: boolean) {
  const book = reviewBook.value
  if (reading.value) return
  reading.value = true
  error.value = ''
  try {
    const result = await receiptPlugin.select({ invoice: true, camera })
    if (mounted && book === reviewBook.value && result && ('codes' in result || 'text' in result)) read(result)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '無法開啟發票檔案。'
  } finally {
    reading.value = false
  }
}

async function stage() {
  const item = candidate.value
  if (!item || reading.value || reviewBusy.value) return
  error.value = ''
  const missing = missingDraftFields(item.draft, 'invoice')
  if (missing.length) { error.value = '請補齊：' + missing.join('、'); return }
  const number = item.number.trim().replace(/-/g, '').toUpperCase()
  if (number && !/^[A-Z]{2}\d{8}$/.test(number)) {
    error.value = '發票號碼應為兩個英文字母和八位數字。'
    return
  }
  try {
    await stageDrafts([item.draft], { kind: 'invoice', invoiceNumber: number || undefined,
      eventId: invoiceEventId(number, item.draft.date) })
    if (mounted) await router.push({ name: 'review' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '無法加入清單。'
  }
}
</script>

<template>
  <div class="page stack">
    <h1 class="page-title">匯入電子發票／收據</h1>
    <p class="page-sub">一次匯入一張，在裝置上讀取內容。核對後加入待確認清單，再確認入帳。</p>
    <button v-if="receivedText" class="btn ghost" @click="openSharedMail">用郵件匯入處理這段分享文字</button>
    <button v-if="sharedInvoice" class="btn ghost" :disabled="reading || reviewBusy" @click="receiveShare">讀取新分享的收據</button>
    <p v-if="duplicate" class="banner warn" role="status">{{ duplicate }}</p>
    <div v-if="error" class="banner error" role="alert">{{ error }}</div>
    <div v-if="!candidate" class="card stack">
      <template v-if="nativeReceipts">
        <button class="btn ghost" :disabled="reading" @click="select(false)">選取收據檔案</button>
        <small>支援 UTF-8 TXT、PDF 和圖片。</small>
        <button class="btn ghost" :disabled="reading" @click="select(true)">拍攝發票 QR Code</button>
        <p v-if="reading" role="status">正在讀取發票…</p>
      </template>
      <label for="invoice-text">收據文字或左側 QR Code 內容</label>
      <textarea id="invoice-text" v-model="pasted" rows="4" :disabled="reading" maxlength="65536" />
      <button class="btn accent" :disabled="reading || !pasted.trim()" @click="read({ text: pasted })">讀取文字</button>
    </div>
    <div v-else class="card stack">
      <label for="invoice-number">發票號碼（一般收據可留白）</label>
      <input id="invoice-number" v-model="candidate.number" placeholder="未提供" />
      <p v-if="missingDraftFields(candidate.draft, 'invoice').length" class="banner warn">
        待補：{{ missingDraftFields(candidate.draft, 'invoice').join('、') }}
      </p>
      <TransactionForm v-model="candidate.draft" submit-label="加入待確認清單" :disabled="state.loading || reviewBusy || !!duplicate"
        @submit="stage" @cancel="candidate = undefined; error = ''" />
    </div>
    <router-link to="/review">查看待確認清單</router-link>
  </div>
</template>
