import { computed, reactive } from 'vue'
import { DEFAULT_MODEL } from '../constants'
import { currentMonth, monthKey } from '../dates'
import {
  googleConfigError,
  isGoogleSignedIn,
  signInWithGoogle,
  signOutGoogle,
} from '../google/auth'
import {
  appendTransactions,
  createSpreadsheet,
  deleteTransaction,
  ensureSheet,
  listTransactions,
  parseSpreadsheetId,
  spreadsheetUrl,
  updateTransaction,
} from '../google/sheets'
import { storage } from '../storage'
import type { DraftTransaction, Transaction, UserProfile } from '../types'

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
    if (!state.spreadsheetId) {
      state.transactions = []
      return
    }
    state.loading = true
    try {
      state.transactions = await listTransactions(state.spreadsheetId)
    } finally {
      state.loading = false
    }
  }

  async function addDrafts(drafts: DraftTransaction[]): Promise<void> {
    if (!state.spreadsheetId) throw new Error('還沒有選擇試算表。')
    state.loading = true
    state.error = ''
    try {
      await appendTransactions(state.spreadsheetId, drafts)
      await refreshTransactions()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      state.loading = false
    }
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
    await signOutGoogle()
    state.signedIn = false
    state.profile = null
    state.transactions = []
  }

  async function disconnectSheet(): Promise<void> {
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
    addDrafts,
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
