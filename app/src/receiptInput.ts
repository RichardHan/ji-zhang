import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { shallowRef } from 'vue'
import type { InvoiceInput } from './invoice'

export interface InvoiceShare { text?: string; error?: string }
export const sharedInvoice = shallowRef<InvoiceShare>()
export const nativeReceipts = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReceiptPhoto')
export const receiptPlugin = registerPlugin<{
  select(options: { camera: boolean }): Promise<{ preview?: string; text?: string } | undefined>
  select(options: { invoice: true; camera: boolean }): Promise<InvoiceInput | undefined>
  addListener(name: 'sharedInvoice', callback: (share: InvoiceShare) => void): Promise<PluginListenerHandle>
}>('ReceiptPhoto')
