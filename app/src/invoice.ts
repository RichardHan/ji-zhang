import { receiptDraft } from './receipt'
import { validReviewDate } from './review'
import type { DraftTransaction } from './types'

export interface InvoiceInput { text?: string; codes?: string[] }
export interface InvoiceCandidate { number: string; draft: DraftTransaction }

// Ministry of Finance proof-of-purchase format, fixed 77-character left QR header.
const leftHeader = /^([A-Z]{2}\d{8})(\d{3})(\d{2})(\d{2})\d{4}[0-9A-Fa-f]{8}([0-9A-Fa-f]{8})\d{16}[A-Za-z0-9+/]{22}==(?=:|$)/
const printedNumber = /(?<![A-Za-z\d])([A-Z]{2})[-\s]?(\d{8})(?![A-Za-z\d])/gi

export function invoiceCandidate({ text = '', codes = [] }: InvoiceInput): InvoiceCandidate {
  const lines = text.trim().split(/\r?\n/)
  const printed: string[] = []
  const payloads = new Set(codes)
  for (const line of lines) {
    if (/^(?:[A-Z]{2}\d{15}|\*\*)/.test(line.trim())) payloads.add(line.trim())
    else printed.push(line)
  }
  const receipts = [...payloads].map(value => value.match(leftHeader)).filter(match => match !== null)
  const plain = printed.join('\n').normalize('NFKC').trim()
  const numbers = new Set(Array.from(plain.matchAll(printedNumber), match => (match[1] + match[2]).toUpperCase()))
  for (const match of receipts) numbers.add(match[1])
  if (numbers.size > 1 || receipts.length > 1) throw new Error('找到多張發票，請一次匯入一張。')
  const draft = receiptDraft(plain)
  if (/^(?:https?:\/\/|[A-Z]{2}[-\s]?\d{8}$)/i.test(draft.note)) draft.note = ''
  if (receipts.length) {
    const [, , year, month, day, total] = receipts[0]
    const date = [Number(year) + 1911, month, day].join('-')
    if (!validReviewDate(date)) throw new Error('發票 QR Code 日期無效，請重新掃描。')
    draft.date = date
    draft.amount = parseInt(total, 16)
  } else if (payloads.size && !numbers.size && !draft.date && !draft.amount) {
    throw new Error('請拍攝包含左側 QR Code 的電子發票。')
  } else if (!numbers.size && !draft.date && !draft.amount && !draft.note) {
    throw new Error('找不到收據欄位，請選取另一份檔案或貼上收據文字。')
  }
  return { number: [...numbers][0] ?? '', draft }
}

// Invoice tracks can be reused in a different two-month issue period.
export function invoiceEventId(number: string, date: string): string | undefined {
  if (!number) return undefined
  const period = Math.ceil(Number(date.slice(5, 7)) / 2)
  return [date.slice(0, 4), period, number].join('/')
}
