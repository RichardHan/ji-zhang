import type { AiProviderId, LocalModelId, ModelSelectionMode } from '../types'
import { LocalProvider } from './local'
import { OpenRouterProvider, type OpenRouterSettings } from './openrouter'
import type { MonthInsightInput, ParseResult } from './types'

export type {
  ParseResult,
  LocalAiStatus,
  LocalDownloadEvent,
  NanoDownloadEvent,
  MonthInsightInput,
} from './types'
export { listOpenRouterModels, formatModelPrice, filterCatalog } from './openrouter-models'
export type { CatalogModel, ModelKind, PriceFilter } from './openrouter-models'
export { LocalProvider } from './local'
export { LocalAi } from './local-plugin'
export {
  LOCAL_MODELS,
  LOCAL_MODEL_NAME,
  LOCAL_MODEL_SIZE_BYTES,
  getLocalModelSpec,
} from './types'

export interface ResolveOptions extends OpenRouterSettings {
  aiProvider: AiProviderId
  localModelId: LocalModelId
  enableNanoFallback: boolean
}

function openRouter(settings: OpenRouterSettings): OpenRouterProvider {
  return new OpenRouterProvider(settings)
}

async function runChain<T>(
  settings: ResolveOptions,
  run: (provider: LocalProvider | OpenRouterProvider) => Promise<T>,
): Promise<T> {
  const litert = new LocalProvider(settings.localModelId, 'litert')
  const nano = new LocalProvider(settings.localModelId, 'nano')
  const cloud = openRouter(settings.aiProvider === 'auto'
    ? { ...settings, textModelMode: 'auto-free', visionModelMode: 'auto-free' }
    : settings)

  if (settings.aiProvider === 'openrouter') {
    return run(cloud)
  }

  if (settings.aiProvider === 'local') {
    let lastErr: unknown = null
    if (await litert.isAvailable()) {
      try {
        return await run(litert)
      } catch (err) {
        lastErr = err
      }
    }
    if (settings.enableNanoFallback && (await nano.isAvailable())) {
      return run(nano)
    }
    if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    throw new Error('本機模型尚未下載，且 Gemini Nano 不可用。請先到設定下載本機模型，或改用「自動」模式。')
  }

  // Auto order: Local LiteRT-LM -> Gemini Nano (no-download AICore) -> OpenRouter (auto-free)
  let lastLocalErr: unknown = null
  if (await litert.isAvailable()) {
    try {
      return await run(litert)
    } catch (err) {
      lastLocalErr = err
    }
  }
  if (settings.enableNanoFallback && (await nano.isAvailable())) {
    try {
      return await run(nano)
    } catch (err) {
      lastLocalErr = err
    }
  }
  if (await cloud.isAvailable()) {
    return run(cloud)
  }
  if (lastLocalErr) {
    throw lastLocalErr instanceof Error ? lastLocalErr : new Error(String(lastLocalErr))
  }
  throw new Error('本機模型與 Gemini Nano 尚未就緒，也還沒有設定 OpenRouter 金鑰。')
}

export async function parseText(settings: ResolveOptions, input: string): Promise<ParseResult> {
  return runChain(settings, (provider) => provider.parseText(input))
}

export async function parseImage(
  settings: ResolveOptions,
  imageDataUrl: string,
  hint?: string,
): Promise<ParseResult> {
  return runChain(settings, (provider) => provider.parseImage(imageDataUrl, hint))
}

export async function writeMonthlyInsight(
  settings: ResolveOptions,
  summary: MonthInsightInput,
): Promise<{text: string; notice?: string}> {
  return runChain(settings, (provider) => provider.monthlyInsight(summary))
}

export async function hasAnyLocalReady(settings: Pick<ResolveOptions, 'localModelId' | 'enableNanoFallback'>): Promise<boolean> {
  const litert = new LocalProvider(settings.localModelId, 'litert')
  const status = await litert.getStatus()
  if (status.available) return true
  return settings.enableNanoFallback && status.nanoStatus === 'available'
}

export function describeModelChoice(
  mode: ModelSelectionMode,
  manualId: string,
  lastUsed?: string,
): string {
  if (mode === 'auto-free') {
    return lastUsed ? `自動選免費模型（本次：${lastUsed}）` : '自動選免費模型'
  }
  return manualId || '尚未選擇模型'
}

export { OpenRouterProvider } from './openrouter'
