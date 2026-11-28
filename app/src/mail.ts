import { invoiceCandidate, type InvoiceInput } from './invoice'
import { validReviewAmount, validReviewDate } from './review'
import type { DraftTransaction } from './types'

export type MailKind = 'bill' | 'invoice' | 'card'
type CardAction = 'purchase' | 'refund' | 'cancel' | 'declined'
export interface MailResult {
  kind: MailKind
  period?: string
  due?: string
  money: string
  time?: string
  action?: CardAction
  number?: string
  draft?: DraftTransaction
}

const statement = /信用卡(?:電子|月結)?帳單|信用卡對帳單|月結(?:帳單|單)|本期應繳|最低應繳|繳款截止|amount due|billing statement|monthly statement|balance due/i
const card = /刷卡|信用卡(?:消費|交易|退款|退刷|取消)|消費通知|交易通知|card (?:purchase|transaction|refund|alert)|transaction alert|purchase alert/i

export function isMailShare(text: string, subject = ''): boolean {
  return !!subject || /^(?:from|subject|主旨|寄件者)\s*[:：]/im.test(text) || statement.test(text) || card.test(text)
}

function labeled(text: string, labels: string): string {
  return text.match(new RegExp('^(?:' + labels + ')\\s*[:：]\\s*([^\\n]+)', 'im'))?.[1].trim() ?? ''
}

function dateIn(text: string): string {
  const parts = text.match(/(?<!\d)(\d{4}|\d{3})[./年-](\d{1,2})[./月-](\d{1,2})(?!\d)/)
  if (!parts) return ''
  const year = Number(parts[1]) + (parts[1].length === 3 ? 1911 : 0)
  const date = [year, parts[2].padStart(2, '0'), parts[3].padStart(2, '0')].join('-')
  return validReviewDate(date) ? date : ''
}

function mailAmount(value: string, declared: string) {
  const match = value.trim().match(/^(.*?)\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([^\d]*)$/)
  if (!match) return { display: '', twd: 0 }
  const amount = Math.abs(Number(match[2].replaceAll(',', '')))
  const symbol = (match[1] + match[3]).trim().replace(/元$/, '')
  const currency = (symbol === '$' && declared ? declared : symbol) || declared
  const twd = /^(?:TWD|NTD|NT\$|新台幣|新臺幣|台幣|臺幣)$/i.test(currency)
  return { display: [currency, match[2]].filter(Boolean).join(' '), twd: twd && validReviewAmount(amount) ? amount : 0 }
}

export function parseMail(body: string, subject = '', attachment?: InvoiceInput): MailResult {
  const text = body.normalize('NFKC').replace(/\r\n?/g, '\n').trim()
  const title = subject || labeled(text, 'Subject|主旨') || text.split('\n')[0] || ''
  const content = title + '\n' + text
  const proseDate = text.match(/(?:於|on)\s*(\d{3,4}[./年-]\d{1,2}[./月-]\d{1,2}日?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/i)?.[1] ?? ''
  const currency = labeled(text, '幣別|交易幣別|原幣幣別|currency')
  // Statements may include itemized purchases, refunds and invoice numbers.
  if (statement.test(title) || /帳單|對帳單|電費通知|水費通知|繳費通知|bill\b/i.test(title)
    || (!card.test(title) && !/發票|invoice/i.test(title) && statement.test(text))) {
    const dueAmount = labeled(text, '(?:本期)?(?:應繳|應付)(?:總)?金額|本期應繳|amount due|balance due|total due')
    return { kind: 'bill', period: labeled(text, '帳單期間|帳單月份|帳期|計費期間|billing period|statement period'),
      due: dateIn(labeled(text, '繳款截止日?|繳費期限|繳款期限|到期日|due date|payment due date')),
      money: mailAmount(dueAmount, currency).display }
  }
  if (card.test(title) || (!/發票|invoice/i.test(title) && card.test(text))) {
    const eventLine = text.match(/^(?:本筆|本次|此筆)?(?:刷卡|信用卡)?交易(?:已|遭|未)(?:取消|撤銷|核准|退款|拒絕|失敗).*$/m)?.[0] ?? ''
    const status = [title, eventLine, labeled(text, '交易類型|交易類別|交易狀態|交易結果|transaction type|status')].join(' ')
    const action: CardAction = /失敗|拒絕|未核准|declined|unsuccessful/i.test(status) ? 'declined'
      : /取消|撤銷|沖正|void|revers|cancel/i.test(status) ? 'cancel'
      : /退款|退刷|退貨|refund/i.test(status) ? 'refund' : 'purchase'
    const datetime = labeled(text, '交易(?:日期時間|時間|日期)|消費(?:時間|日期)|transaction (?:date(?:time)?|time)|date') || proseDate
    const clock = (labeled(text, '交易時間|消費時間|transaction time|time') || datetime).match(/\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/)?.[0]
    const date = dateIn(datetime) || dateIn(labeled(text, '交易日期|消費日期|transaction date|date'))
    const proseAmount = text.match(/(?:刷卡|消費|退款)(?:金額)?\s*(?:為|計)?\s*((?:NT\$|TWD|NTD|USD|JPY|HKD|新[臺台]幣|[臺台]幣|美元|日圓)\s*[\d,]+(?:\.\d+)?)/i)?.[1] ?? ''
    const amount = mailAmount(labeled(text, '(?:交易|消費|刷卡|退款|原幣)金額|金額|(?:transaction |refund )?amount') || proseAmount, currency)
    const merchant = labeled(text, '特店名稱|消費地點|交易商店|商店名稱|商家(?:名稱)?|merchant(?: name)?')
      || text.match(/(?:於|在)\s*([^\n，,。]{1,60}?)\s*(?:刷卡|消費)(?=金額|\s|新[臺台]幣|NT\$|TWD|USD)/i)?.[1]?.replace(/^.*?\s(?:於|在)/, '').trim() || ''
    return { kind: 'card', money: amount.display, time: clock, action,
      draft: action === 'cancel' || action === 'declined' ? undefined : {
        date, amount: amount.twd, note: merchant, account: '信用卡', category: action === 'refund' ? '退款' : '其他',
        type: action === 'refund' ? '收入' : '支出',
      } }
  }
  if (attachment || /發票|invoice/i.test(content)) {
    const input = attachment ?? { text: text.split('\n').filter(line => !/^(subject|from|to|主旨|寄件者|收件者)\s*[:：]/i.test(line)).join('\n') }
    const candidate = invoiceCandidate(input)
    if (/請查收|詳見附件|請參閱|親愛的|您好|^dear\b|\battached\b/i.test(candidate.draft.note)) candidate.draft.note = ''
    return { kind: 'invoice', number: candidate.number, draft: candidate.draft, money: '' }
  }
  throw new Error('未辨識到帳單、發票或刷卡通知。可選擇發票附件，或貼上含主旨與交易欄位的郵件。')
}
