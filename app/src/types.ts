export type TxType = '支出' | '收入'

export interface Transaction {
  id: string
  date: string
  amount: number
  category: string
  account: string
  note: string
  type: TxType
  createdAt: string
  rowNumber?: number
}

export interface DraftTransaction {
  date: string
  amount: number
  category: string
  account: string
  note: string
  type: TxType
}

export interface ReviewSource {
  kind: 'manual' | 'ai-text' | 'voice' | 'photo'
  modelUsed?: string
  eventId?: string
}

export interface PendingBatch {
  id: string
  book: string
  source: ReviewSource['kind']
  modelUsed?: string
  drafts: DraftTransaction[]
  submitted?: true
}

export interface UserProfile {
  email: string
  name: string
  imageUrl: string
}

export interface AppSettings {
  openRouterKey: string
  model: string
  spreadsheetId: string
  spreadsheetUrl: string
}
