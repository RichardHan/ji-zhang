<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmTransactions from '../components/ConfirmTransactions.vue'
import TransactionForm from '../components/TransactionForm.vue'
import { hasAnyLocalReady, parseImage, parseText } from '../ai'
import { useApp } from '../composables/useApp'
import { formatTWD, todayISO } from '../dates'
import type { DraftTransaction } from '../types'

const { state, addDrafts, aiSettings } = useApp()
const router = useRouter()
const prompt = ref('')
const parsing = ref(false)
const parseError = ref('')
const parseNotice = ref('')
const drafts = ref<DraftTransaction[]>([])
const modelUsed = ref('')
const photoName = ref('')
const photoDataUrl = ref('')
const photoInput = ref<HTMLInputElement | null>(null)
const editingIndex = ref<number | null>(null)
const editDraft = ref<DraftTransaction>(emptyDraft())
const localReady = ref(false)

function emptyDraft(): DraftTransaction {
  return {
    date: todayISO(),
    amount: 0,
    category: '餐飲',
    account: '',
    note: '',
    type: '支出',
  }
}

onMounted(async () => {
  localReady.value = await hasAnyLocalReady({
    localModelId: state.localModelId,
    enableNanoFallback: state.enableNanoFallback,
  })
})

const canUseCloud = () => Boolean(state.openRouterKey)
const canParse = () => {
  if (state.aiProvider === 'openrouter') return canUseCloud()
  if (state.aiProvider === 'local') return localReady.value
  return localReady.value || canUseCloud()
}

function providerLabel(provider: 'local' | 'nano' | 'openrouter'): string {
  if (provider === 'local') return '本機 LiteRT-LM'
  if (provider === 'nano') return '本機 Gemini Nano'
  return 'OpenRouter'
}

function onPickPhoto(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  photoName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    photoDataUrl.value = typeof reader.result === 'string' ? reader.result : ''
  }
  reader.readAsDataURL(file)
}

function clearPhoto() {
  photoName.value = ''
  photoDataUrl.value = ''
  if (photoInput.value) photoInput.value.value = ''
}

async function parse() {
  parseError.value = ''
  parseNotice.value = ''
  parsing.value = true
  drafts.value = []
  try {
    const result = photoDataUrl.value
      ? await parseImage(aiSettings(), photoDataUrl.value, prompt.value)
      : await parseText(aiSettings(), prompt.value)
    drafts.value = result.transactions
    modelUsed.value = `${providerLabel(result.provider)} · ${result.modelUsed}`
    parseNotice.value = result.notice ?? ''
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err)
  } finally {
    parsing.value = false
  }
}

async function confirm() {
  parseError.value = ''
  try {
    await addDrafts(drafts.value)
    drafts.value = []
    prompt.value = ''
    modelUsed.value = ''
    parseNotice.value = ''
    clearPhoto()
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err)
  }
}

function startEdit(index: number) {
  editingIndex.value = index
  editDraft.value = { ...drafts.value[index] }
}

function applyEdit() {
  if (editingIndex.value === null) return
  drafts.value[editingIndex.value] = { ...editDraft.value }
  editingIndex.value = null
}

const recent = () => state.transactions.slice(0, 5)
</script>

<template>
  <div class="page">
    <h1 class="page-title">記一筆</h1>
    <p class="page-sub">打一句話，例如「午餐 120 信用卡」或「昨天晚餐 350 搭車 180」。</p>

    <div v-if="!canParse()" class="banner warn">
      本機模型還沒就緒，也還沒有 OpenRouter 金鑰。可以先用手動記帳，或到
      <router-link to="/settings">設定</router-link>
      下載本機模型或貼上金鑰（預設會自動選免費模型）。
    </div>
    <div v-if="parseNotice" class="banner warn">{{ parseNotice }}</div>
    <div v-if="parseError" class="banner error">{{ parseError }}</div>

    <div class="card stack ai-box">
      <div class="field">
        <label>用 AI 記帳</label>
        <textarea v-model="prompt" placeholder="午餐 120 信用卡，或先選收據照片再補充一句" :disabled="parsing" @keydown.ctrl.enter="parse" />
      </div>
      <input ref="photoInput" class="sr-only" type="file" accept="image/*" @change="onPickPhoto" />
      <div class="row">
        <button type="button" class="btn ghost grow" :disabled="parsing" @click="photoInput?.click()">選取收據照片</button>
        <button v-if="photoDataUrl" type="button" class="btn ghost" :disabled="parsing" @click="clearPhoto">清除照片</button>
      </div>
      <p v-if="photoName" class="muted small">已選：{{ photoName }}</p>
      <img v-if="photoDataUrl" class="receipt-thumb" :src="photoDataUrl" alt="收據預覽" />
      <button class="btn accent block" :disabled="parsing || (!prompt.trim() && !photoDataUrl) || !canParse()" @click="parse">
        {{ parsing ? '解析中…' : photoDataUrl ? '解析照片並預覽' : '解析並預覽' }}
      </button>
      <button class="btn ghost block" @click="router.push('/add')">改用手動記一筆</button>
    </div>

    <div v-if="drafts.length && editingIndex === null" style="margin-top: 16px">
      <ConfirmTransactions
        :drafts="drafts"
        :model-used="modelUsed"
        @confirm="confirm"
        @cancel="drafts = []"
        @edit="startEdit"
      />
    </div>

    <div v-if="editingIndex !== null" class="card" style="margin-top: 16px">
      <h3>修改這一筆</h3>
      <TransactionForm v-model="editDraft" submit-label="套用" @submit="applyEdit" @cancel="editingIndex = null" />
    </div>

    <div style="margin-top: 24px">
      <div class="row space">
        <h2 style="margin: 0; font-size: 1.05rem">最近記錄</h2>
        <router-link to="/list" class="small">查看全部</router-link>
      </div>
      <div v-if="!state.transactions.length" class="muted small" style="margin-top: 12px">還沒有記錄。</div>
      <div v-else class="card" style="padding: 4px 16px; margin-top: 10px">
        <div v-for="t in recent()" :key="t.id" class="tx-item">
          <div>
            <div>{{ t.note || t.category }}</div>
            <div class="meta">{{ t.date }} · {{ t.category }}{{ t.account ? ' · ' + t.account : '' }}</div>
          </div>
          <div class="amount" :class="t.type === '收入' ? 'income' : 'expense'">
            {{ t.type === '收入' ? '+' : '-' }}{{ formatTWD(t.amount) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
