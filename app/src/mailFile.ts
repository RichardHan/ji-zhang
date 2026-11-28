import PostalMime, { type Attachment } from 'postal-mime'
import { receiptPlugin } from './receiptInput'
import type { InvoiceInput } from './invoice'

export interface SelectedMail { text: string; subject: string; id?: string; attachments: Attachment[] }

function htmlText(html: string): string {
  // Template contents remain inert: no remote images, CSS or scripts are loaded.
  const template = document.createElement('template')
  template.innerHTML = html
  const root = template.content
  root.querySelectorAll('script,style,head,blockquote').forEach(node => node.remove())
  root.querySelectorAll('br,p,div,tr,li,h1,h2,h3').forEach(node => node.after('\n'))
  root.querySelectorAll('td,th').forEach(node => node.after(' '))
  return root.textContent ?? ''
}

export async function readMailFile(file: File): Promise<SelectedMail> {
  if (file.size > 12 * 1024 * 1024) throw new Error('郵件超過 12 MB，請分享內文或另選較小的郵件。')
  if (/\.txt$/i.test(file.name)) return { text: await file.text(), subject: '', attachments: [] }
  const mail = await PostalMime.parse(await file.arrayBuffer(), { forceRfc822Attachments: true, attachmentEncoding: 'base64' })
  return { text: mail.text?.trim() || htmlText(mail.html ?? ''), subject: mail.subject ?? '', id: mail.messageId,
    attachments: mail.attachments.filter(a => a.mimeType === 'application/pdf' || a.mimeType === 'text/plain' || a.mimeType.startsWith('image/')) }
}

export async function readMailAttachment(part: Attachment): Promise<InvoiceInput> {
  if (typeof part.content !== 'string') throw new Error('附件格式無法讀取。')
  if (part.mimeType === 'text/plain') {
    const bytes = Uint8Array.from(atob(part.content), c => c.charCodeAt(0))
    return { text: new TextDecoder().decode(bytes) }
  }
  return receiptPlugin.readMailAttachment({ data: part.content, mimeType: part.mimeType })
}
