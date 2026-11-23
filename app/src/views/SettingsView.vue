<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ModelPicker from '../components/ModelPicker.vue'
import { useApp } from '../composables/useApp'
import {
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_SIZE_BYTES,
  LocalAi,
  listOpenRouterModels,
  type CatalogModel,
  type LocalAiStatus,
} from '../ai'
import type { AiProviderId, ModelSelectionMode } from '../types'

const { state, saveSettings, signOut, disconnectSheet, changeSheet, configError } = useApp()
const router = useRouter()

const keyInput = ref(state.openRouterKey)
const providerInput = ref<AiProviderId>(state.aiProvider)
const textMode = ref<ModelSelectionMode>(state.textModelMode)
const visionMode = ref<ModelSelectionMode>(state.visionModelMode)
const textModel = ref(state.model)
const visionModel = ref(state.visionModel)
const wifiOnly = ref(state.wifiOnlyDownload)
const pasted = ref('')
const message = ref('')
const error = ref('')
const saved = ref(false)

const catalog = ref<CatalogModel[]>([])
const catalogError = ref('')
const catalogLoading = ref(false)
const localStatus = ref<LocalAiStatus | null>(null)
const localBusy = ref(false)

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const gb = bytes / 1_000_000_000
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1_000_000
  return `${mb.toFixed(0)} MB`
}

async function loadCatalog(force = false) {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    catalog.value = await listOpenRouterModels({ force })
  } catch (err) {
    catalogError.value = err instanceof Error ? err.message : String(err)
  } finally {
    catalogLoading.value = false
  }
}

async function refreshLocalStatus() {
  try {
    localStatus.value = await LocalAi.getStatus()
  } catch (err) {
    localStatus.value = {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      backend: '',
      modelName: LOCAL_MODEL_NAME,
      modelPath: '',
      downloadedBytes: 0,
      totalBytes: LOCAL_MODEL_SIZE_BYTES,
    }
  }
}

onMounted(async () => {
  await Promise.all([loadCatalog(), refreshLocalStatus()])
})

async function save() {
  error.value = ''
  await saveSettings({
    openRouterKey: keyInput.value.trim(),
    aiProvider: providerInput.value,
    textModelMode: textMode.value,
    visionModelMode: visionMode.value,
    model: textModel.value.trim(),
    visionModel: visionModel.value.trim(),
    wifiOnlyDownload: wifiOnly.value,
  })
  saved.value = true
  message.value = '已儲存在這台裝置上，金鑰不會上傳到 GitHub。'
}

async function onSignOut() {
  await signOut()
  router.replace({ name: 'setup' })
}

async function onDisconnect() {
  if (!confirm('要解除目前的試算表連結嗎？資料仍留在 Google 試算表裡。')) return
  await disconnectSheet()
  router.replace({ name: 'setup' })
}

