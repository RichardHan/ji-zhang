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

export const DEFAULT_MODEL = 'google/gemma-4-26b-a4b-it:free'
export const FALLBACK_MODEL = 'inclusionai/ling-3.2-flash:free'

export const FREE_MODELS: { id: string; label: string }[] = [
  { id: DEFAULT_MODEL, label: 'Gemma 4 26B（預設，免費）' },
  { id: FALLBACK_MODEL, label: 'Ling 3.2 Flash（備用，免費）' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B（免費）' },
  { id: 'baidu/ernie-5.5-flash-preview:free', label: 'ERNIE 5.5 Flash（免費，中文）' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano Omni（免費）' },
]

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
