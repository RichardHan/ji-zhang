import {
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  PREFERRED_FREE_TEXT_MODELS,
  PREFERRED_FREE_VISION_MODELS,
} from '../constants'
import { storage } from '../storage'

const MODELS_URL = 'https://openrouter.ai/api/v1/models'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

export type ModelKind = 'text' | 'vision'
export type PriceFilter = 'all' | 'free' | 'paid'

export interface CatalogModel {
  id: string
  name: string
  promptPrice: number
  completionPrice: number
  isFree: boolean
  isVision: boolean
  contextLength: number
}

interface RawModel {
  id?: string
  name?: string
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[] }
  context_length?: number
}

export function isFreePricing(id: string, promptPrice: number, completionPrice: number): boolean {
  return id.endsWith(':free') || (promptPrice === 0 && completionPrice === 0)
}

export function parseCatalogModel(raw: RawModel): CatalogModel | null {
  const id = String(raw.id ?? '').trim()
  if (!id) return null
  function price(value?: string): number {
    return value != null && String(value).trim() !== '' ? Number(value) : NaN
  }
  const prompt = price(raw.pricing?.prompt)
  const completion = price(raw.pricing?.completion)
  const modalities = (raw.architecture?.input_modalities ?? []).map((m) => String(m).toLowerCase())
  return {
    id,
    name: String(raw.name ?? id).trim() || id,
    promptPrice: prompt,
    completionPrice: completion,
    isFree: isFreePricing(id, prompt, completion),
    isVision: modalities.includes('image'),
    contextLength: Number(raw.context_length) || 0,
  }
}

export function formatUsdPerMillion(perToken: number): string {
  if (!Number.isFinite(perToken) || perToken < 0) return '價格未提供'
  if (perToken === 0) return '免費'
  const perMillion = perToken * 1_000_000
  if (perMillion < 0.01) return `$${perMillion.toPrecision(2)}`
  if (perMillion < 1) return `$${perMillion.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`
  return `$${perMillion.toFixed(2).replace(/\.00$/, '')}`
}

export function formatModelPrice(model: CatalogModel): string {
  if (model.isFree) return '免費'
  return `輸入 ${formatUsdPerMillion(model.promptPrice)} / 輸出 ${formatUsdPerMillion(model.completionPrice)}（每百萬 token）`
}

export function filterCatalog(
  models: CatalogModel[],
  options: { kind?: ModelKind; price?: PriceFilter; query?: string },
): CatalogModel[] {
  const query = (options.query ?? '').trim().toLowerCase()
  return models.filter((m) => {
    if (options.kind === 'vision' && !m.isVision) return false
    if (options.price === 'free' && !m.isFree) return false
    if (options.price === 'paid' && m.isFree) return false
    if (!query) return true
    return m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)
  })
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export function rankFreeCandidates(models: CatalogModel[], kind: ModelKind): string[] {
  const preferred: string[] =
    kind === 'vision' ? [...PREFERRED_FREE_VISION_MODELS] : [...PREFERRED_FREE_TEXT_MODELS]
  const eligible = models.filter((m) => m.isFree && (kind === 'text' || m.isVision))
  const byId = new Map(eligible.map((m) => [m.id, m]))
  const head = preferred.filter((id) => byId.has(id))
  const rest = eligible
    .map((m) => m.id)
    .filter((id) => !head.includes(id))
    .sort((a, b) => a.localeCompare(b))
  return uniqueIds([...head, ...rest])
}

export function fallbackCandidateIds(kind: ModelKind): string[] {
  const preferred: string[] =
    kind === 'vision' ? [...PREFERRED_FREE_VISION_MODELS] : [...PREFERRED_FREE_TEXT_MODELS]
  return uniqueIds([...preferred, DEFAULT_MODEL, FALLBACK_MODEL])
}

function parseCached(json: string): CatalogModel[] | null {
  try {
    const data = JSON.parse(json) as unknown
    if (!Array.isArray(data)) return null
    const models: CatalogModel[] = []
    for (const item of data) {
      if (!item || typeof item !== 'object') continue
      if ('promptPrice' in item) return null // Older caches lost raw pricing and modalities.
      const parsed = parseCatalogModel(item as RawModel)
      if (parsed) models.push(parsed)
    }
    return models.length ? models : null
  } catch {
    return null
  }
}

async function readCache(): Promise<{ models: CatalogModel[]; cachedAt: number } | null> {
  const json = await storage.getModelsCache()
  const at = Number(await storage.getModelsCacheAt())
  const models = json ? parseCached(json) : null
  if (!models || !Number.isFinite(at)) return null
  return { models, cachedAt: at }
}

async function fetchCatalog(): Promise<CatalogModel[]> {
  const res = await fetch(MODELS_URL, {
    headers: {
      'HTTP-Referer': 'https://github.com/RichardHan/ji-zhang',
      'X-Title': 'ji-zhang',
    },
  })
  if (!res.ok) {
    throw new Error(`無法取得 OpenRouter 模型清單（${res.status}）`)
  }
  const body = (await res.json()) as { data?: RawModel[] }
  const raw = Array.isArray(body.data) ? body.data : []
  const models: CatalogModel[] = []
  for (const item of raw) {
    const parsed = parseCatalogModel(item)
    if (parsed) models.push(parsed)
  }
  if (!models.length) throw new Error('OpenRouter 模型清單是空的。')
  await storage.setModelsCache(JSON.stringify(raw.map(({id, name, pricing, architecture, context_length}) => ({id, name, pricing, architecture, context_length}))), Date.now())
  return models
}

export async function listOpenRouterModels(options?: { force?: boolean }): Promise<CatalogModel[]> {
  const cached = await readCache()
  const fresh = cached && Date.now() - cached.cachedAt < CACHE_TTL_MS
  if (!options?.force && fresh && cached) return cached.models
  try {
    return await fetchCatalog()
  } catch (err) {
    if (cached?.models.length) return cached.models
    throw err instanceof Error ? err : new Error(String(err))
  }
}

export async function resolveModelCandidates(
  kind: ModelKind,
  mode: 'auto-free' | 'manual',
  manualId: string,
): Promise<{ ids: string[]; source: 'catalog' | 'fallback' | 'manual' }> {
  if (mode === 'manual') {
    const id = manualId.trim()
    if (!id) throw new Error(kind === 'vision' ? '請先在設定裡選擇視覺模型。' : '請先在設定裡選擇文字模型。')
    return { ids: [id], source: 'manual' }
  }
  try {
    const models = await listOpenRouterModels()
    const ids = rankFreeCandidates(models, kind)
    if (ids.length) return { ids, source: 'catalog' }
  } catch {
    // Fall through to the hardcoded free list so first-run still works offline.
  }
  return { ids: fallbackCandidateIds(kind), source: 'fallback' }
}

export function findCatalogModel(models: CatalogModel[], id: string): CatalogModel | undefined {
  return models.find((m) => m.id === id)
}
