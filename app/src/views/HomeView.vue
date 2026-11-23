<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { parseTransactionsWithAI } from '../ai/openrouter'
import { useApp } from '../composables/useApp'
import { formatTWD } from '../dates'

const { state, reviewBook, reviewBusy, pendingBatches, stageDrafts } = useApp()
const router = useRouter()
const prompt = ref('')
const parsing = ref(false)
const parseError = ref('')
const pendingCount = computed(() => pendingBatches.value.reduce((total, batch) => total + batch.drafts.length, 0))

async function parse() {
  if (parsing.value || reviewBusy.value || state.loading || !prompt.value.trim() || !state.openRouterKey) return
  const book = reviewBook.value
  parseError.value = ''
  parsing.value = true

  try {
    const result = await parseTransactionsWithAI(state.openRouterKey, state.model, prompt.value)
    await stageDrafts(result.transactions, { kind: 'ai-text', modelUsed: result.modelUsed }, book)
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
        <textarea id="ai-transaction-input" v-model="prompt" placeholder="午餐 120 信用卡" :disabled="parsing" @keydown.ctrl.enter.prevent="parse" />
      </div>
      <p class="muted small" style="margin: 0">按下解析會將文字傳給 OpenRouter；你確認後才會寫入試算表。</p>
      <button class="btn accent block" :disabled="parsing || reviewBusy || state.loading || !prompt.trim() || !state.openRouterKey" @click="parse">
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
