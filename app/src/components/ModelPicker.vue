<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  filterCatalog,
  formatModelPrice,
  type CatalogModel,
  type ModelKind,
  type PriceFilter,
} from '../ai'

const props = defineProps<{
  kind: ModelKind
  modelValue: string
  models: CatalogModel[]
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const query = ref('')
const price = ref<PriceFilter>('all')
const visibleCount = ref(40)

const filtered = computed(() =>
  filterCatalog(props.models, { kind: props.kind, price: price.value, query: query.value }),
)
const visible = computed(() => filtered.value.slice(0, visibleCount.value))
const selected = computed(() => props.models.find((m) => m.id === props.modelValue))
const title = computed(() => (props.kind === 'vision' ? '選擇視覺模型' : '選擇文字模型'))

function openSheet() {
  query.value = ''
  visibleCount.value = 40
  open.value = true
}

function choose(id: string) {
  emit('update:modelValue', id)
  open.value = false
}

function setPrice(next: PriceFilter) {
  price.value = next
  visibleCount.value = 40
}
</script>

<template>
  <div>
    <button type="button" class="btn ghost block picker-toggle" @click="openSheet">
      <span v-if="selected" class="picker-current">
        <strong>{{ selected.name }}</strong>
        <span class="muted small">{{ selected.id }} · {{ formatModelPrice(selected) }}</span>
      </span>
      <span v-else class="muted">從清單選擇模型（免費或付費）</span>
    </button>

    <div v-if="open" class="modal-backdrop" @click.self="open = false">
      <div class="sheet" role="dialog" :aria-label="title">
        <div class="row space">
          <h3>{{ title }}</h3>
          <button type="button" class="btn ghost" style="min-height: 40px" @click="open = false">關閉</button>
        </div>
        <p class="muted small">清單來自 OpenRouter，可依免費／付費篩選，並顯示每百萬 token 價格。</p>
        <div v-if="error" class="banner error">{{ error }}</div>
        <div class="field">
          <label>搜尋</label>
          <input v-model="query" :placeholder="kind === 'vision' ? '搜尋支援圖片的模型' : '搜尋名稱或模型 ID'" @input="visibleCount = 40" />
        </div>
        <div class="chip-row">
          <button type="button" class="chip" :class="{ on: price === 'all' }" @click="setPrice('all')">全部</button>
          <button type="button" class="chip" :class="{ on: price === 'free' }" @click="setPrice('free')">免費</button>
          <button type="button" class="chip" :class="{ on: price === 'paid' }" @click="setPrice('paid')">付費</button>
        </div>
        <p class="muted small">{{ loading ? '載入模型清單中…' : `共 ${filtered.length} 個模型` }}</p>
        <div class="model-list">
          <button
            v-for="m in visible"
            :key="m.id"
            type="button"
            class="model-item"
            :class="{ selected: m.id === modelValue }"
            @click="choose(m.id)"
          >
            <div class="row space">
              <strong>{{ m.name }}</strong>
              <span class="price-tag" :class="m.isFree ? 'free' : 'paid'">{{ m.isFree ? '免費' : '付費' }}</span>
            </div>
            <div class="muted small">{{ m.id }}</div>
            <div class="muted small">{{ formatModelPrice(m) }}<template v-if="m.isVision"> · 支援圖片</template></div>
          </button>
          <p v-if="!loading && !filtered.length" class="muted small" style="padding: 12px">沒有符合的模型。</p>
        </div>
        <button
          v-if="visible.length < filtered.length"
          type="button"
          class="btn ghost block"
          @click="visibleCount += 40"
        >
          顯示更多（還有 {{ filtered.length - visible.length }} 個）
        </button>
      </div>
    </div>
  </div>
</template>
