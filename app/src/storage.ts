import { Preferences } from '@capacitor/preferences'
import type { AiProviderId, ModelSelectionMode } from './types'

const KEYS = {
  openRouterKey: 'openrouter_api_key',
  model: 'openrouter_model',
  visionModel: 'openrouter_vision_model',
  aiProvider: 'ai_provider',
  textModelMode: 'text_model_mode',
  visionModelMode: 'vision_model_mode',
  wifiOnlyDownload: 'local_wifi_only',
  modelsCache: 'openrouter_models_cache',
  modelsCacheAt: 'openrouter_models_cache_at',
  spreadsheetId: 'spreadsheet_id',
  spreadsheetUrl: 'spreadsheet_url',
  email: 'google_email',
  name: 'google_name',
  imageUrl: 'google_image',
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
  getWifiOnlyDownload: async (): Promise<boolean> => (await get(KEYS.wifiOnlyDownload)) !== '0',
  setWifiOnlyDownload: (value: boolean) => set(KEYS.wifiOnlyDownload, value ? '1' : '0'),
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
