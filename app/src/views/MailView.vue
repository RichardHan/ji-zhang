<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { invoiceEventId } from '../invoice'
import { parseMail, type MailResult } from '../mail'
import { readMailAttachment, readMailFile, type SelectedMail } from '../mailFile'
import { sharedMail } from '../receiptInput'
import { missingDraftFields } from '../review'

const router = useRouter()
const { reviewBook, state, reviewBusy, stageDrafts } = useApp()
const pasted = ref('')
const mail = shallowRef<SelectedMail>()
const result = ref<MailResult>()
const busy = ref(false)
const error = ref('')
const input = ref<HTMLInputElement>()
let active = true
onUnmounted(() => { active = false })
const actionLabels = { purchase: '消費', refund: '退款', cancel: '取消交易', declined: '交易未成立' }
const titles = { bill: '帳單摘要', invoice: '郵件發票', card: '信用卡通知' }

function read(source: SelectedMail) {
  mail.value = source
  result.value = undefined
  error.value = ''
  try { result.value = parseMail(source.text, source.subject) }
  catch (err) { error.value = err instanceof Error ? err.message : '無法辨識郵件。' }
}

function reset() {
  result.value = undefined
  mail.value = undefined
  pasted.value = ''
  error.value = ''
}

async function receive() {
  const share = sharedMail.value
  if (!share) return
  sharedMail.value = undefined
  reset()
  if (share.error) error.value = share.error
  else if (share.eml) {
    const book = reviewBook.value
    busy.value = true
    try {
      const bytes = Uint8Array.from(atob(share.eml), c => c.charCodeAt(0))
      const selected = await readMailFile(new File([bytes], 'shared.eml'))
      if (active && book === reviewBook.value) read(selected)
    } catch { error.value = '無法解析分享的郵件。' }
    finally { busy.value = false }
  } else read({ text: share.text ?? '', subject: share.subject ?? '', attachments: [] })
}
watch(sharedMail, () => {
  if (!busy.value && !mail.value && !pasted.value) receive()
}, { immediate: true })

async function selectFile(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  field.value = ''
  if (!file) return
  busy.value = true
  const book = reviewBook.value
  reset()
  try {
    const selected = await readMailFile(file)
    if (active && book === reviewBook.value) read(selected)
  } catch (err) { error.value = err instanceof Error ? err.message : '郵件讀取失敗。' }
  finally { busy.value = false }
}

async function attachment(index: number) {
  const selected = mail.value
  if (!selected || busy.value) return
  const book = reviewBook.value
  busy.value = true
  error.value = ''
  try {
    const data = await readMailAttachment(selected.attachments[index])
    if (!active || book !== reviewBook.value) return
    result.value = parseMail(selected.text, selected.subject, data)
  } catch (err) {
    result.value = undefined
    error.value = err instanceof Error ? err.message : '附件讀取失敗。'
  } finally { busy.value = false }
}

async function stage() {
  const item = result.value
  if (!item?.draft || busy.value || reviewBusy.value) return
  const kind = item.kind === 'invoice' ? 'mail-invoice' : 'mail-card'
  const missing = missingDraftFields(item.draft, kind)
  if (missing.length) { error.value = '請補齊：' + missing.join('、'); return }
  const number = (item.number ?? '').trim().replace(/-/g, '').toUpperCase()
  if (number && !/^[A-Z]{2}\d{8}$/.test(number)) { error.value = '請核對發票號碼。'; return }
  const eventId = invoiceEventId(number, item.draft.date) || mail.value?.id
  try {
    await stageDrafts([item.draft], { kind, invoiceNumber: number || undefined, eventId,
      mailDetail: item.kind === 'card' ? [item.action && actionLabels[item.action], item.money, item.time].filter(Boolean).join(' · ') : undefined })
    if (active) await router.push({ name: 'review' })
  } catch (err) { error.value = err instanceof Error ? err.message : '無法加入清單。' }
}
</script>

<template>
  <div class="page stack">
    <h1 class="page-title">匯入 Gmail 郵件</h1>
    <p class="page-sub">選取一封 .eml、純文字檔，或貼上主旨與內文。郵件只在裝置上讀取。</p>
    <button v-if="sharedMail" class="btn ghost" :disabled="busy" @click="receive">讀取新分享的郵件</button>
    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
    <p v-if="busy" role="status">正在讀取郵件…</p>
    <div v-if="!result" class="card stack">
      <input ref="input" hidden type="file" accept=".eml,.txt,message/rfc822,text/plain" @change="selectFile" />
      <button class="btn ghost" :disabled="busy" @click="input?.click()">選取郵件檔案</button>
      <label for="mail-text">郵件主旨與內文</label>
      <textarea id="mail-text" v-model="pasted" rows="5" maxlength="65536" :disabled="busy" />
      <button class="btn accent" :disabled="busy || !pasted.trim()" @click="read({ text: pasted, subject: '', attachments: [] })">讀取郵件</button>
    </div>
    <div v-if="mail?.attachments.length" class="card stack">
      <strong>選取要核對的附件</strong>
      <button v-for="(part, i) in mail.attachments" :key="i" class="btn ghost" :disabled="busy" @click="attachment(i)">
        {{ part.filename || '附件 ' + (i + 1) }}
      </button>
    </div>
    <section v-if="result" class="card stack">
      <h2>{{ titles[result.kind] }}</h2>
      <template v-if="result.kind === 'bill'">
        <div>帳單期間：{{ result.period || '未提供' }}</div>
        <div>應繳金額：{{ result.money || '未確認' }}</div>
        <div>到期日：{{ result.due || '未確認' }}</div>
        <p class="banner warn">應繳金額僅供核對，帳單明細不會再次列為支出。</p>
      </template>
      <template v-if="result.kind === 'card'">
        <div>交易類型：{{ result.action && actionLabels[result.action] }}</div>
        <div>通知金額：{{ result.money || '未確認' }} · 時間：{{ result.time || '未提供' }}</div>
        <p v-if="!result.draft" class="banner warn">此通知不會新增交易。</p>
      </template>
      <template v-if="result.kind === 'invoice'">
        <label for="mail-number">發票號碼（一般收據可留白）</label>
        <input id="mail-number" v-model="result.number" />
        <p class="banner warn">付款狀態待核對。加入待確認清單後，請在已付款時確認入帳。</p>
      </template>
      <TransactionForm v-if="result.draft" v-model="result.draft" submit-label="加入待確認清單"
        :disabled="busy || state.loading || reviewBusy" @submit="stage" @cancel="reset" />
      <button v-else class="btn ghost" :disabled="busy" @click="reset">讀取另一封郵件</button>
    </section>
    <router-link to="/review">查看待確認清單</router-link>
  </div>
</template>
