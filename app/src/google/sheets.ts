import { HEADERS, SHEET_NAME, SPREADSHEET_TITLE } from '../constants'
import { nowISO } from '../dates'
import type { DraftTransaction, Transaction, TxType } from '../types'
import { getAccessToken, refreshAccessToken } from './auth'

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'

export function parseSpreadsheetId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const fromUrl = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (fromUrl) return fromUrl[1]
  if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw
  return null
}

export function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`
}

async function api<T>(
  path: string,
  init: RequestInit = {},
  retried = false,
): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  if (res.status === 401 && !retried) {
    await refreshAccessToken(true)
    return api<T>(path, init, true)
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body.error?.message ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(detail || `Google Sheets 請求失敗（${res.status}）`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

interface SpreadsheetResource {
  spreadsheetId: string
  spreadsheetUrl?: string
  properties?: { title?: string }
  sheets?: { properties?: { title?: string; sheetId?: number } }[]
}

export async function createSpreadsheet(): Promise<{ id: string; url: string }> {
  const created = await api<SpreadsheetResource>(SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SPREADSHEET_TITLE, locale: 'zh_TW', timeZone: 'Asia/Taipei' },
      sheets: [
        {
          properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } },
        },
      ],
    }),
  })
  await api(
    `${SHEETS}/${created.spreadsheetId}/values/${encodeURIComponent(SHEET_NAME + '!A1:H1')}?valueInputOption=RAW`,
    {
      method: 'PUT',
      body: JSON.stringify({ values: [HEADERS] }),
    },
  )
  return { id: created.spreadsheetId, url: created.spreadsheetUrl || spreadsheetUrl(created.spreadsheetId) }
}

export async function ensureSheet(spreadsheetId: string): Promise<void> {
  const meta = await api<SpreadsheetResource>(
    `${SHEETS}/${spreadsheetId}?fields=sheets.properties.title,sheets.properties.sheetId,properties.title`,
  )
  const hasSheet = (meta.sheets || []).some((s) => s.properties?.title === SHEET_NAME)
  if (!hasSheet) {
    await api(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } },
            },
          },
        ],
      }),
    })
  }
  const header = await api<{ values?: string[][] }>(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME + '!A1:H1')}`,
  )
  const current = header.values?.[0] ?? []
  const matches = HEADERS.every((h, i) => (current[i] || '').trim() === h)
  if (!matches) {
    await api(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME + '!A1:H1')}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: [HEADERS] }),
      },
    )
  }
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value
  const n = Number(String(value ?? '').replace(/[,元$NTDTwd\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function parseType(value: unknown): TxType {
  const s = String(value ?? '').trim()
  return s === '收入' ? '收入' : '支出'
}

function parseDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Google Sheets serial date (days since 1899-12-30)
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
    const y = utc.getUTCFullYear()
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0')
    const d = String(utc.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const s = String(value ?? '').trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const slash = s.match(/^(\d{4})[\/年](\d{1,2})[\/月](\d{1,2})/)
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`
  }
  return s
}

function rowToTx(row: unknown[], index: number): Transaction | null {
  const id = String(row[7] ?? '').trim()
  const date = String(row[0] ?? '').trim()
  const amount = parseAmount(row[1])
  if (!id && !date && !amount) return null
  return {
    id: id || `row-${index + 2}`,
    date,
    amount,
    category: String(row[2] ?? '').trim(),
    account: String(row[3] ?? '').trim(),
    note: String(row[4] ?? '').trim(),
    type: parseType(row[5]),
    createdAt: String(row[6] ?? '').trim(),
    rowNumber: index + 2,
  }
}

export async function listTransactions(spreadsheetId: string): Promise<Transaction[]> {
  const data = await api<{ values?: unknown[][] }>(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME + '!A2:H')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  )
  const rows = data.values ?? []
  const result: Transaction[] = []
  rows.forEach((row, i) => {
    const tx = rowToTx(row, i)
    if (tx) result.push(tx)
  })
  result.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1
    return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1
  })
  return result
}

function toRow(tx: DraftTransaction & { id: string; createdAt: string }): (string | number)[] {
  return [tx.date, tx.amount, tx.category, tx.account, tx.note, tx.type, tx.createdAt, tx.id]
}

export async function appendTransactions(
  spreadsheetId: string,
  drafts: DraftTransaction[],
): Promise<Transaction[]> {
  const created: Transaction[] = drafts.map((d) => ({
    ...d,
    id: crypto.randomUUID(),
    createdAt: nowISO(),
  }))
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(SHEET_NAME + '!A:H')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      body: JSON.stringify({ values: created.map((t) => toRow(t)) }),
    },
  )
  return created
}

export async function updateTransaction(
  spreadsheetId: string,
  tx: Transaction,
): Promise<void> {
  if (!tx.rowNumber) {
    throw new Error('找不到這筆記錄在試算表中的列，請重新整理後再試。')
  }
  const range = `${SHEET_NAME}!A${tx.rowNumber}:H${tx.rowNumber}`
  await api(
    `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [toRow({ ...tx, createdAt: tx.createdAt || nowISO() })],
      }),
    },
  )
}

async function sheetIdOf(spreadsheetId: string): Promise<number> {
  const meta = await api<SpreadsheetResource>(
    `${SHEETS}/${spreadsheetId}?fields=sheets.properties.title,sheets.properties.sheetId`,
  )
  const sheet = (meta.sheets || []).find((s) => s.properties?.title === SHEET_NAME)
  const id = sheet?.properties?.sheetId
  if (id === undefined) throw new Error(`找不到工作表「${SHEET_NAME}」`)
  return id
}

export async function deleteTransaction(spreadsheetId: string, tx: Transaction): Promise<void> {
  if (!tx.rowNumber) {
    throw new Error('找不到這筆記錄在試算表中的列，請重新整理後再試。')
  }
  const sid = await sheetIdOf(spreadsheetId)
  await api(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sid,
              dimension: 'ROWS',
              startIndex: tx.rowNumber - 1,
              endIndex: tx.rowNumber,
            },
          },
        },
      ],
    }),
  })
}
