<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { todayISO } from '../dates'
import { missingDraftFields } from '../review'
import type { DraftTransaction } from '../types'

const { state, reviewBusy, stageDrafts } = useApp()
const router = useRouter()
const error = ref('')
const draft = ref<DraftTransaction>({
  date: todayISO(),
  amount: 0,
  category: '餐飲',
  account: '',
  note: '',
  type: '支出',
})

async function submit() {
  error.value = ''
  const missing = missingDraftFields(draft.value)
  if (missing.length) {
    error.value = `請補齊：${missing.join('、')}。`
    return
  }
  try {
    await stageDrafts([draft.value], { kind: 'manual' })
    if (router.currentRoute.value.name === 'add') await router.replace({ name: 'review' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">手動記帳</h1>
    <p class="page-sub">填寫一筆交易，檢查後再寫入試算表。</p>
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="card">
      <TransactionForm v-model="draft" submit-label="檢查這筆記錄" :disabled="reviewBusy || state.loading" @submit="submit" @cancel="router.back()" />
    </div>
  </div>
</template>
