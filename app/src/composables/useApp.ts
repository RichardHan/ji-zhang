import { computed, reactive, ref } from 'vue'
import { DEFAULT_MODEL } from '../constants'
import { currentMonth, monthKey } from '../dates'
import {
  googleConfigError,
  isGoogleSignedIn,
  signInWithGoogle,
  signOutGoogle,
} from '../google/auth'
import {
  commitTransactionBatch,
  createSpreadsheet,
  deleteTransaction,
  ensureSheet,
  listTransactions,
  parseSpreadsheetId,
  spreadsheetUrl,
  updateTransaction,
} from '../google/sheets'
import { missingDraftFields } from '../review'
import { storage } from '../storage'
import type { DraftTransaction, PendingBatch, ReviewSource, Transaction, UserProfile } from '../types'

interface AppState {
  ready: boolean
  loading: boolean
  error: string
  profile: UserProfile | null
  signedIn: boolean
  spreadsheetId: string
  spreadsheetUrl: string
  openRouterKey: string
  model: string
  transactions: Transaction[]
  selectedMonth: string
}

function createAppStore() {
  const state = reactive<AppState>({
    ready: false,
    loading: false,
    error: '',
    profile: null,
    signedIn: false,
    spreadsheetId: '',
    spreadsheetUrl: '',
    openRouterKey: '',
    model: DEFAULT_MODEL,
    transactions: [],
    selectedMonth: currentMonth(),
  })

  const configError = computed(() => googleConfigError())
  const hasSheet = computed(() => state.spreadsheetId.length > 0)
  const monthTransactions = computed(() =>
    state.transactions.filter((t) => monthKey(t.date) === state.selectedMonth),
  )

  const queued = ref<PendingBatch[]>([])
  const reviewBusy = ref(false)
  const reviewError = ref('')
  const listedBook = ref<string | null>(null)
  const reviewBook = computed(() => {
    const email = state.profile?.email.trim().toLowerCase()
    return state.signedIn && email && state.spreadsheetId
      ? JSON.stringify([email, state.spreadsheetId])
      : null
  })
  const pendingBatches = computed(() => queued.value.filter((batch) => batch.book === reviewBook.value))
  const reviewTransactions = computed(() => listedBook.value === reviewBook.value ? state.transactions : [])

  async function persistQueue(next: PendingBatch[]): Promise<void> {
    await storage.setPendingBatches(next)
    queued.value = next
  }

  async function changeQueue<T>(book: string | null, run: (book: string) => Promise<T>): Promise<T> {
    if (!book || book !== reviewBook.value) throw new Error('帳號或試算表已變更，請重新開始。')
    if (reviewError.value) throw new Error(reviewError.value)
    if (reviewBusy.value || state.loading) throw new Error('處理中，請稍候。')
    reviewBusy.value = true
    try {
      return await run(book)
    } finally {
      reviewBusy.value = false
    }
  }

  function checkReviewIdle(): void {
    if (reviewBusy.value) throw new Error('正在處理待確認記錄，請稍候。')
  }

  async function stageDrafts(
    drafts: DraftTransaction[],
    source: ReviewSource,
    book = reviewBook.value,
  ): Promise<void> {
    if (drafts.length === 0) return
    await changeQueue(book, async (book) => {
      // Only opaque keys go into Sheets. The same source event must have the same key on every device.
      const id = source.eventId
        ? Array.from(new Uint8Array(await crypto.subtle.digest(
          'SHA-256', new TextEncoder().encode(JSON.stringify([source.kind, source.eventId])),
        )), (byte) => byte.toString(16).padStart(2, '0')).join('')
        : crypto.randomUUID().replaceAll('-', '')
      if (queued.value.some((batch) => batch.book === book && batch.id === id)) return
      await persistQueue([
        ...queued.value,
        { id, book, source: source.kind, modelUsed: source.modelUsed, drafts: drafts.map((draft) => ({ ...draft })) },
      ])
    })
  }

  function pendingBatch(id: string): PendingBatch {
    const batch = pendingBatches.value.find((item) => item.id === id)
    if (!batch) throw new Error('找不到這批待確認記錄。')
    return batch
  }

  function replaceBatch(batch: PendingBatch, replacement?: PendingBatch): Promise<void> {
    return persistQueue(replacement
      ? queued.value.map((item) => item === batch ? replacement : item)
      : queued.value.filter((item) => item !== batch))
  }

  async function editPendingDraft(id: string, index: number, draft?: DraftTransaction): Promise<void> {
    await changeQueue(reviewBook.value, async () => {
      const batch = pendingBatch(id)
      if (batch.submitted || !batch.drafts[index]) throw new Error('這筆記錄已無法修改。')
      const drafts = batch.drafts.slice()
      if (draft) drafts[index] = { ...draft }
      else drafts.splice(index, 1)
      await replaceBatch(batch, drafts.length ? { ...batch, drafts } : undefined)
    })
  }

  async function discardPendingBatch(id: string): Promise<void> {
    await changeQueue(reviewBook.value, async () => replaceBatch(pendingBatch(id)))
  }

  async function hydrate(): Promise<void> {
    state.error = ''
    state.openRouterKey = await storage.getOpenRouterKey()
    state.model = (await storage.getModel()) || DEFAULT_MODEL
    state.spreadsheetId = await storage.getSpreadsheetId()
    state.spreadsheetUrl = await storage.getSpreadsheetUrl()
    const email = await storage.getEmail()
    if (email) {
      state.profile = {
        email,
        name: await storage.getName(),
        imageUrl: await storage.getImageUrl(),
      }
    }
    state.signedIn = await isGoogleSignedIn()
    reviewError.value = ''
    try {
      queued.value = await storage.getPendingBatches()
    } catch {
      reviewError.value = '無法讀取裝置上的待確認清單，未覆蓋現有資料。'
    }
    if (state.signedIn && state.spreadsheetId) {
      try {
        await refreshTransactions()
      } catch (err) {
        state.error = err instanceof Error ? err.message : String(err)
      }
    }
    state.ready = true
  }

  async function signIn(): Promise<void> {
    state.loading = true
    state.error = ''
    try {
      state.profile = await signInWithGoogle()
      state.signedIn = true
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
  }

  async function createBook(): Promise<void> {
    checkReviewIdle()
    state.loading = true
    state.error = ''
    try {
      const created = await createSpreadsheet()
      state.spreadsheetId = created.id
      state.spreadsheetUrl = created.url
      await storage.setSpreadsheetId(created.id)
      await storage.setSpreadsheetUrl(created.url)
      await refreshTransactions()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
  }

  async function connectSheet(input: string): Promise<void> {
    checkReviewIdle()
    const id = parseSpreadsheetId(input)
    if (!id) {
      throw new Error('請貼上 Google 試算表連結或試算表 ID。')
    }
    state.loading = true
    state.error = ''
    try {
      await ensureSheet(id)
      state.spreadsheetId = id
      state.spreadsheetUrl = spreadsheetUrl(id)
      await storage.setSpreadsheetId(id)
      await storage.setSpreadsheetUrl(spreadsheetUrl(id))
      await refreshTransactions()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
  }

  async function changeSheet(input?: string): Promise<void> {
    if (input && input.trim()) {
      await connectSheet(input)
      return
    }
    await createBook()
  }

  async function refreshTransactions(): Promise<void> {
    const book = reviewBook.value
    const id = state.spreadsheetId
    if (!id) {
      state.transactions = []
      return
    }
    state.loading = true
    try {
      const transactions = await listTransactions(id)
      if (book === reviewBook.value && id === state.spreadsheetId && state.signedIn) {
        state.transactions = transactions
        listedBook.value = book
      }
    } finally {
      state.loading = false
    }
  }

  async function confirmPendingBatch(id: string) {
    return changeQueue(reviewBook.value, async () => {
      const batch = pendingBatch(id)
      if (batch.drafts.some((draft) => missingDraftFields(draft).length)) {
        throw new Error('請先補齊日期與 TWD 金額。')
      }
      // Persist the intent before the write; retries after a restart use the same batch and payload.
      if (!batch.submitted) await replaceBatch(batch, { ...batch, submitted: true })
      const result = await commitTransactionBatch(state.spreadsheetId, batch)
      const warnings: string[] = []
      try {
        await replaceBatch(pendingBatch(id))
      } catch {
        warnings.push('已入帳，但未能清除這台裝置的待確認項目；再次確認不會重複寫入。')
      }
      try {
        await refreshTransactions()
      } catch {
        warnings.push('已入帳，但無法更新明細；請稍後重新整理。')
      }
      return { result, count: batch.drafts.length, warnings }
    })
  }

  async function saveTransaction(tx: Transaction): Promise<void> {
    if (!state.spreadsheetId) throw new Error('還沒有選擇試算表。')
    state.loading = true
    state.error = ''
    try {
      await updateTransaction(state.spreadsheetId, tx)
      await refreshTransactions()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
  }

  async function removeTransaction(tx: Transaction): Promise<void> {
    if (!state.spreadsheetId) throw new Error('還沒有選擇試算表。')
    state.loading = true
    state.error = ''
    try {
      await deleteTransaction(state.spreadsheetId, tx)
      await refreshTransactions()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
  }

  async function saveSettings(next: { openRouterKey?: string; model?: string }): Promise<void> {
    if (next.openRouterKey !== undefined) {
      state.openRouterKey = next.openRouterKey
      await storage.setOpenRouterKey(next.openRouterKey)
    }
    if (next.model !== undefined) {
      state.model = next.model
      await storage.setModel(next.model)
    }
  }

  async function signOut(): Promise<void> {
    checkReviewIdle()
    state.loading = true
    try {
      await signOutGoogle()
      state.signedIn = false
      state.profile = null
      state.transactions = []
      listedBook.value = null
    } finally {
      state.loading = false
    }
  }

  async function disconnectSheet(): Promise<void> {
    checkReviewIdle()
    state.spreadsheetId = ''
    state.spreadsheetUrl = ''
    state.transactions = []
    await storage.clearSpreadsheet()
  }

  return {
    state,
    configError,
    hasSheet,
    monthTransactions,
    hydrate,
    signIn,
    createBook,
    connectSheet,
    changeSheet,
    refreshTransactions,
    reviewBook,
    reviewBusy,
    reviewError,
    pendingBatches,
    reviewTransactions,
    stageDrafts,
    editPendingDraft,
    discardPendingBatch,
    confirmPendingBatch,
    saveTransaction,
    removeTransaction,
    saveSettings,
    signOut,
    disconnectSheet,
  }
}

export type AppStore = ReturnType<typeof createAppStore>

let singleton: AppStore | null = null

export function useApp(): AppStore {
  if (!singleton) singleton = createAppStore()
  return singleton
}
