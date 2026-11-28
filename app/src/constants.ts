export const APP_NAME = '記帳'
export const SPREADSHEET_TITLE = 'ji-zhang 記帳'
export const SHEET_NAME = '交易'

export const HEADERS = [
  '日期',
  '金額',
  '類別',
  '帳戶/付款方式',
  '備註',
  '類型',
  '建立時間',
  'id',
] as const

/** Hardcoded last-resort IDs if the OpenRouter catalog cannot be fetched. */
export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free'
export const FALLBACK_MODEL = 'inclusionai/ling-3.2-flash:free'

/** Preferred free models, tried first when auto-pick is on (text). */
export const PREFERRED_FREE_TEXT_MODELS = [
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  'baidu/ernie-5.5-flash-preview:free',
  'google/gemma-4-31b-it:free',
] as const

/** Preferred free models, tried first when auto-pick is on (vision / receipts). */
export const PREFERRED_FREE_VISION_MODELS = [
  DEFAULT_MODEL,
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
] as const

export const EXPENSE_CATEGORIES = [
  '餐飲',
  '交通',
  '購物',
  '居住',
  '娛樂',
  '醫療',
  '教育',
  '日常',
  '其他',
] as const

export const INCOME_CATEGORIES = ['薪水', '獎金', '投資', '退款', '其他'] as const

export const ACCOUNTS = ['現金', '信用卡', '金融卡', '行動支付', '轉帳', '其他'] as const

export const GOOGLE_SCOPES = [
  'email',
  'profile',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
]

export const TIME_ZONE = 'Asia/Taipei'

export const WEB_CLIENT_ID = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || '').trim()

export function isGoogleConfigured(): boolean {
  return WEB_CLIENT_ID.length > 0
}
