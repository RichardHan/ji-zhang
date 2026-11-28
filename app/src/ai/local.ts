import { todayISO } from '../dates'
import type { LocalModelId } from '../types'
import { LocalAi } from './local-plugin'
import {
  draftsFromModelText,
  resizeImageDataUrl,
  textSystemPrompt,
  visionSystemPrompt,
} from './parse'
import {
  getLocalModelSpec,
  type AiProvider,
  type LocalAiStatus,
  type MonthInsightInput,
  type ParseResult,
} from './types'

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

export class LocalProvider implements AiProvider {
  readonly id: 'local' | 'nano'

  constructor(
    private readonly modelId: LocalModelId = 'gemma-4-e2b',
    private readonly runtime: 'litert' | 'nano' = 'litert',
  ) {
    this.id = runtime === 'nano' ? 'nano' : 'local'
  }

  async getStatus(): Promise<LocalAiStatus> {
    const spec = getLocalModelSpec(this.modelId)
    try {
      return await LocalAi.getStatus({ modelId: this.modelId })
    } catch (err) {
      return {
        available: false,
        downloading: false,
        downloadProgress: 0,
        reason: err instanceof Error ? err.message : String(err),
        backend: '',
        modelId: spec.id,
        modelName: spec.label,
        modelPath: '',
        downloadedBytes: 0,
        totalBytes: spec.sizeBytes,
        freeStorageBytes: 0,
        nanoStatus: 'unavailable',
        nanoModelName: '',
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    const status = await this.getStatus()
    return this.runtime === 'nano' ? status.nanoStatus === 'available' : status.available
  }

  async parseText(input: string): Promise<ParseResult> {
    const text = input.trim()
    if (!text) {
      throw new Error('請先輸入要記的內容，例如「午餐 120 信用卡」。')
    }
    const today = todayISO()
    const res = await LocalAi.parseText({
      prompt: text,
      systemPrompt: textSystemPrompt(today),
      modelId: this.modelId,
      runtime: this.runtime,
    })
    return {
      transactions: draftsFromModelText(res.text, today),
      modelUsed: res.modelUsed || (this.runtime === 'nano' ? 'gemini-nano' : this.modelId),
      provider: this.id,
    }
  }

  async parseImage(imageDataUrl: string, hint = ''): Promise<ParseResult> {
    if (!imageDataUrl) {
      throw new Error('請先選取收據或電子發票的照片。')
    }
    const today = todayISO()
    const resized = await resizeImageDataUrl(imageDataUrl, 1280, 0.85)
    const res = await LocalAi.parseImage({
      prompt: hint.trim() || '請解析這張收據或電子發票。',
      systemPrompt: visionSystemPrompt(today),
      imageBase64: dataUrlToBase64(resized),
      modelId: this.modelId,
      runtime: this.runtime,
    })
    return {
      transactions: draftsFromModelText(res.text, today),
      modelUsed: res.modelUsed || (this.runtime === 'nano' ? 'gemini-nano' : this.modelId),
      provider: this.id,
    }
  }

  async monthlyInsight(summary: MonthInsightInput) {
    const lines = summary.byCategory
      .map((c) => `${c.category} ${Math.round(c.amount)} 元`)
      .join('、')
    const prompt = `資料：${summary.month} 支出 ${Math.round(summary.expense)} 元，收入 ${Math.round(summary.income)} 元。支出分類：${lines || '無'}。`
    const res = await LocalAi.parseText({
      prompt,
      systemPrompt: '用繁體中文寫一段不超過 80 字的記帳觀察，語氣平實、不要標題、不要建議投資商品。',
      modelId: this.modelId,
      runtime: this.runtime,
    })
    const out = res.text.trim()
    if (!out) throw new Error('無法產生分析')
    return { text: out }
  }
}
