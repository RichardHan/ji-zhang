<script setup lang="ts">
import { formatTWD } from '../dates'
import type { DraftTransaction } from '../types'

defineProps<{
  drafts: DraftTransaction[]
  modelUsed?: string
}>()
const emit = defineEmits<{
  confirm: []
  cancel: []
  edit: [index: number]
}>()
</script>

<template>
  <div class="stack">
    <p class="muted small">請確認以下記錄，沒問題再寫進試算表。</p>
    <p v-if="modelUsed" class="muted small">使用模型：{{ modelUsed }}</p>
    <div class="card" style="padding: 4px 16px">
      <div v-for="(d, i) in drafts" :key="i" class="tx-item">
        <div>
          <div>{{ d.note || d.category }} · {{ d.category }}</div>
          <div class="meta">{{ d.date }} · {{ d.account || '未指定帳戶' }}</div>
        </div>
        <div style="text-align: right">
          <div class="amount" :class="d.type === '收入' ? 'income' : 'expense'">
            {{ d.type === '收入' ? '+' : '-' }}{{ formatTWD(d.amount) }}
          </div>
          <button type="button" class="link" @click="emit('edit', i)">修改</button>
        </div>
      </div>
    </div>
    <div class="row">
      <button type="button" class="btn ghost grow" @click="emit('cancel')">取消</button>
      <button type="button" class="btn accent grow" @click="emit('confirm')">確認記入</button>
    </div>
  </div>
</template>
