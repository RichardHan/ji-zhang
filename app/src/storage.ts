import { Preferences } from '@capacitor/preferences'
import type { PendingBatch } from './types'

const KEYS = {
  openRouterKey: 'openrouter_api_key',
  model: 'openrouter_model',
  spreadsheetId: 'spreadsheet_id',
  spreadsheetUrl: 'spreadsheet_url',
  email: 'google_email',
  name: 'google_name',
  imageUrl: 'google_image',
  pendingBatches: 'pending_transaction_batches',
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

export const storage = {
  getOpenRouterKey: () => get(KEYS.openRouterKey),
  setOpenRouterKey: (value: string) => set(KEYS.openRouterKey, value.trim()),
  getModel: () => get(KEYS.model),
  setModel: (value: string) => set(KEYS.model, value.trim()),
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
