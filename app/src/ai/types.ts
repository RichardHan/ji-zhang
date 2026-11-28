import type { DraftTransaction, LocalModelId } from '../types'

export interface ParseResult {
  transactions: DraftTransaction[]
  modelUsed: string
  provider: 'local' | 'nano' | 'openrouter'
  notice?: string
}

export interface MonthInsightInput {
  month: string
  income: number
  expense: number
  byCategory: { category: string; amount: number }[]
}

export type NanoStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable'

export interface LocalAiStatus {
  available: boolean
  downloading: boolean
  downloadProgress: number
  reason: string
  backend: string
  modelId: LocalModelId
  modelName: string
  modelPath: string
  downloadedBytes: number
  totalBytes: number
  freeStorageBytes: number
  nanoStatus: NanoStatus
  nanoModelName: string
}

export interface LocalDownloadEvent {
  modelId: LocalModelId
  downloadedBytes: number
  totalBytes: number
  progress: number
  state: 'downloading' | 'completed' | 'failed'
}

export interface NanoDownloadEvent {
  state: 'downloading' | 'completed'
  bytes?: number
  totalBytes?: number
}

export interface AiProvider {
  readonly id: 'local' | 'nano' | 'openrouter'
  isAvailable(): Promise<boolean>
  parseText(input: string): Promise<ParseResult>
  parseImage(imageDataUrl: string, hint?: string): Promise<ParseResult>
  monthlyInsight(summary: MonthInsightInput): Promise<{ text: string; notice?: string }>
}

export interface LocalModelSpec {
  id: LocalModelId
  label: string
  sizeBytes: number
  description: string
}

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: 'gemma-4-e2b',
    label: 'Gemma 4 E2B（預設，中文與收據較準）',
    sizeBytes: 2_588_147_712,
    description: '約 2.59 GB，Google 實測 S26 Ultra GPU 達 52 tok/s，文字與台灣電子發票辨識均衡。',
  },
  {
    id: 'qwen3.5-0.8b-vl',
    label: 'Qwen 3.5 0.8B VL（輕量備選，省空間）',
    sizeBytes: 1_303_724_032,
    description: '約 1.30 GB，體積少一半、也支援圖片，但細小發票字體較吃力。',
  },
]

export function getLocalModelSpec(id: LocalModelId): LocalModelSpec {
  return LOCAL_MODELS.find((m) => m.id === id) ?? LOCAL_MODELS[0]
}

export const LOCAL_MODEL_NAME = LOCAL_MODELS[0].label
export const LOCAL_MODEL_SIZE_BYTES = LOCAL_MODELS[0].sizeBytes
