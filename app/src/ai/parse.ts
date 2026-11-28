import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants'
import { validReviewDate, validReviewAmount } from '../review'
import { addDaysISO } from '../dates'
import type { DraftTransaction } from '../types'

export function textSystemPrompt(today: string): string {
  return `你是記帳助手。使用者會用繁體中文說出一筆或多筆收支（例如「午餐 120 信用卡」「昨天晚餐 350 搭車 180」）。
今天是 ${today}（Asia/Taipei）。「昨天」「前天」「上週五」等相對日期請換算成 YYYY-MM-DD。
請只輸出一個 JSON 物件，格式如下：
{"transactions":[{"date":"YYYY-MM-DD","amount":120,"currency":"TWD","category":"餐飲","account":"信用卡","note":"午餐","type":"支出"}]}
規則：
- type 只能是「支出」或「收入」。沒說就是支出。
- amount 為正整數；無法確認時填 null，未提到日期時留空。外幣保留原幣別，不換算。同一句裡的多筆都要拆出來。
- category 支出優先從：${EXPENSE_CATEGORIES.join('、')}；收入優先從：${INCOME_CATEGORIES.join('、')}。無法判斷時用「其他」。
- account 常見值：現金、信用卡、金融卡、行動支付、轉帳、其他。沒提到就留空字串。
- note 用簡短中文（例如「午餐」），不要重複金額。
- 不要輸出註解或 markdown。`
}

export function visionSystemPrompt(today: string): string {
  return `你是記帳助手。使用者會提供收據、發票或台灣電子發票的照片，也可能加上一句補充文字。
今天是 ${today}（Asia/Taipei）。
請辨識照片中的消費，只輸出一個 JSON 物件，格式如下：
{"transactions":[{"date":"YYYY-MM-DD","amount":120,"currency":"TWD","category":"餐飲","account":"","note":"店名","type":"支出"}]}
規則：
- type 只能是「支出」或「收入」。收據預設是支出。
- amount 用總計（含稅），正數，不要貨幣符號。金額不清楚填 null，日期不清楚留空。外幣保留原幣別，不換算。
- 若有清楚的分項且各有金額，可以拆成多筆；否則記一筆總額，note 寫店名或品項摘要。
- 台灣電子發票請把店名寫在 note，日期用發票上的日期（民國年請換成西元 YYYY-MM-DD）。
- category 支出優先從：${EXPENSE_CATEGORIES.join('、')}；收入優先從：${INCOME_CATEGORIES.join('、')}。無法判斷時用「其他」。
- account 常見值：現金、信用卡、金融卡、行動支付、轉帳、其他。看不出來就留空字串。
- 不要輸出註解或 markdown。`
}

export function extractJson(text: string): unknown {
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

export function normalizeTx(value: unknown, today: string): DraftTransaction | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const amount = typeof raw.amount === 'number' || typeof raw.amount === 'string' ? Number(raw.amount) : 0
  const currency = String(raw.currency ?? '').trim().toUpperCase()
  const note = String(raw.note ?? '').trim()
  let date = String(raw.date ?? '').trim()
  if (date === '今天') date = today
  if (date === '昨天') date = addDaysISO(today, -1)
  if (date === '前天') date = addDaysISO(today, -2)
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(date)) {
    const [y, m, d] = date.split('/')
    date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (!validReviewDate(date)) date = ''
  const hasAmount = validReviewAmount(amount)
  if (!hasAmount && !date && !note) return null
  return {
    date,
    amount: hasAmount && (!currency || currency === 'TWD') ? amount : 0,
    category: String(raw.category ?? '其他').trim() || '其他',
    account: String(raw.account ?? '').trim(),
    note,
    type: String(raw.type ?? '').trim() === '收入' ? '收入' : '支出',
  }
}

export function draftsFromModelText(content: string, today: string): DraftTransaction[] {
  const parsed = extractJson(content) as { transactions?: Record<string, unknown>[] }
  const list = Array.isArray(parsed.transactions) ? parsed.transactions : []
  const transactions = list
    .map((item) => normalizeTx(item, today))
    .filter((t): t is DraftTransaction => t !== null)
  if (transactions.length === 0) {
    throw new Error('AI 沒有解析出任何一筆帳，請改一下說法或改用手動記帳。')
  }
  return transactions
}

export async function resizeImageDataUrl(
  dataUrl: string,
  maxEdge = 1560,
  quality = 0.85,
): Promise<string> {
  if (!dataUrl.startsWith('data:image/')) return dataUrl
  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && blob.size <= 1_200_000) return dataUrl
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(bitmap, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}
