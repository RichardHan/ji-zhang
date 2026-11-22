<script setup lang="ts">
import { computed } from 'vue'
import { ACCOUNTS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants'
import { todayISO } from '../dates'
import type { DraftTransaction, TxType } from '../types'

const props = withDefaults(
  defineProps<{
    modelValue: DraftTransaction
    submitLabel?: string
  }>(),
  { submitLabel: '儲存' },
)
const emit = defineEmits<{
  'update:modelValue': [value: DraftTransaction]
  submit: []
  cancel: []
}>()

const categories = computed(() =>
  props.modelValue.type === '收入' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES,
)

function patch(partial: Partial<DraftTransaction>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function setType(type: TxType) {
  const nextCats = type === '收入' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
  const category = (nextCats as readonly string[]).includes(props.modelValue.category)
    ? props.modelValue.category
    : nextCats[0]
  patch({ type, category })
}

function onSubmit() {
  emit('submit')
}
</script>

<template>
  <form class="stack" @submit.prevent="onSubmit">
    <div class="chip-row">
      <button type="button" class="chip" :class="{ on: modelValue.type === '支出' }" @click="setType('支出')">支出</button>
      <button type="button" class="chip" :class="{ on: modelValue.type === '收入' }" @click="setType('收入')">收入</button>
    </div>
    <div class="field">
      <label>日期</label>
      <input
        type="date"
        :value="modelValue.date || todayISO()"
        @input="patch({ date: ($event.target as HTMLInputElement).value })"
      />
    </div>
    <div class="field">
      <label>金額（TWD）</label>
      <input
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        :value="modelValue.amount || ''"
        @input="patch({ amount: Number(($event.target as HTMLInputElement).value) })"
        required
      />
    </div>
    <div class="field">
      <label>類別</label>
      <select
        :value="modelValue.category"
        @change="patch({ category: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>
    </div>
    <div class="field">
      <label>帳戶／付款方式</label>
      <select
        :value="modelValue.account"
        @change="patch({ account: ($event.target as HTMLSelectElement).value })"
      >
        <option value="">未指定</option>
        <option v-for="a in ACCOUNTS" :key="a" :value="a">{{ a }}</option>
      </select>
    </div>
    <div class="field">
      <label>備註</label>
      <input
        :value="modelValue.note"
        @input="patch({ note: ($event.target as HTMLInputElement).value })"
        placeholder="例如：午餐、捷運"
      />
    </div>
    <div class="row">
      <button type="button" class="btn ghost grow" @click="$emit('cancel')">取消</button>
      <button type="submit" class="btn accent grow">{{ submitLabel }}</button>
    </div>
  </form>
</template>
