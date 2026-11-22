import { TIME_ZONE } from './constants'

function partsInZone(date: Date, timeZone = TIME_ZONE): { y: string; m: string; d: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  )
  return { y: parts.year, m: parts.month, d: parts.day }
}

export function todayISO(timeZone = TIME_ZONE): string {
  const { y, m, d } = partsInZone(new Date(), timeZone)
  return `${y}-${m}-${d}`
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function currentMonth(): string {
  return monthKey(todayISO())
}

export function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-')
  return `${y} 年 ${Number(m)} 月`
}

export function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${Number(m)}/${Number(d)}`
}

export function formatTWD(amount: number): string {
  const rounded = Math.round(amount)
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(rounded)
}

export function formatTWDPlain(amount: number): string {
  return new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(amount))
}
