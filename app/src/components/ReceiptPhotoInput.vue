<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { receiptPlugin, nativeReceipts } from '../receiptInput'
import { useApp } from '../composables/useApp'
import { receiptDraft } from '../receipt'

const { reviewBook, reviewBusy, state, stageDrafts, receiptPreviews } = useApp()
const router = useRouter()
const reading = ref(false)
const error = ref('')
let mounted = true
onUnmounted(() => { mounted = false })

async function select(camera: boolean) {
  const book = reviewBook.value
  if (!book || reading.value || reviewBusy.value || state.loading) return
  reading.value = true
  error.value = ''
  try {
    const photo = await receiptPlugin.select({ camera })
    if (!mounted || book !== reviewBook.value || !photo?.preview) return
    const id = await stageDrafts([receiptDraft(photo.text ?? '')], { kind: 'photo' }, book)
    if (!id || book !== reviewBook.value) return
    receiptPreviews.set(id, photo.preview)
    if (mounted) await router.push({ name: 'review' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '無法讀取收據照片。'
  } finally {
    reading.value = false
  }
}
</script>

<template>
  <section v-if="nativeReceipts" class="card stack" style="margin-top: 16px">
    <h2 style="margin: 0; font-size: 1.05rem">拍照記帳</h2>
    <p class="muted small" style="margin: 0">在手機上辨識收據。照片只供本次核對，確認後才會將交易寫入試算表。</p>
    <div class="row">
      <button class="btn ghost grow" :disabled="reading || reviewBusy || state.loading" @click="select(true)">拍攝收據</button>
      <button class="btn ghost grow" :disabled="reading || reviewBusy || state.loading" @click="select(false)">選取照片</button>
    </div>
    <p v-if="reading" class="muted small" role="status">正在讀取收據…</p>
    <p v-if="error" class="banner error" role="alert">{{ error }}</p>
  </section>
</template>
