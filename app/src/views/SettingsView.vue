<script setup lang="ts">
import type { PluginListenerHandle } from '@capacitor/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ModelPicker from '../components/ModelPicker.vue'
import { useApp } from '../composables/useApp'
import {
  LOCAL_MODELS,
  LocalAi,
  getLocalModelSpec,
  listOpenRouterModels,
  type CatalogModel,
  type LocalAiStatus,
} from '../ai'
import type { AiProviderId, LocalModelId, ModelSelectionMode } from '../types'

const { state, saveSettings, signOut, disconnectSheet, changeSheet, configError } = useApp()
const router = useRouter()

const keyInput = ref(state.openRouterKey)
const providerInput = ref<AiProviderId>(state.aiProvider)
const textMode = ref<ModelSelectionMode>(state.textModelMode)
const visionMode = ref<ModelSelectionMode>(state.visionModelMode)
const textModel = ref(state.model)
const visionModel = ref(state.visionModel)
const localModelId = ref<LocalModelId>(state.localModelId)
const wifiOnly = ref(state.wifiOnlyDownload)
const enableNanoFallback = ref(state.enableNanoFallback)
const paidFailureFallbackToFree = ref(state.paidFailureFallbackToFree)

const pasted = ref('')
const message = ref('')
const error = ref('')
const saved = ref(false)

const catalog = ref<CatalogModel[]>([])
const catalogError = ref('')
const catalogLoading = ref(false)
const localStatus = ref<LocalAiStatus | null>(null)
const localBusy = ref(false)
const nanoBusy = ref(false)
let progressHandle: PluginListenerHandle | null = null
let nanoHandle: PluginListenerHandle | null = null

const selectedSpec = computed(() => getLocalModelSpec(localModelId.value))
const progressPct = computed(() => {
  const p = localStatus.value?.downloadProgress ?? 0
  return Math.max(0, Math.min(100, Math.round(p * 100)))
})

const nanoLabel = computed(() => {
  const s = localStatus.value?.nanoStatus
  if (s === 'available') {
    const name = localStatus.value?.nanoModelName
    return name ? `已就緒（${name}）` : '已就緒，可免下載離線使用'
  }
  if (s === 'downloadable') return '此裝置支援，可由系統下載 Gemini Nano'
  if (s === 'downloading') return '系統正在下載 Gemini Nano…'
  return '此裝置目前不支援或尚未啟用'
})

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
  const spec = getLocalModelSpec(localModelId.value)
  try {
    localStatus.value = await LocalAi.getStatus({ modelId: localModelId.value })
  } catch (err) {
    localStatus.value = {
      available: false,
      downloading: false,
      downloadProgress: 0,
      reason: err instanceof Error ? err.message : String(err),
      backend: '',
      modelId: spec.id,
      modelName: spec.label,
      modelPath: '',
      downloadedBytes: 0,
      totalBytes: spec.sizeBytes,
      freeStorageBytes: 0,
      nanoStatus: 'unavailable',
      nanoModelName: '',
    }
  }
}

onMounted(async () => {
  try {
    progressHandle = await LocalAi.addListener('localDownloadProgress', (ev) => {
      if (ev.modelId !== localModelId.value || !localStatus.value) return
      localStatus.value = {
        ...localStatus.value,
        downloading: ev.state === 'downloading',
        downloadedBytes: ev.downloadedBytes,
        totalBytes: ev.totalBytes || localStatus.value.totalBytes,
        downloadProgress: ev.progress,
      }
      if (ev.state === 'completed' || ev.state === 'failed') {
        void refreshLocalStatus()
      }
    })
    nanoHandle = await LocalAi.addListener('nanoDownloadProgress', (ev) => {
      if (ev.state === 'completed') void refreshLocalStatus()
    })
  } catch {
    // Web preview does not emit native events.
  }
  await Promise.all([loadCatalog(), refreshLocalStatus()])
})

onUnmounted(async () => {
  await progressHandle?.remove().catch(() => undefined)
  await nanoHandle?.remove().catch(() => undefined)
})

async function onChangeLocalModel() {
  await saveSettings({ localModelId: localModelId.value })
  await refreshLocalStatus()
}

