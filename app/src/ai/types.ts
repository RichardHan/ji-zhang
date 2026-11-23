import type { DraftTransaction } from '../types'

export interface ParseResult {
  transactions: DraftTransaction[]
  modelUsed: string
  provider: 'local' | 'openrouter'
}

export interface MonthInsightInput {
  month: string
  income: number
  expense: number
  byCategory: { category: string; amount: number }[]
}

export interface LocalAiStatus {
  available: boolean
  reason: string
  backend: string
  modelName: string
  modelPath: string
  downloadedBytes: number
  totalBytes: number
}

export interface AiProvider {
  readonly id: 'local' | 'openrouter'
  isAvailable(): Promise<boolean>
  parseText(input: string): Promise<ParseResult>
  parseImage(imageDataUrl: string, hint?: string): Promise<ParseResult>
  monthlyInsight(summary: MonthInsightInput): Promise<string>
}

export const LOCAL_MODEL_NAME = 'Gemma 4 E2B（LiteRT-LM）'
export const LOCAL_MODEL_SIZE_BYTES = 2_580_000_000
