import { todayISO } from '../dates'
import { LocalAi } from './local-plugin'
import { draftsFromModelText } from './parse'
import type { AiProvider, LocalAiStatus, MonthInsightInput, ParseResult } from './types'

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

export class LocalProvider implements AiProvider {
  readonly id = 'local' as const

  async getStatus(): Promise<LocalAiStatus> {
    try {
      return await LocalAi.getStatus()
    } catch (err) {
      return {
        available: false,
        reason: err instanceof Error ? err.message : String(err),
        backend: '',
        modelName: '',
        modelPath: '',
        downloadedBytes: 0,
        totalBytes: 0,
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.getStatus()
    return status.available
  }

  async parseText(input: string): Promise<ParseResult> {
    const text = input.trim()
    if (!text) {
      throw new Error('請先輸入要記的內容，例如「午餐 120 信用卡」。')
    }
    const today = todayISO()
    const { text: content } = await LocalAi.parseText({ prompt: text, today })
    return {
      transactions: draftsFromModelText(content, today),
      modelUsed: 'local',
      provider: 'local',
    }
  }

  async parseImage(imageDataUrl: string, hint = ''): Promise<ParseResult> {
    if (!imageDataUrl) {
      throw new Error('請先選取收據或電子發票的照片。')
    }
    const today = todayISO()
    const { text: content } = await LocalAi.parseImage({
      prompt: hint.trim() || '請解析這張收據或電子發票。',
      today,
      imageBase64: dataUrlToBase64(imageDataUrl),
    })
    return {
      transactions: draftsFromModelText(content, today),
      modelUsed: 'local',
      provider: 'local',
    }
  }

  async monthlyInsight(_summary: MonthInsightInput): Promise<string> {
    throw new Error('本機模型尚未實作月報觀察。可改用 OpenRouter，或等本機模型就緒。')
  }
}
