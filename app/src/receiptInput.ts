import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { shallowRef } from 'vue'
import type { InvoiceInput } from './invoice'

export interface InvoiceShare { mail?: boolean; eml?: string; subject?: string; text?: string; error?: string }
export const sharedInvoice = shallowRef<InvoiceShare>()
export const sharedMail = shallowRef<InvoiceShare>()
export const nativeReceipts = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReceiptPhoto')
export const receiptPlugin = registerPlugin<{
  select(options: { camera: boolean }): Promise<{ preview?: string; text?: string } | undefined>
  select(options: { invoice: true; camera: boolean }): Promise<InvoiceInput | undefined>
  readMailAttachment(options: { data: string; mimeType: string }): Promise<InvoiceInput>
  addListener(name: 'sharedInvoice', callback: (share: InvoiceShare) => void): Promise<PluginListenerHandle>
}>('ReceiptPhoto')
