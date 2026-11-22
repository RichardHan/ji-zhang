<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ConfirmTransactions from '../components/ConfirmTransactions.vue'
import TransactionForm from '../components/TransactionForm.vue'
import { parseTransactionsWithAI } from '../ai/openrouter'
import { useApp } from '../composables/useApp'
import { formatTWD, todayISO } from '../dates'
import type { DraftTransaction } from '../types'

const { state, addDrafts } = useApp()
const router = useRouter()
const prompt = ref('')
const parsing = ref(false)
const parseError = ref('')
const drafts = ref<DraftTransaction[]>([])
const modelUsed = ref('')
const editingIndex = ref<number | null>(null)
const editDraft = ref<DraftTransaction>(emptyDraft())

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

async function parse() {
  parseError.value = ''
  parsing.value = true
  drafts.value = []
  try {
    const result = await parseTransactionsWithAI(state.openRouterKey, state.model, prompt.value)
    drafts.value = result.transactions
    modelUsed.value = result.modelUsed
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

    <div v-if="!state.openRouterKey" class="banner warn">
      還沒有 OpenRouter 金鑰。可以先用手動記帳，或到
      <router-link to="/settings">設定</router-link>
      貼上金鑰後再用 AI。
    </div>
    <div v-if="parseError" class="banner error">{{ parseError }}</div>

    <div class="card stack ai-box">
      <div class="field">
        <label>用 AI 記帳</label>
        <textarea v-model="prompt" placeholder="午餐 120 信用卡" :disabled="parsing" @keydown.ctrl.enter="parse" />
      </div>
      <button class="btn accent block" :disabled="parsing || !prompt.trim() || !state.openRouterKey" @click="parse">
        {{ parsing ? '解析中…' : '解析並預覽' }}
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
