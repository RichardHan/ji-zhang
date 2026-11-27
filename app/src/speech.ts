import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

const pluginName = 'BookkeepingSpeech'

export interface SpeechDraft {
  id: string
  book: string
  prompt: string
  usedVoice: boolean
}

interface RestoredSpeechResult {
  draftId: string
  text?: string
  error?: string
}

export const bookkeepingSpeech = registerPlugin<{
  recognize(options: { draftId?: string }): Promise<{ text?: string }>
  addListener(event: 'restoredSpeechResult', listener: (result: RestoredSpeechResult) => void): Promise<PluginListenerHandle>
}>(pluginName)

export const canUseBookkeepingSpeech = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable(pluginName)
