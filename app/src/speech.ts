import { Capacitor, registerPlugin } from '@capacitor/core'

const pluginName = 'BookkeepingSpeech'

export const bookkeepingSpeech = registerPlugin<{
  recognize(): Promise<{ text?: string }>
}>(pluginName)

export const canUseBookkeepingSpeech = Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable(pluginName)
