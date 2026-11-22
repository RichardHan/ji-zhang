<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import TransactionForm from '../components/TransactionForm.vue'
import { useApp } from '../composables/useApp'
import { todayISO } from '../dates'
import type { DraftTransaction } from '../types'

const { addDrafts } = useApp()
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
  if (!draft.value.amount || draft.value.amount <= 0) {
    error.value = '請輸入金額。'
    return
  }
  try {
    await addDrafts([draft.value])
    router.replace({ name: 'list' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">手動記帳</h1>
    <p class="page-sub">不想用 AI，或解析不準時，可以直接填這張表。</p>
    <div v-if="error" class="banner error">{{ error }}</div>
    <div class="card">
      <TransactionForm v-model="draft" submit-label="記入試算表" @submit="submit" @cancel="router.back()" />
    </div>
  </div>
</template>
