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
