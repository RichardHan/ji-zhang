<script setup lang="ts">
import { computed, ref } from 'vue'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { formatTWD } from '../dates'
import type { DraftTransaction, Transaction } from '../types'

const { state, saveTransaction, removeTransaction, refreshTransactions } = useApp()
const editing = ref<Transaction | null>(null)
const editForm = ref<DraftTransaction>({
  date: '',
  amount: 0,
  category: '其他',
  account: '',
  note: '',
  type: '支出',
})
const error = ref('')
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim()
  const list = state.transactions
  if (!q) return list
  return list.filter((t) =>
    [t.note, t.category, t.account, t.date, String(t.amount)].some((v) => v.includes(q)),
  )
})

function startEdit(t: Transaction) {
  editing.value = t
  editForm.value = {
    date: t.date,
    amount: t.amount,
    category: t.category,
    account: t.account,
    note: t.note,
    type: t.type,
  }
}

async function applyEdit() {
  if (!editing.value) return
  error.value = ''
  try {
    await saveTransaction({ ...editing.value, ...editForm.value })
    editing.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onDelete(t: Transaction) {
  if (!confirm(`確定刪除「${t.note || t.category} ${t.amount}」？`)) return
  error.value = ''
  try {
    await removeTransaction(t)
    if (editing.value?.id === t.id) editing.value = null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="page">
    <div class="row space">
      <div>
        <h1 class="page-title">明細</h1>
        <p class="page-sub">最近寫進試算表的記錄，可修改或刪除。</p>
      </div>
    </div>
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="stack">
      <div class="field">
        <label>搜尋</label>
        <input v-model="query" placeholder="備註、類別、金額…" />
      </div>
      <button class="btn ghost" :disabled="state.loading" @click="refreshTransactions()">重新整理</button>
    </div>

    <div v-if="editing" class="card" style="margin-top: 16px">
      <h3>修改記錄</h3>
      <TransactionForm v-model="editForm" submit-label="儲存" @submit="applyEdit" @cancel="editing = null" />
    </div>

    <div class="card" style="padding: 4px 16px; margin-top: 16px">
      <div v-if="!filtered.length" class="muted small" style="padding: 16px 0">沒有符合的記錄。</div>
      <div v-for="t in filtered" :key="t.id" class="tx-item">
        <div>
          <div>{{ t.note || t.category }}</div>
          <div class="meta">{{ t.date }} · {{ t.category }}{{ t.account ? ' · ' + t.account : '' }}</div>
          <div class="meta">
            <button type="button" class="link" @click="startEdit(t)">修改</button>
            ·
            <button type="button" class="link" @click="onDelete(t)">刪除</button>
          </div>
        </div>
        <div class="amount" :class="t.type === '收入' ? 'income' : 'expense'">
          {{ t.type === '收入' ? '+' : '-' }}{{ formatTWD(t.amount) }}
        </div>
      </div>
    </div>
  </div>
</template>
