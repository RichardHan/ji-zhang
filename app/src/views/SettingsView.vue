<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { DEFAULT_MODEL, FALLBACK_MODEL, FREE_MODELS } from '../constants'
import { useApp } from '../composables/useApp'

const { state, reviewBusy, saveSettings, signOut, disconnectSheet, changeSheet, configError } = useApp()
const router = useRouter()
const isKnown = FREE_MODELS.some((m) => m.id === state.model)
const keyInput = ref(state.openRouterKey)
const modelInput = ref(isKnown ? state.model : '__custom__')
const customModel = ref(isKnown ? '' : state.model)
const pasted = ref('')
const message = ref('')
const error = ref('')
const saved = ref(false)

async function save() {
  error.value = ''
  const selected = modelInput.value === '__custom__' ? customModel.value.trim() : modelInput.value
  await saveSettings({ openRouterKey: keyInput.value.trim(), model: selected || DEFAULT_MODEL })
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
      <button class="btn ghost" :disabled="reviewBusy || state.loading" @click="onSignOut">登出</button>
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
      <button class="btn secondary" :disabled="!pasted.trim() || reviewBusy || state.loading" @click="onConnect">使用這張表</button>
      <button class="btn ghost" :disabled="reviewBusy || state.loading" @click="onCreateNew">新建一張表</button>
      <button class="btn ghost" :disabled="reviewBusy || state.loading" @click="onDisconnect">解除連結</button>
    </div>

    <div class="card stack" style="margin-top: 16px">
      <strong>OpenRouter</strong>
      <p class="muted small">
        到
        <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>
        申請金鑰，預設使用免費模型 {{ DEFAULT_MODEL }}，失敗時改試 {{ FALLBACK_MODEL }}。
      </p>
      <div class="field">
        <label>API 金鑰</label>
        <input v-model="keyInput" type="password" autocomplete="off" placeholder="sk-or-…" />
      </div>
      <div class="field">
        <label>模型</label>
        <select v-model="modelInput" @change="customModel = ''">
          <option v-for="m in FREE_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
          <option value="__custom__">自行指定模型 ID</option>
        </select>
      </div>
      <div v-if="modelInput === '__custom__' || customModel" class="field">
        <label>自訂模型 ID</label>
        <input v-model="customModel" placeholder="vendor/model:free" />
      </div>
      <button class="btn accent" @click="save">儲存金鑰與模型</button>
      <p v-if="saved" class="muted small">已儲存。</p>
    </div>
  </div>
</template>
