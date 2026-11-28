import type { ModelSelectionMode } from '../types'
import { todayISO } from '../dates'
import type { AiProvider, MonthInsightInput, ParseResult } from './types'
import { draftsFromModelText, resizeImageDataUrl, textSystemPrompt, visionSystemPrompt } from './parse'
import {
  findCatalogModel,
  listOpenRouterModels,
  resolveModelCandidates,
  type ModelKind,
} from './openrouter-models'

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'

type ChatContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export interface OpenRouterSettings {
  apiKey: string
  textModelMode: ModelSelectionMode
  visionModelMode: ModelSelectionMode
  textModel: string
  visionModel: string
  paidFailureFallbackToFree: boolean
}

interface HttpError extends Error {
  status?: number
}

function asHttpError(message: string, status?: number): HttpError {
  const error = new Error(message) as HttpError
  error.status = status
  return error
}

async function complete(options: {
  apiKey: string
  model: string
  system: string
  user: ChatContent
  freeOnly: boolean
  useJsonFormat: boolean
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
    temperature: 0.2,
    max_tokens: 1200,
  }
  if (options.freeOnly) body.provider = { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } }
  if (options.useJsonFormat) {
    body.response_format = { type: 'json_object' }
  }
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/RichardHan/ji-zhang',
      'X-Title': 'ji-zhang',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const err = (await res.json()) as { error?: { message?: string } }
      detail = err.error?.message ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw asHttpError(detail || `OpenRouter 請求失敗（${res.status}）`, res.status)
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return data.choices?.[0]?.message?.content ?? ''
}

async function isPaidModelId(id: string): Promise<boolean> {
  if (id.endsWith(':free')) return false
  try {
    const models = await listOpenRouterModels()
    const match = findCatalogModel(models, id)
    if (match) return !match.isFree
  } catch {
    // Catalog unavailable: treat non-:free IDs conservatively as paid.
  }
  return true
}

async function tryModel(
  apiKey: string,
  model: string,
  system: string,
  user: ChatContent,
  freeOnly: boolean,
): Promise<string> {
  try {
    return await complete({ apiKey, model, system, user, freeOnly, useJsonFormat: true })
  } catch (err) {
    const status = (err as HttpError).status
    if (status === 400 || status === 422) {
      return await complete({ apiKey, model, system, user, freeOnly, useJsonFormat: false })
    }
    throw err
  }
}

async function runWithCandidates(
  settings: OpenRouterSettings,
  kind: ModelKind,
  system: string,
  user: ChatContent,
  parse: (content: string) => ParseResult['transactions'] | string,
): Promise<{ value: ParseResult['transactions'] | string; modelUsed: string; notice?: string }> {
  if (!settings.apiKey.trim()) {
    throw new Error('請先在設定裡填入 OpenRouter API 金鑰。')
  }
  const mode = kind === 'vision' ? settings.visionModelMode : settings.textModelMode
  const manualId = kind === 'vision' ? settings.visionModel : settings.textModel
  const { ids } = await resolveModelCandidates(kind, mode, manualId)
  let lastError: Error | null = null
  for (const model of ids) {
    try {
      const content = await tryModel(settings.apiKey, model, system, user, mode === 'auto-free' || model.endsWith(':free'))
      return { value: parse(content), modelUsed: model }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const status = (err as HttpError).status
      if (status === 401) throw lastError
      if (mode === 'manual') break

    }
  }

  // Manual model failed: never silently switch to another paid model.
  // If allowed (default ON), fall back to free auto mode and surface a clear notice.
  if (mode === 'manual' && settings.paidFailureFallbackToFree) {
    const manualWasPaid = await isPaidModelId(manualId.trim())
    const reason = lastError?.message || '請求失敗'
    const freeCandidates = await resolveModelCandidates(kind, 'auto-free', '')
    for (const freeId of freeCandidates.ids) {
      if (freeId === manualId.trim()) continue
      try {
        const content = await tryModel(settings.apiKey, freeId, system, user, true)
        const notice = manualWasPaid
          ? `付費模型「${manualId}」失敗（${reason}），已改用免費模型「${freeId}」（不會自動切換其他付費模型）。`
          : `指定模型「${manualId}」失敗（${reason}），已改用免費備援模型「${freeId}」。`
        return { value: parse(content), modelUsed: freeId, notice }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }
  }

  throw lastError ?? new Error('AI 解析失敗')
}

export class OpenRouterProvider implements AiProvider {
  readonly id = 'openrouter' as const

  constructor(private readonly settings: OpenRouterSettings) {}

  async isAvailable(): Promise<boolean> {
    return this.settings.apiKey.trim().length > 0
  }

  async parseText(input: string): Promise<ParseResult> {
    const text = input.trim()
    if (!text) {
      throw new Error('請先輸入要記的內容，例如「午餐 120 信用卡」。')
    }
    const today = todayISO()
    const result = await runWithCandidates(
      this.settings,
      'text',
      textSystemPrompt(today),
      text,
      (content) => draftsFromModelText(content, today),
    )
    return {
      transactions: result.value as ParseResult['transactions'],
      modelUsed: result.modelUsed,
      provider: 'openrouter',
      notice: result.notice,
    }
  }

  async parseImage(imageDataUrl: string, hint = ''): Promise<ParseResult> {
    if (!imageDataUrl) {
      throw new Error('請先選取收據或電子發票的照片。')
    }
    const today = todayISO()
    const image = await resizeImageDataUrl(imageDataUrl)
    const text = hint.trim() || '請解析這張收據或電子發票。'
    const result = await runWithCandidates(
      this.settings,
      'vision',
      visionSystemPrompt(today),
      [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: image } },
      ],
      (content) => draftsFromModelText(content, today),
    )
    return {
      transactions: result.value as ParseResult['transactions'],
      modelUsed: result.modelUsed,
      provider: 'openrouter',
      notice: result.notice,
    }
  }

  async monthlyInsight(summary: MonthInsightInput) {
    const lines = summary.byCategory
      .map((c) => `${c.category} ${Math.round(c.amount)} 元`)
      .join('、')
    const prompt = `用繁體中文寫一段不超过 80 字的記帳觀察，語氣平實、不要標題。資料：${summary.month} 支出 ${Math.round(summary.expense)} 元，收入 ${Math.round(summary.income)} 元。支出分類：${lines || '無'}。不要建議投資商品。`
    const result = await runWithCandidates(
      this.settings,
      'text',
      '你是記帳助手，只用繁體中文回答。',
      prompt,
      (content) => {
        const text = content.trim().replace(/^```[\s\S]*?```$/g, '').trim()
        if (!text) throw new Error('無法產生分析')
        return text
      },
    )
    return { text: result.value as string, notice: result.notice }
  }
}
