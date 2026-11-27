import type { DraftTransaction, ReviewSource } from './types'

export function validReviewDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false
  const time = Date.parse(date)
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(date)
}

export function validReviewAmount(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0
}

export function missingDraftFields(draft: DraftTransaction, source?: ReviewSource['kind']): string[] {
  const missing: string[] = []
  if (!validReviewDate(draft.date)) missing.push('日期')
  if (!validReviewAmount(draft.amount)) missing.push('TWD 金額')
  if ((source === 'photo' || source === 'invoice' || source === 'mail-invoice' || source === 'mail-card') && !draft.note.trim()) missing.push('商家（備註）')
  return missing
}

// The current ledger is TWD-only. Notes are our only merchant/description field.
// Equal keys are hints, not transaction identities.
export function similarTransactionKey(draft: DraftTransaction): string {
  const note = draft.note.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  if (!note || !validReviewDate(draft.date) || !validReviewAmount(draft.amount)) return ''
  return JSON.stringify([draft.date, draft.amount, draft.type, note])
}
