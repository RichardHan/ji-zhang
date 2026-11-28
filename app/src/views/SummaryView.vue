<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { hasAnyLocalReady, writeMonthlyInsight } from '../ai'
import { useApp } from '../composables/useApp'
import { currentMonth, formatMonthLabel, formatTWD, monthKey } from '../dates'

const { state, monthTransactions, aiSettings } = useApp()
const insight = ref('')
const insightError = ref('')
const insightNotice = ref('')
const insightLoading = ref(false)
const localReady = ref(false)
onMounted(async () => {
  localReady.value = await hasAnyLocalReady({ localModelId: state.localModelId, enableNanoFallback: state.enableNanoFallback })
})

const months = computed(() => {
  const set = new Set(state.transactions.map((t) => monthKey(t.date)).filter(Boolean))
  set.add(currentMonth())
  set.add(state.selectedMonth)
  return Array.from(set).sort().reverse()
})

const income = computed(() =>
  monthTransactions.value.filter((t) => t.type === '收入').reduce((s, t) => s + t.amount, 0),
)
const expense = computed(() =>
  monthTransactions.value.filter((t) => t.type === '支出').reduce((s, t) => s + t.amount, 0),
)
const net = computed(() => income.value - expense.value)

const byCategory = computed(() => {
  const map = new Map<string, number>()
  for (const t of monthTransactions.value) {
    if (t.type !== '支出') continue
    map.set(t.category || '其他', (map.get(t.category || '其他') ?? 0) + t.amount)
  }
  return Array.from(map.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
})

const maxCat = computed(() => Math.max(1, ...byCategory.value.map((c) => c.amount)))

function shiftMonth(delta: number) {
  const [y, m] = state.selectedMonth.split('-').map(Number)
  const date = new Date(y, m - 1 + delta, 1)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  state.selectedMonth = `${yy}-${mm}`
  insightNotice.value = ''
  insight.value = ''
}

async function generateInsight() {
  insightError.value = insightNotice.value = ''
  insightLoading.value = true
  try {
    const result = await writeMonthlyInsight(aiSettings(), {
      month: formatMonthLabel(state.selectedMonth),
      income: income.value,
      expense: expense.value,
      byCategory: byCategory.value,
    })
    insight.value = result.text
    insightNotice.value = result.notice ?? ''
  } catch (err) {
    insightError.value = err instanceof Error ? err.message : String(err)
  } finally {
    insightLoading.value = false
  }
}

</script>

<template>
  <div class="page">
    <h1 class="page-title">月報</h1>
    <p class="page-sub">這個月的收支與分類，資料來自你的 Google 試算表。</p>

    <div class="row space" style="margin-bottom: 16px">
      <button class="btn ghost" @click="shiftMonth(-1)">上月</button>
      <select v-model="state.selectedMonth" style="min-height: 48px; border-radius: 12px; border: 1px solid var(--line); padding: 0 12px; background: #fff">
        <option v-for="m in months" :key="m" :value="m">{{ formatMonthLabel(m) }}</option>
      </select>
      <button class="btn ghost" @click="shiftMonth(1)">下月</button>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="label">支出</div>
        <div class="value amount expense">{{ formatTWD(expense) }}</div>
      </div>
      <div class="stat">
        <div class="label">收入</div>
        <div class="value amount income">{{ formatTWD(income) }}</div>
      </div>
    </div>
    <div class="stat" style="margin-top: 10px">
      <div class="label">結餘</div>
      <div class="value amount" :class="net >= 0 ? 'income' : 'expense'">{{ formatTWD(net) }}</div>
    </div>

    <div class="card" style="margin-top: 16px">
      <h3 style="margin: 0 0 8px">支出分類</h3>
      <div v-if="!byCategory.length" class="muted small">這個月還沒有支出。</div>
      <div v-for="c in byCategory" :key="c.category" class="bar">
        <div>{{ c.category }}</div>
        <div class="track"><div class="fill" :style="{ width: (c.amount / maxCat) * 100 + '%' }" /></div>
        <div class="amount" style="text-align: right">{{ formatTWD(c.amount) }}</div>
      </div>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>AI 觀察</strong>
      <p v-if="insightNotice" class="banner warn" role="status">{{ insightNotice }}</p>
      <div v-if="insightError" class="banner error">{{ insightError }}</div>
      <p v-if="insight" style="margin: 0; line-height: 1.6">{{ insight }}</p>
      <button class="btn secondary" :disabled="insightLoading || (!state.openRouterKey && !localReady)" @click="generateInsight">
        {{ insightLoading ? '撰寫中…' : insight ? '再寫一次' : '請 AI 寫一段觀察' }}
      </button>
      <p v-if="!state.openRouterKey && !localReady" class="muted small">請先在設定裡下載本機模型或填入 OpenRouter 金鑰（預設會自動選免費模型）。</p>
    </div>
  </div>
</template>
