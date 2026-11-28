import { Preferences } from '@capacitor/preferences'
import type { AiProviderId, LocalModelId, ModelSelectionMode } from './types'
import type { SpeechDraft } from './speech'
import type { PendingBatch } from './types'

const KEYS = {
  openRouterKey: 'openrouter_api_key',
  model: 'openrouter_model',
  visionModel: 'openrouter_vision_model',
  aiProvider: 'ai_provider',
  textModelMode: 'text_model_mode',
  visionModelMode: 'vision_model_mode',
  localModelId: 'local_model_id',
  wifiOnlyDownload: 'local_wifi_only',
  enableNanoFallback: 'enable_nano_fallback',
  paidFailureFallbackToFree: 'paid_failure_fallback_free',
  modelsCache: 'openrouter_models_cache',
  modelsCacheAt: 'openrouter_models_cache_at',
  spreadsheetId: 'spreadsheet_id',
  spreadsheetUrl: 'spreadsheet_url',
  email: 'google_email',
  name: 'google_name',
  imageUrl: 'google_image',
  pendingBatches: 'pending_transaction_batches',
  speechDraft: 'pending_speech_draft',
} as const

async function get(key: string): Promise<string> {
  const { value } = await Preferences.get({ key })
  return value ?? ''
}

async function set(key: string, value: string): Promise<void> {
  if (value) {
    await Preferences.set({ key, value })
  } else {
    await Preferences.remove({ key })
  }
}

function parseProvider(value: string): AiProviderId {
  if (value === 'local' || value === 'openrouter' || value === 'auto') return value
  return 'auto'
}

function parseMode(value: string): ModelSelectionMode {
  return value === 'manual' ? 'manual' : 'auto-free'
}

function parseLocalModel(value: string): LocalModelId {
  return value === 'qwen3.5-0.8b-vl' ? 'qwen3.5-0.8b-vl' : 'gemma-4-e2b'
}

async function getSpeechDraft(): Promise<SpeechDraft | null> {
  const json = await get(KEYS.speechDraft)
  if (!json) return null
  const draft = JSON.parse(json) as Partial<SpeechDraft> | null
  if (typeof draft?.id !== 'string' || typeof draft.book !== 'string'
    || typeof draft.prompt !== 'string' || typeof draft.usedVoice !== 'boolean') {
    throw new Error('Invalid speech draft')
  }
  return { id: draft.id, book: draft.book, prompt: draft.prompt, usedVoice: draft.usedVoice }
}

export const storage = {
  getOpenRouterKey: () => get(KEYS.openRouterKey),
  setOpenRouterKey: (value: string) => set(KEYS.openRouterKey, value.trim()),
  getModel: () => get(KEYS.model),
  setModel: (value: string) => set(KEYS.model, value.trim()),
  getVisionModel: () => get(KEYS.visionModel),
  setVisionModel: (value: string) => set(KEYS.visionModel, value.trim()),
  getAiProvider: async (): Promise<AiProviderId> => parseProvider(await get(KEYS.aiProvider)),
  setAiProvider: (value: AiProviderId) => set(KEYS.aiProvider, value),
  getTextModelMode: async (): Promise<ModelSelectionMode> => parseMode(await get(KEYS.textModelMode)),
  setTextModelMode: (value: ModelSelectionMode) => set(KEYS.textModelMode, value),
  getVisionModelMode: async (): Promise<ModelSelectionMode> => parseMode(await get(KEYS.visionModelMode)),
  setVisionModelMode: (value: ModelSelectionMode) => set(KEYS.visionModelMode, value),
  getLocalModelId: async (): Promise<LocalModelId> => parseLocalModel(await get(KEYS.localModelId)),
  setLocalModelId: (value: LocalModelId) => set(KEYS.localModelId, value),
  getWifiOnlyDownload: async (): Promise<boolean> => (await get(KEYS.wifiOnlyDownload)) !== '0',
  setWifiOnlyDownload: (value: boolean) => set(KEYS.wifiOnlyDownload, value ? '1' : '0'),
  getEnableNanoFallback: async (): Promise<boolean> => (await get(KEYS.enableNanoFallback)) !== '0',
  setEnableNanoFallback: (value: boolean) => set(KEYS.enableNanoFallback, value ? '1' : '0'),
  getPaidFailureFallbackToFree: async (): Promise<boolean> =>
    (await get(KEYS.paidFailureFallbackToFree)) !== '0',
  setPaidFailureFallbackToFree: (value: boolean) =>
    set(KEYS.paidFailureFallbackToFree, value ? '1' : '0'),
  getModelsCache: () => get(KEYS.modelsCache),
  getModelsCacheAt: () => get(KEYS.modelsCacheAt),
  setModelsCache: async (json: string, cachedAt: number) => {
    await set(KEYS.modelsCache, json)
    await set(KEYS.modelsCacheAt, String(cachedAt))
  },
  getSpreadsheetId: () => get(KEYS.spreadsheetId),
  setSpreadsheetId: (value: string) => set(KEYS.spreadsheetId, value.trim()),
  getSpreadsheetUrl: () => get(KEYS.spreadsheetUrl),
  setSpreadsheetUrl: (value: string) => set(KEYS.spreadsheetUrl, value.trim()),
  getEmail: () => get(KEYS.email),
  getName: () => get(KEYS.name),
  getImageUrl: () => get(KEYS.imageUrl),
  setProfile: async (email: string, name: string, imageUrl: string) => {
    await set(KEYS.email, email)
    await set(KEYS.name, name)
    await set(KEYS.imageUrl, imageUrl)
  },
  getPendingBatches: async (): Promise<PendingBatch[]> => {
    const json = await get(KEYS.pendingBatches)
    if (!json) return []
    const batches: unknown = JSON.parse(json)
    if (!Array.isArray(batches)) throw new Error('Invalid pending transaction queue')
    return batches as PendingBatch[]
  },
  setPendingBatches: (batches: PendingBatch[]) =>
    set(KEYS.pendingBatches, batches.length ? JSON.stringify(batches) : ''),
  getSpeechDraft,
  saveSpeechDraft: (draft: SpeechDraft) => set(KEYS.speechDraft, JSON.stringify(draft)),
  clearSpeechDraft: async (id: string) => {
    if ((await getSpeechDraft())?.id === id) await set(KEYS.speechDraft, '')
  },
  clearAuth: async () => {
    await Preferences.remove({ key: KEYS.email })
    await Preferences.remove({ key: KEYS.name })
    await Preferences.remove({ key: KEYS.imageUrl })
  },
  clearSpreadsheet: async () => {
    await Preferences.remove({ key: KEYS.spreadsheetId })
    await Preferences.remove({ key: KEYS.spreadsheetUrl })
  },
}