async function save() {
  error.value = ''
  await saveSettings({
    openRouterKey: keyInput.value.trim(),
    aiProvider: providerInput.value,
    textModelMode: textMode.value,
    visionModelMode: visionMode.value,
    model: textModel.value.trim(),
    visionModel: visionModel.value.trim(),
    localModelId: localModelId.value,
    wifiOnlyDownload: wifiOnly.value,
    enableNanoFallback: enableNanoFallback.value,
    paidFailureFallbackToFree: paidFailureFallbackToFree.value,
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
  message.value = ''
  localBusy.value = true
  try {
    await saveSettings({
      localModelId: localModelId.value,
      wifiOnlyDownload: wifiOnly.value,
    })
    await LocalAi.downloadModel({ modelId: localModelId.value, wifiOnly: wifiOnly.value })
    message.value = `${selectedSpec.value.label} 下載完成，現在可離線使用。`
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    await refreshLocalStatus()
  } finally {
    localBusy.value = false
  }
}

async function onCancelDownload() {
  try {
    await LocalAi.cancelDownload()
    message.value = '已暫停下載，下次可從中斷處續傳。'
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function onDeleteLocal() {
  if (!confirm(`要刪除手機上的 ${selectedSpec.value.label} 嗎？之後需要重新下載才能用這顆離線模型。`)) return
  error.value = ''
  localBusy.value = true
  try {
    await LocalAi.deleteModel({ modelId: localModelId.value })
    message.value = '已刪除本機模型檔。'
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    localBusy.value = false
  }
}

async function onDownloadNano() {
  error.value = ''
  nanoBusy.value = true
  try {
    await LocalAi.downloadNano()
    message.value = 'Gemini Nano 已下載完成。'
    await refreshLocalStatus()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    nanoBusy.value = false
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
        預設「自動」順序：本機 LiteRT-LM（已下載時）→ 裝置內建 Gemini Nano → OpenRouter（自動選免費模型）。
      </p>
      <div class="seg">
        <button type="button" :class="{ active: providerInput === 'auto' }" @click="providerInput = 'auto'">自動</button>
        <button type="button" :class="{ active: providerInput === 'openrouter' }" @click="providerInput = 'openrouter'">OpenRouter</button>
        <button type="button" :class="{ active: providerInput === 'local' }" @click="providerInput = 'local'">本機（離線）</button>
      </div>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>本機模型（LiteRT-LM + Gemini Nano）</strong>
      <div class="field">
        <label>離線模型（文字 + 收據拍照共用）</label>
        <select v-model="localModelId" :disabled="localBusy || localStatus?.downloading" @change="onChangeLocalModel">
          <option v-for="m in LOCAL_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
        </select>
      </div>
      <p class="muted small">{{ selectedSpec.description }}</p>
      <p class="small">狀態：{{ localStatus?.reason || '檢查中…' }}</p>
      <p class="muted small">
        已下載：{{ formatBytes(localStatus?.downloadedBytes ?? 0) }} /
        {{ formatBytes(localStatus?.totalBytes || selectedSpec.sizeBytes) }}
        <template v-if="localStatus?.freeStorageBytes">
          · 手機可用空間：{{ formatBytes(localStatus.freeStorageBytes) }}
        </template>
      </p>

      <div v-if="localStatus?.downloading" class="stack" style="gap: 6px">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: progressPct + '%' }" />
        </div>
        <div class="row space">
          <span class="muted small">下載進度 {{ progressPct }}%</span>
          <button type="button" class="btn ghost" style="min-height: 36px" @click="onCancelDownload">暫停／取消</button>
        </div>
      </div>

      <label class="check-row">
        <input v-model="wifiOnly" type="checkbox" />
        僅在 Wi-Fi 下載（建議，檔案超過 1 GB）
      </label>
      <div class="row">
        <button
          class="btn secondary grow"
          :disabled="localBusy || localStatus?.downloading || localStatus?.available"
          @click="onDownloadLocal"
        >
          {{ localStatus?.available ? '已下載' : localBusy || localStatus?.downloading ? '下載中…' : '下載本機模型' }}
        </button>
        <button class="btn ghost" :disabled="localBusy" @click="onDeleteLocal">刪除</button>
      </div>

      <hr class="sep" style="margin: 6px 0" />
      <label class="check-row">
        <input v-model="enableNanoFallback" type="checkbox" />
        允許使用裝置內建 Gemini Nano 當免下載備援（S26 Ultra 等機型）
      </label>
      <p class="muted small">Gemini Nano 狀態：{{ nanoLabel }}</p>
      <button
        v-if="localStatus?.nanoStatus === 'downloadable'"
        type="button"
        class="btn ghost"
        :disabled="nanoBusy"
        @click="onDownloadNano"
      >
        {{ nanoBusy ? '請求系統下載中…' : '下載系統 Gemini Nano' }}
      </button>
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

      <label class="check-row">
        <input v-model="paidFailureFallbackToFree" type="checkbox" />
        指定模型失敗時改用免費自動模式（付費模型失敗絕不自動切換其他付費模型）
      </label>

      <button class="btn ghost" :disabled="catalogLoading" @click="loadCatalog(true)">
        {{ catalogLoading ? '更新模型清單中…' : '重新整理模型清單' }}
      </button>
      <p v-if="catalogError" class="muted small">{{ catalogError }}</p>

      <button class="btn accent" @click="save">儲存 AI 設定</button>
      <p v-if="saved" class="muted small">已儲存。</p>
    </div>
  </div>
</template>
