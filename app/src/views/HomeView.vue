<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { parseTransactionsWithAI } from '../ai/openrouter'
import { useApp } from '../composables/useApp'
import { formatTWD } from '../dates'
import { bookkeepingSpeech, canUseBookkeepingSpeech } from '../speech'

const { state, reviewBook, reviewBusy, pendingBatches, stageDrafts } = useApp()
const router = useRouter()
const prompt = ref('')
const parsing = ref(false)
const parseError = ref('')
const listening = ref(false)
const usedVoice = ref(false)
const speechStatus = ref('')
const speechError = ref('')
const pendingCount = computed(() => pendingBatches.value.reduce((total, batch) => total + batch.drafts.length, 0))

async function dictate() {
  if (!canUseBookkeepingSpeech || listening.value || parsing.value) return
  listening.value = true
  speechStatus.value = ''
  speechError.value = ''
  try {
    const { text } = await bookkeepingSpeech.recognize()
    const transcript = text?.trim()
    if (!transcript) {
      speechStatus.value = '已結束語音輸入，原有文字未變更。'
      return
    }
    const existing = prompt.value.trimEnd()
    prompt.value = existing ? `${existing}\n${transcript}` : transcript
    usedVoice.value = true
    speechStatus.value = '已轉成文字，可先修改，再按「解析並預覽」。'
  } catch (err) {
    speechError.value = err instanceof Error ? err.message : '無法使用語音輸入，請改用鍵盤。'
  } finally {
    listening.value = false
  }
}

watch(prompt, (text) => {
  if (!text.trim()) {
    usedVoice.value = false
    speechStatus.value = ''
  }
})

async function parse() {
  if (listening.value || parsing.value || reviewBusy.value || state.loading || !prompt.value.trim() || !state.openRouterKey) return
  const book = reviewBook.value
  parseError.value = ''
  speechError.value = ''
  parsing.value = true

  try {
    const result = await parseTransactionsWithAI(state.openRouterKey, state.model, prompt.value)
    await stageDrafts(result.transactions, { kind: usedVoice.value ? 'voice' : 'ai-text', modelUsed: result.modelUsed }, book)
    prompt.value = ''
    if (router.currentRoute.value.name === 'home') await router.push({ name: 'review' })
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : String(err)
  } finally {
    parsing.value = false
  }
}

const recent = () => state.transactions.slice(0, 5)
</script>

<template>
  <div class="page">
    <h1 class="page-title">記一筆</h1>
    <p class="page-sub">打一句話，例如「午餐 120 信用卡」或「昨天晚餐 350 搭車 180」。</p>

    <div v-if="!state.openRouterKey" class="banner warn">
      還沒有 OpenRouter 金鑰。可以先用手動記帳，或到
      <router-link to="/settings">設定</router-link>
      貼上金鑰後再用 AI。
    </div>
    <div v-if="parseError" class="banner error">{{ parseError }}</div>
    <p><router-link to="/review">待確認清單（{{ pendingCount }} 筆）</router-link></p>

    <div class="card stack ai-box">
      <div class="field">
        <label for="ai-transaction-input">用 AI 記帳（TWD）</label>
        <textarea
          id="ai-transaction-input"
          v-model="prompt"
          placeholder="午餐 120 信用卡"
          :disabled="listening || parsing"
          @keydown.ctrl.enter.prevent="parse"
        />
      </div>
      <template v-if="canUseBookkeepingSpeech">
        <p id="speech-privacy" class="muted small" style="margin: 0">
          Android 的語音辨識服務可能會透過網路處理音訊；記帳 App 只接收轉成的文字。
        </p>
        <button type="button" class="btn ghost block" aria-describedby="speech-privacy" :disabled="listening || parsing" @click="dictate">
          {{ listening ? '語音辨識中…' : '使用語音輸入' }}
        </button>
        <p v-if="speechStatus" class="muted small" role="status" style="margin: 0">{{ speechStatus }}</p>
        <p v-if="speechError" class="banner error" role="alert" style="margin: 0">{{ speechError }}</p>
      </template>
      <p class="muted small" style="margin: 0">按下解析會將文字傳給 OpenRouter；你確認後才會寫入試算表。</p>
      <button class="btn accent block" :disabled="listening || parsing || reviewBusy || state.loading || !prompt.trim() || !state.openRouterKey" @click="parse">
        {{ parsing ? '解析中…' : '解析並預覽' }}
      </button>
      <button class="btn ghost block" @click="router.push('/add')">改用手動記一筆</button>
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
