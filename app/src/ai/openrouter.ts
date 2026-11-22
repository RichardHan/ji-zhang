import { DEFAULT_MODEL, EXPENSE_CATEGORIES, FALLBACK_MODEL, INCOME_CATEGORIES } from '../constants'
import { addDaysISO, todayISO } from '../dates'
import type { DraftTransaction, TxType } from '../types'

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions'

export interface ParseResult {
  transactions: DraftTransaction[]
  modelUsed: string
}

function systemPrompt(today: string): string {
  return `你是記帳助手。使用者會用繁體中文說出一筆或多筆收支（例如「午餐 120 信用卡」「昨天晚餐 350 搭車 180」）。
今天是 ${today}（Asia/Taipei）。「昨天」「前天」「上週五」等相對日期請換算成 YYYY-MM-DD。
請只輸出一個 JSON 物件，格式如下：
{"transactions":[{"date":"YYYY-MM-DD","amount":120,"category":"餐飲","account":"信用卡","note":"午餐","type":"支出"}]}
規則：
- type 只能是「支出」或「收入」。沒說就是支出。
- amount 是正數數字，不要貨幣符號。同一句裡的多筆都要拆出來。
- category 支出優先從：${EXPENSE_CATEGORIES.join('、')}；收入優先從：${INCOME_CATEGORIES.join('、')}。無法判斷時用「其他」。
- account 常見值：現金、信用卡、金融卡、行動支付、轉帳、其他。沒提到就留空字串。
- note 用簡短中文（例如「午餐」），不要重複金額。
- 不要輸出註解或 markdown。`
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI 回傳的內容不是 JSON')
  }
  return JSON.parse(raw.slice(start, end + 1))
}

function normalizeTx(raw: Record<string, unknown>, today: string): DraftTransaction | null {
  const amount = Number(raw.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  let date = String(raw.date ?? today).trim()
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(date)) {
    const [y, m, d] = date.split('/')
    date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today
  const type: TxType = String(raw.type ?? '').trim() === '收入' ? '收入' : '支出'
  return {
    date,
    amount: Math.round(amount),
    category: String(raw.category ?? '其他').trim() || '其他',
    account: String(raw.account ?? '').trim(),
    note: String(raw.note ?? '').trim(),
    type,
  }
}

async function complete(
  apiKey: string,
  model: string,
  userText: string,
  today: string,
  useJsonFormat: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt(today) },
      { role: 'user', content: userText },
    ],
    temperature: 0.2,
    max_tokens: 1200,
  }
  if (useJsonFormat) {
    body.response_format = { type: 'json_object' }
  }
  const res = await fetch(OPENROUTER, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    const error = new Error(detail || `OpenRouter 請求失敗（${res.status}）`) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return data.choices?.[0]?.message?.content ?? ''
}

async function tryModel(apiKey: string, model: string, userText: string, today: string): Promise<string> {
  try {
    return await complete(apiKey, model, userText, today, true)
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status && status >= 400 && status < 500 && status !== 429) {
      return await complete(apiKey, model, userText, today, false)
    }
    throw err
  }
}

export async function parseTransactionsWithAI(
  apiKey: string,
  preferredModel: string,
  userText: string,
): Promise<ParseResult> {
  if (!apiKey.trim()) {
    throw new Error('請先在設定裡填入 OpenRouter API 金鑰。')
  }
  const text = userText.trim()
  if (!text) {
    throw new Error('請先輸入要記的內容，例如「午餐 120 信用卡」。')
  }
  const today = todayISO()
  const primary = preferredModel.trim() || DEFAULT_MODEL
  const models: string[] = []
  for (const id of [primary, FALLBACK_MODEL, DEFAULT_MODEL]) {
    if (!models.includes(id)) models.push(id)
  }

  let lastError: Error | null = null
  for (const model of models) {
    try {
      const content = await tryModel(apiKey, model, text, today)
      const parsed = extractJson(content) as { transactions?: Record<string, unknown>[] }
      const list = Array.isArray(parsed.transactions) ? parsed.transactions : []
      const transactions = list
        .map((item) => normalizeTx(item, today))
        .filter((t): t is DraftTransaction => t !== null)
      if (transactions.length === 0) {
        throw new Error('AI 沒有解析出任何一筆帳，請改一下說法或改用手動記帳。')
      }
      for (const t of transactions) {
        if (t.date === '昨天') t.date = addDaysISO(today, -1)
        if (t.date === '前天') t.date = addDaysISO(today, -2)
      }
      return { transactions, modelUsed: model }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('AI 解析失敗')
}

export async function monthlyInsight(
  apiKey: string,
  model: string,
  summary: {
    month: string
    income: number
    expense: number
    byCategory: { category: string; amount: number }[]
  },
): Promise<string> {
  if (!apiKey.trim()) {
    throw new Error('請先在設定裡填入 OpenRouter API 金鑰。')
  }
  const lines = summary.byCategory
    .map((c) => `${c.category} ${Math.round(c.amount)} 元`)
    .join('、')
  const prompt = `用繁體中文寫一段不超过 80 字的記帳觀察，語氣平實、不要標題。資料：${summary.month} 支出 ${Math.round(summary.expense)} 元，收入 ${Math.round(summary.income)} 元。支出分類：${lines || '無'}。不要建議投資商品。`
  const primary = model.trim() || DEFAULT_MODEL
  const models = primary === FALLBACK_MODEL ? [primary, DEFAULT_MODEL] : [primary, FALLBACK_MODEL]
  let lastError: Error | null = null
  for (const m of models) {
    try {
      const content = await complete(apiKey, m, prompt, todayISO(), false)
      const text = content.trim().replace(/^```[\s\S]*?```$/g, '').trim()
      if (text) return text
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('無法產生分析')
}
