<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApp } from '../composables/useApp'

const { state, configError, signIn, createBook, connectSheet } = useApp()
const router = useRouter()
const pasted = ref('')
const localError = ref('')

async function onSignIn() {
  localError.value = ''
  try {
    await signIn()
  } catch (err) {
    localError.value = err instanceof Error ? err.message : String(err)
  }
}

async function onCreate() {
  localError.value = ''
  try {
    await createBook()
    router.replace({ name: 'home' })
  } catch (err) {
    localError.value = err instanceof Error ? err.message : String(err)
  }
}

async function onConnect() {
  localError.value = ''
  try {
    await connectSheet(pasted.value)
    router.replace({ name: 'home' })
  } catch (err) {
    localError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="page">
    <p class="muted small">ji-zhang</p>
    <h1 class="page-title">記帳</h1>
    <p class="page-sub">資料存在你自己的 Google 試算表，AI 幫你把一句話拆成帳目。不需要自架伺服器。</p>

    <div v-if="configError" class="banner warn">{{ configError }}</div>
    <div v-if="localError || state.error" class="banner error">{{ localError || state.error }}</div>

    <div class="stack">
      <div class="card stack">
        <strong>1. 用 Google 登入</strong>
        <p class="muted small">需要試算表的讀寫權限，帳目只會寫進你指定的那張表。</p>
        <p v-if="state.signedIn && state.profile" class="small">
          已登入：{{ state.profile.name || state.profile.email }}
        </p>
        <button class="btn block" :disabled="!!configError || state.loading" @click="onSignIn">
          {{ state.signedIn ? '重新登入' : '使用 Google 登入' }}
        </button>
      </div>

      <div class="card stack" :style="{ opacity: state.signedIn ? 1 : 0.65 }">
        <strong>2. 選擇試算表</strong>
        <p class="muted small">第一次使用可以新建「ji-zhang 記帳」，或貼上已有試算表的連結。</p>
        <button class="btn accent block" :disabled="!state.signedIn || state.loading" @click="onCreate">
          建立新的記帳試算表
        </button>
        <div class="field">
          <label>或貼上現有試算表連結</label>
          <input v-model="pasted" placeholder="https://docs.google.com/spreadsheets/d/…" :disabled="!state.signedIn" />
        </div>
        <button class="btn secondary block" :disabled="!state.signedIn || state.loading || !pasted.trim()" @click="onConnect">
          使用這張表
        </button>
      </div>
    </div>
  </div>
</template>