async function onCreateNew() {
  if (!confirm('要新建一張「ji-zhang 記帳」試算表嗎？舊的表不會被刪除。')) return
  error.value = ''
  try {
    await changeSheet()
    message.value = '已建立並改用新的試算表。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onConnect() {
  error.value = ''
  try {
    await changeSheet(pasted.value)
    pasted.value = ''
    message.value = '已改用這張試算表。'
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onDownloadLocal() {
  error.value = ''
  localBusy.value = true
  try {
    await LocalAi.downloadModel({ wifiOnly: wifiOnly.value })
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    localBusy.value = false
  }
}

async function onDeleteLocal() {
  if (!confirm('要刪除手機上的本機模型嗎？之後需要重新下載才能離線使用。')) return
  error.value = ''
  localBusy.value = true
  try {
    await LocalAi.deleteModel()
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    localBusy.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">設定</h1>
    <p class="page-sub">金鑰與模型只存在手機裡。Google 帳號用來讀寫你自己的試算表。</p>

    <div v-if="configError" class="banner warn">{{ configError }}</div>
    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="message" class="banner ok">{{ message }}</div>

    <div class="card stack">
      <strong>Google 帳號</strong>
      <p class="small">{{ state.profile?.name || '未顯示名稱' }}</p>
      <p class="muted small">{{ state.profile?.email || '—' }}</p>
      <button class="btn ghost" @click="onSignOut">登出</button>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>記帳試算表</strong>
      <p v-if="state.spreadsheetUrl" class="small">
        <a :href="state.spreadsheetUrl" target="_blank" rel="noopener">在瀏覽器開啟試算表</a>
      </p>
      <p v-else class="muted small">尚未連結試算表。</p>
      <p class="muted small">試算表 ID：{{ state.spreadsheetId || '—' }}</p>
      <div class="field">
        <label>改用其他試算表（貼上連結）</label>
        <input v-model="pasted" placeholder="https://docs.google.com/spreadsheets/d/…" />
      </div>
      <button class="btn secondary" :disabled="!pasted.trim() || state.loading" @click="onConnect">使用這張表</button>
      <button class="btn ghost" :disabled="state.loading" @click="onCreateNew">新建一張表</button>
      <button class="btn ghost" @click="onDisconnect">解除連結</button>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>AI 來源</strong>
      <p class="muted small">
        預設是「自動」：本機模型就緒就優先用本機，否則改走 OpenRouter，並且自動選免費模型，不用先挑模型。
      </p>
      <div class="seg">
        <button type="button" :class="{ active: providerInput === 'auto' }" @click="providerInput = 'auto'">自動</button>
        <button type="button" :class="{ active: providerInput === 'openrouter' }" @click="providerInput = 'openrouter'">OpenRouter</button>
        <button type="button" :class="{ active: providerInput === 'local' }" @click="providerInput = 'local'">本機</button>
      </div>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>本機模型</strong>
      <p class="muted small">
        預計使用 LiteRT-LM 在手機上跑 {{ LOCAL_MODEL_NAME }}，約 {{ formatBytes(LOCAL_MODEL_SIZE_BYTES) }}，可離線解析文字與收據照片。實際下載與推論還在接線中。
      </p>
      <p class="small">
        狀態：{{ localStatus?.available ? '已就緒' : (localStatus?.reason || '尚未就緒') }}
      </p>
      <p v-if="localStatus?.backend" class="muted small">後端：{{ localStatus.backend }}</p>
      <p class="muted small">
        儲存空間：{{ formatBytes(localStatus?.downloadedBytes ?? 0) }} /
        {{ formatBytes(localStatus?.totalBytes || LOCAL_MODEL_SIZE_BYTES) }}
      </p>
      <label class="check-row">
        <input v-model="wifiOnly" type="checkbox" />
        僅在 Wi-Fi 下載（建議，檔案較大）
      </label>
      <button class="btn secondary" :disabled="localBusy" @click="onDownloadLocal">
        {{ localBusy ? '處理中…' : '下載本機模型' }}
      </button>
      <button class="btn ghost" :disabled="localBusy" @click="onDeleteLocal">刪除本機模型</button>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>OpenRouter</strong>
      <p class="muted small">
        到
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>
        申請金鑰。預設會自動選免費模型（文字與視覺分開挑選）；也可以改為自行指定任何免費或付費模型。
      </p>
      <div class="field">
        <label>API 金鑰</label>
        <input v-model="keyInput" type="password" autocomplete="off" placeholder="sk-or-…" />
      </div>

      <div class="field">
        <label>文字模型</label>
        <div class="seg">
          <button type="button" :class="{ active: textMode === 'auto-free' }" @click="textMode = 'auto-free'">自動選免費</button>
          <button type="button" :class="{ active: textMode === 'manual' }" @click="textMode = 'manual'">自行選擇</button>
        </div>
      </div>
      <p v-if="textMode === 'auto-free'" class="muted small">
        會向 OpenRouter 取模型清單（快取 24 小時），篩出免費模型後自動挑選；遇到錯誤或速率限制會改試下一個免費模型。
      </p>
      <ModelPicker
        v-else
        v-model="textModel"
        kind="text"
        :models="catalog"
        :loading="catalogLoading"
        :error="catalogError"
      />

      <div class="field">
        <label>視覺模型（收據／電子發票）</label>
        <div class="seg">
          <button type="button" :class="{ active: visionMode === 'auto-free' }" @click="visionMode = 'auto-free'">自動選免費</button>
          <button type="button" :class="{ active: visionMode === 'manual' }" @click="visionMode = 'manual'">自行選擇</button>
        </div>
      </div>
      <p v-if="visionMode === 'auto-free'" class="muted small">
        只會從支援圖片輸入的免費模型裡自動挑；失敗或被限速時改試下一個。
      </p>
      <ModelPicker
        v-else
        v-model="visionModel"
        kind="vision"
        :models="catalog"
        :loading="catalogLoading"
        :error="catalogError"
      />

      <button class="btn ghost" :disabled="catalogLoading" @click="loadCatalog(true)">
        {{ catalogLoading ? '更新模型清單中…' : '重新整理模型清單' }}
      </button>
      <p v-if="catalogError" class="muted small">{{ catalogError }}</p>

      <button class="btn accent" @click="save">儲存 AI 設定</button>
      <p v-if="saved" class="muted small">已儲存。</p>
    </div>
  </div>
</template>
