import { validReviewAmount, validReviewDate } from './review'
import type { DraftTransaction } from './types'

export function receiptDraft(text: string): DraftTransaction {
  const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const dates = new Set<string>()
  const paid = new Set<number>()
  const totals = new Set<number>()
  let merchant = ''
  for (const line of lines) {
    for (const match of line.matchAll(/(?<!\d)(\d{4}|\d{3})[-/.年](\d{1,2})[-/.月](\d{1,2})(?!\d)/g)) {
      const year = Number(match[1]) + (match[1].length === 3 ? 1911 : 0)
      const date = [year, match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-')
      if (validReviewDate(date)) dates.add(date)
    }
    const label = line.match(/^(商家|店名|商店名稱|merchant)\s*[:：]\s*(.+)$/i)
    if (label) merchant = label[2].trim()
    // Exact labels exclude subtotals, tendered cash, change and item prices.
    const amount = line.replace(/\s+/g, '').match(/^(實付(?:金額)?|應付(?:金額)?|amountpaid|合計|總計|總額|grandtotal|total)[:：]?(?:NT\$|TWD|NTD|\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.00)?(?:元)?$/i)
    if (amount) {
      const value = Number(amount[2].replaceAll(',', ''))
      if (validReviewAmount(value)) {
        if (/^(實付|amountpaid)/i.test(amount[1])) paid.add(value)
        else totals.add(value)
      }
    }
  }
  if (!merchant) {
    // Use a plausible shop header only; unreadable headers remain editable.
    const header = lines[0] ?? ''
    if (/[\p{L}]/u.test(header) && header.length <= 70
      && !/[\d:：$]|收據|發票|交易|明細|合計|總計|金額|日期|地址|電話|receipt|invoice|total|paid|date/i.test(header)) merchant = header
  }
  const amounts = paid.size ? paid : totals
  const foreignCurrency = /(?:\b(?:USD|JPY|CNY|RMB|EUR|HKD|KRW|GBP|AUD|CAD|THB|SGD)\b|US\$|HK\$|[€¥£￥₩]|美元|日圓|日元|人民幣|港幣|歐元)/i.test(text.normalize('NFKC'))
  return {
    date: dates.size === 1 ? [...dates][0] : '',
    amount: !foreignCurrency && amounts.size === 1 ? [...amounts][0] : 0,
    note: merchant, account: '', category: '其他', type: '支出',
  }
}
