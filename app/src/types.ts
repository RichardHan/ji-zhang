export type TxType = '支出' | '收入'

export type AiProviderId = 'auto' | 'local' | 'openrouter'

/** Default is auto-free: pick a live free OpenRouter model. Manual is an opt-in override. */
export type ModelSelectionMode = 'auto-free' | 'manual'

export type LocalModelId = 'gemma-4-e2b' | 'qwen3.5-0.8b-vl'

export interface Transaction {
  id: string
  date: string
  amount: number
  category: string
  account: string
  note: string
  type: TxType
  createdAt: string
  rowNumber?: number
}

export interface DraftTransaction {
  date: string
  amount: number
  category: string
  account: string
  note: string
  type: TxType
}

export interface UserProfile {
  email: string
  name: string
  imageUrl: string
}

export interface AppSettings {
  openRouterKey: string
  aiProvider: AiProviderId
  textModelMode: ModelSelectionMode
  visionModelMode: ModelSelectionMode
  model: string
  visionModel: string
  localModelId: LocalModelId
  wifiOnlyDownload: boolean
  enableNanoFallback: boolean
  paidFailureFallbackToFree: boolean
  spreadsheetId: string
  spreadsheetUrl: string
}
