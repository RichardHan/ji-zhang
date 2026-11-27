import { receiptDraft } from './receipt'
import type { DraftTransaction } from './types'

interface FrameGroup {
  number: string
  merchant: string
  frames: string[]
}

function normalized(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
}

// Multiple views of the same piece of paper are observations of one purchase.
// Distinct printed numbers take precedence over a common merchant or amount.
export function videoDrafts(frames: string[], spoken: DraftTransaction[] = []): DraftTransaction[] {
  const groups: FrameGroup[] = []
  for (const text of new Set(frames)) {
    const draft = receiptDraft(text)
    const id = text.normalize('NFKC').match(/\b([A-Z]{2})[- ]?(\d{8})\b/i)
    const number = id ? (id[1] + id[2]).toUpperCase() : ''
    if (!number && !draft.note && !draft.amount && !draft.date) continue
    const merchant = normalized(draft.note)
    const known = number && groups.find(group => group.number === number)
    const compatible = groups.filter(group => (!number || !group.number || group.number === number)
      && (!merchant || !group.merchant || group.merchant === merchant))
    const group = known || (compatible.length === 1 ? compatible[0] : undefined)
    if (group) {
      group.frames.push(text)
      group.number ||= number
      group.merchant ||= merchant
    } else if (merchant || number || !groups.length) {
      groups.push({ number, merchant, frames: [text] })
    }
  }
  const visual = groups.map(group => {
    const joined = receiptDraft(group.frames.join('\n'))
    joined.note ||= group.frames.map(frame => receiptDraft(frame).note).find(Boolean) ?? ''
    return joined
  })
  const narration = visual.map((): DraftTransaction[] => [])
  const extra: DraftTransaction[] = []
  const uniqueSpeech = new Map(spoken.map(draft => [
    JSON.stringify([normalized(draft.note), draft.date, draft.amount, draft.type]), draft,
  ]))
  for (const voice of uniqueSpeech.values()) {
    const matches = visual.filter(draft => {
      const name = normalized(draft.note)
      const other = normalized(voice.note)
      return (name && other && (name.includes(other) || other.includes(name)))
        || (draft.amount && draft.amount === voice.amount && (!draft.date || !voice.date || draft.date === voice.date))
    })
    const match = matches.length === 1 ? matches[0] : undefined
    // One receipt and one narration often use different names for the same purchase.
    const same = match ?? (visual.length === 1 && uniqueSpeech.size === 1 ? visual[0] : undefined)
    if (!same) {
      if (!matches.length) extra.push({ ...voice })
      continue
    }
    narration[visual.indexOf(same)].push(voice)
  }
  const drafts = visual.map((draft, i) => {
    const voices = narration[i]
    if (!voices.length) return draft
    const amounts = new Set([draft.amount, ...voices.map(v => v.amount)].filter(Boolean))
    const dates = new Set([draft.date, ...voices.map(v => v.date)].filter(Boolean))
    const amount = [...amounts][0]
    const date = [...dates][0]
    // Reapply the receipt parser so ambiguous printed totals or foreign currencies
    // stay unresolved even when a narrated amount could otherwise fill the gap.
    const combined = receiptDraft([...groups[i].frames, 'TOTAL ' + (amount ?? ''), date ?? ''].join('\n'))
    return { ...draft, amount: amounts.size === 1 ? combined.amount : 0, date: dates.size === 1 ? combined.date : '',
      note: draft.note || voices[0].note, account: voices[0].account, category: voices[0].category, type: voices[0].type }
  }).concat(extra)
  return drafts.length ? drafts : [receiptDraft('')]
}

export async function transcribeVideoAudio(key: string, audio: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST', signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'openai/whisper-1', language: 'zh', input_audio: { format: 'm4a', data: audio } }),
  })
  if (!response.ok) throw new Error('音軌轉錄失敗（' + response.status + '），可繼續核對畫面。')
  const { text } = await response.json()
  return typeof text === 'string' ? text.trim() : ''
}
