import { computed, reactive } from 'vue'
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
import type { AiProviderId, DraftTransaction, ModelSelectionMode, Transaction, UserProfile } from '../types'

interface AppState {
  ready: boolean
  loading: boolean
  error: string
  profile: UserProfile | null
  signedIn: boolean
  spreadsheetId: string
  spreadsheetUrl: string
  openRouterKey: string
  aiProvider: AiProviderId
  textModelMode: ModelSelectionMode
  visionModelMode: ModelSelectionMode
  model: string
  visionModel: string
  wifiOnlyDownload: boolean
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
    aiProvider: 'auto',
    textModelMode: 'auto-free',
    visionModelMode: 'auto-free',
    model: '',
    visionModel: '',
    wifiOnlyDownload: true,
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
    state.aiProvider = await storage.getAiProvider()
    state.textModelMode = await storage.getTextModelMode()
    state.visionModelMode = await storage.getVisionModelMode()
    state.model = await storage.getModel()
    state.visionModel = await storage.getVisionModel()
    state.wifiOnlyDownload = await storage.getWifiOnlyDownload()
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

  async function saveSettings(next: {
    openRouterKey?: string
    aiProvider?: AiProviderId
    textModelMode?: ModelSelectionMode
    visionModelMode?: ModelSelectionMode
    model?: string
    visionModel?: string
    wifiOnlyDownload?: boolean
  }): Promise<void> {
    if (next.openRouterKey !== undefined) {
      state.openRouterKey = next.openRouterKey
      await storage.setOpenRouterKey(next.openRouterKey)
    }
    if (next.aiProvider !== undefined) {
      state.aiProvider = next.aiProvider
      await storage.setAiProvider(next.aiProvider)
    }
    if (next.textModelMode !== undefined) {
      state.textModelMode = next.textModelMode
      await storage.setTextModelMode(next.textModelMode)
    }
    if (next.visionModelMode !== undefined) {
      state.visionModelMode = next.visionModelMode
      await storage.setVisionModelMode(next.visionModelMode)
    }
    if (next.model !== undefined) {
      state.model = next.model
      await storage.setModel(next.model)
    }
    if (next.visionModel !== undefined) {
      state.visionModel = next.visionModel
      await storage.setVisionModel(next.visionModel)
    }
    if (next.wifiOnlyDownload !== undefined) {
      state.wifiOnlyDownload = next.wifiOnlyDownload
      await storage.setWifiOnlyDownload(next.wifiOnlyDownload)
    }
  }

  function aiSettings() {
    return {
      apiKey: state.openRouterKey,
      aiProvider: state.aiProvider,
      textModelMode: state.textModelMode,
      visionModelMode: state.visionModelMode,
      textModel: state.model,
      visionModel: state.visionModel,
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
    aiSettings,
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
