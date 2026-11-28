<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { registerPlugin } from '@capacitor/core'
import { parseText } from '../ai'
import { useApp } from '../composables/useApp'
import { missingDraftFields } from '../review'
import { videoDrafts, transcribeVideoAudio } from '../video'
import type { DraftTransaction } from '../types'

const plugin = registerPlugin<{
  select(options: { camera: boolean; audio: boolean }): Promise<{ frames: string[]; audio?: string; audioNotice?: string } | undefined>
}>('VideoReceipt')
const { state, reviewBook, reviewBusy, stageDrafts, aiSettings } = useApp()
const router = useRouter()
const useAudio = ref(false)
const status = ref('')
const notice = ref('')
const transcript = ref('')
const drafts = ref<DraftTransaction[]>([])
let controller: AbortController | undefined
let sourceBook: string | null = null

function reset() {
  controller?.abort()
  controller = undefined
  status.value = notice.value = transcript.value = ''
  drafts.value = []
  sourceBook = null
}

onUnmounted(reset)
watch(reviewBook, reset)

async function select(camera: boolean) {
  if (status.value) return
  reset()
  const request = new AbortController()
  controller = request
  sourceBook = reviewBook.value
  const audio = state.aiProvider !== 'local' && useAudio.value && Boolean(state.openRouterKey)
  status.value = '正在讀取影片畫面…'
  try {
    const clip = await plugin.select({ camera, audio })
    if (!clip?.frames || request.signal.aborted) return
    const frames = clip.frames
    let spoken: DraftTransaction[] = []
    notice.value = clip.audioNotice ?? ''
    if (audio && clip.audio) {
      status.value = '正在轉錄與解析音軌…'
      try {
        const text = await transcribeVideoAudio(state.openRouterKey, clip.audio, request.signal)
        if (request.signal.aborted) return
        transcript.value = text
        if (text) {
          const result = await parseText(aiSettings(), text)
          spoken = result.transactions
          notice.value = result.notice ?? ''
        }
        else notice.value = '沒有辨識到口述內容。'
      } catch {
        if (request.signal.aborted) return
        notice.value = '無法解析音軌，可繼續核對畫面。'
      }
    }
    if (!request.signal.aborted) drafts.value = videoDrafts(frames, spoken)
  } catch (error) {
    if (!request.signal.aborted) notice.value = error instanceof Error ? error.message : '無法讀取短片。'
  } finally {
    if (!request.signal.aborted) status.value = ''
  }
}

async function stage() {
  if (!drafts.value.length || status.value || reviewBusy.value) return
  status.value = '正在加入清單…'
  try {
    await stageDrafts(drafts.value, { kind: 'video' }, sourceBook)
    if (router.currentRoute.value.name === 'video') await router.push('/review')
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '無法加入清單。'
  } finally {
    status.value = ''
  }
}
</script>

<template>
  <div class="page stack">
    <h1 class="page-title">影片記帳</h1>
    <p class="page-sub">錄製或選取 60 秒以內的短片。請讓收據的商家、日期與實付金額清楚入鏡。</p>
    <div v-if="!drafts.length && !status" class="card stack">
      <label><input v-model="useAudio" type="checkbox" :disabled="!state.openRouterKey || state.aiProvider === 'local'"> 同時辨識口述金額</label>
      <p class="muted small">畫面在裝置上辨識。勾選後會將 AAC 音軌及轉錄文字傳至 OpenRouter，可能產生費用。<router-link v-if="!state.openRouterKey" to="/settings">設定 API 金鑰</router-link></p>
      <button class="btn accent" @click="select(true)">錄製短片</button>
      <button class="btn ghost" @click="select(false)">選取短片</button>
    </div>
    <p v-if="status" role="status">{{ status }}</p>
    <p v-if="notice" class="banner warn" role="alert">{{ notice }}</p>
    <template v-if="drafts.length">
      <h2>候選交易（{{ drafts.length }} 筆）</h2>
      <details v-if="transcript"><summary>查看口述轉錄</summary><p>{{ transcript }}</p></details>
      <div v-for="(draft, i) in drafts" :key="i" class="card stack">
        <strong>{{ draft.note || '商家待補' }}</strong>
        <span>{{ draft.date || '日期待補' }} · {{ draft.amount ? 'TWD ' + draft.amount : '金額待補' }}</span>
        <span v-if="missingDraftFields(draft, 'video').length" class="muted small">請在待確認清單補齊資料。</span>
      </div>
      <button class="btn accent" :disabled="Boolean(status) || reviewBusy" @click="stage">加入待確認清單</button>
      <button class="btn ghost" :disabled="Boolean(status)" @click="reset">捨棄候選</button>
    </template>
  </div>
</template>
