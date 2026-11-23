import type { AiProviderId, ModelSelectionMode } from '../types'
import { LocalProvider } from './local'
import { OpenRouterProvider, type OpenRouterSettings } from './openrouter'
import type { MonthInsightInput, ParseResult } from './types'

export type { ParseResult, LocalAiStatus, MonthInsightInput } from './types'
export { listOpenRouterModels, formatModelPrice, filterCatalog } from './openrouter-models'
export type { CatalogModel, ModelKind, PriceFilter } from './openrouter-models'
export { LocalProvider } from './local'
export { LocalAi } from './local-plugin'
export { LOCAL_MODEL_NAME, LOCAL_MODEL_SIZE_BYTES } from './types'

export interface ResolveOptions extends OpenRouterSettings {
  aiProvider: AiProviderId
}

function openRouter(settings: OpenRouterSettings): OpenRouterProvider {
  return new OpenRouterProvider(settings)
}

async function withAutoFallback<T>(
  settings: ResolveOptions,
  run: (kind: 'local' | 'openrouter', provider: LocalProvider | OpenRouterProvider) => Promise<T>,
): Promise<T> {
  const local = new LocalProvider()
  const cloud = openRouter(settings)

  if (settings.aiProvider === 'local') {
    return run('local', local)
  }
  if (settings.aiProvider === 'openrouter') {
    return run('openrouter', cloud)
  }

  if (await local.isAvailable()) {
    try {
      return await run('local', local)
    } catch (err) {
      if (!(await cloud.isAvailable())) throw err
      return run('openrouter', cloud)
    }
  }
  return run('openrouter', cloud)
}

export async function parseText(settings: ResolveOptions, input: string): Promise<ParseResult> {
  return withAutoFallback(settings, (_kind, provider) => provider.parseText(input))
}

export async function parseImage(
  settings: ResolveOptions,
  imageDataUrl: string,
  hint?: string,
): Promise<ParseResult> {
  return withAutoFallback(settings, (_kind, provider) => provider.parseImage(imageDataUrl, hint))
}

export async function writeMonthlyInsight(
  settings: ResolveOptions,
  summary: MonthInsightInput,
): Promise<string> {
  return withAutoFallback(settings, (kind, provider) => {
    if (kind === 'local') {
      // Local monthly insight is not implemented yet; prefer OpenRouter in auto mode.
      if (settings.aiProvider === 'auto') return openRouter(settings).monthlyInsight(summary)
    }
    return provider.monthlyInsight(summary)
  })
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

// Kept so existing call sites can be updated gradually.
export { OpenRouterProvider } from './openrouter'
