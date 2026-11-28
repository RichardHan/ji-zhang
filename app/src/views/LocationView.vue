<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { useRouter } from 'vue-router'
import { useApp } from '../composables/useApp'
import { choicesFor, nearbyPlaces, StayDetector, type Choice, type Fix, type Stay } from '../stay'

const gps = registerPlugin<{
  start(options: { session: string }): Promise<void>
  stop(options: { session: string }): Promise<void>
  addListener(name: 'position', cb: (p: Fix & { session: string }) => void): Promise<PluginListenerHandle>
  addListener(name: 'ended', cb: (p: { session: string }) => void): Promise<PluginListenerHandle>
}>('StayLocation')
const { reviewBook, stageDrafts, reviewBusy } = useApp()
const router = useRouter()
const ready = ref(false)
const active = ref(false)
const allowLookup = ref(false)
const busy = ref(false)
const message = ref('')
const stay = ref<Stay>()
const choices = ref<Choice[]>([])
const parking = ref<Choice>()
const meal = ref<Choice>()
const minutes = computed(() => stay.value ? Math.floor((stay.value.end - stay.value.start) / 60000) : 0)
const timeLabel = (value: number) => new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(value)
const selected = computed(() => [parking.value, meal.value].filter((c): c is Choice => Boolean(c)))
let session = ''
let detector = new StayDetector()
let request: AbortController | undefined
let mounted = true
let handles: PluginListenerHandle[] = []

function stopGps() {
  const id = session
  session = ''
  active.value = false
  detector = new StayDetector()
  if (id) void gps.stop({ session: id }).catch(() => {})
}

function reset() {
  stopGps()
  request?.abort()
  request = undefined
  busy.value = false
  stay.value = undefined
  choices.value = []
  meal.value = parking.value = undefined
  message.value = ''
}

async function lookup() {
  const visit = stay.value
  if (!visit || busy.value) return
  const operation = new AbortController()
  request = operation
  const timer = window.setTimeout(() => operation.abort(), 20000)
  busy.value = true
  message.value = '正在查詢附近場所…'
  try {
    const places = await nearbyPlaces(visit, operation.signal)
    if (request !== operation) return
    choices.value = choicesFor(visit, places)
    message.value = choices.value.length ? '' : '附近場所或移動線索不足，這次沒有記帳建議。'
  } catch {
    if (request === operation) message.value = '無法查詢附近場所，可稍後重試。'
  } finally {
    clearTimeout(timer)
    if (request === operation) { busy.value = false; request = undefined }
  }
}

function position(p: Fix & { session: string }) {
  if (p.session !== session) return
  if (p.accuracy > 35) {
    message.value = '位置精度不足，正在等待較清楚的訊號。'
    return
  }
  message.value = '已收到定位，正在辨識停留。'
  const visit = detector.update(p)
  if (!visit) return
  stopGps()
  stay.value = visit
  message.value = ''
  if (allowLookup.value) void lookup()
}

onMounted(async () => {
  const subscriptions = await Promise.all([gps.addListener('position', position), gps.addListener('ended', ({ session: id }) => {
    if (id === session) { reset(); message.value = '定位已停止。' }
  })])
  if (!mounted) { subscriptions.forEach(h => void h.remove()); return }
  handles = subscriptions
  ready.value = true
})
watch(reviewBook, () => { reset(); allowLookup.value = false })
onUnmounted(() => { mounted = false; reset(); handles.forEach(h => void h.remove()) })

async function start() {
  reset()
  const id = crypto.randomUUID()
  session = id
  active.value = true
  message.value = '正在等待精確定位…'
  try { await gps.start({ session: id }) }
  catch (err) {
    if (session === id) { reset(); message.value = err instanceof Error ? err.message : '無法啟用定位。' }
  }
}

function toggle(choice: Choice) {
  const field = choice.kind === 'parking' ? parking : meal
  field.value = field.value === choice ? undefined : choice
}

async function stage() {
  if (!selected.value.length || busy.value || reviewBusy.value) return
  busy.value = true
  try {
    await stageDrafts(selected.value.map(c => c.draft), { kind: 'location' }, reviewBook.value)
    if (mounted) await router.push('/review')
  } catch (err) {
    message.value = err instanceof Error ? err.message : '無法加入待確認清單。'
  } finally { busy.value = false }
}
</script>

<template>
  <div class="page stack">
    <h1 class="page-title">停留記帳建議</h1>
    <p class="page-sub">開啟後請保持此頁在前景。連續停留約 15 分鐘後，依移動與附近場所提示可能的停車費或用餐支出。</p>
    <div v-if="!active && !stay" class="card stack">
      <label><input v-model="allowLookup" type="checkbox"> 停留後自動查詢附近場所</label>
      <p class="muted small">查詢時會把單一停留點的約略座標傳給 OpenStreetMap。App 只在記憶體中保留判讀所需的定位點。</p>
      <button class="btn accent" :disabled="!ready" @click="start">開啟前景定位</button>
    </div>
    <button v-if="active" class="btn ghost" @click="reset">關閉定位</button>
    <p v-if="message" role="status">{{ message }}</p>
    <div v-if="stay" class="card stack">
      <h2>這次停留約 {{ minutes }} 分鐘</h2>
      <span>{{ timeLabel(stay.start) }} – {{ timeLabel(stay.end) }}（台北時間）</span>
      <p class="muted small">本次定位已結束。請選擇實際發生的支出，金額留在待確認清單填寫。</p>
      <template v-if="choices.length">
        <fieldset v-for="kind in (['parking', 'meal'] as const).filter(k => choices.some(c => c.kind === k))" :key="kind" class="stack">
          <legend>{{ kind === 'parking' ? '可能有停車費' : '可能在附近用餐' }}</legend>
          <label v-for="choice in choices.filter(c => c.kind === kind)" :key="choice.label">
            <input type="checkbox" :checked="selected.includes(choice)"
              @change="toggle(choice)">
            {{ choice.label }}
          </label>
        </fieldset>
        <button class="btn accent" :disabled="!selected.length || busy || reviewBusy" @click="stage">加入待確認清單</button>
      </template>
      <template v-else-if="!busy">
        <p class="muted small">按下查詢會將這次停留的約略座標傳至 OpenStreetMap。</p>
        <button class="btn ghost" @click="lookup">查詢附近場所</button>
      </template>
      <small v-if="choices.length">場所資料 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 貢獻者</a></small>
      <button class="btn ghost" @click="reset">略過這次停留</button>
    </div>
  </div>
</template>
