import { registerPlugin, WebPlugin } from '@capacitor/core'
import { LOCAL_MODEL_NAME, LOCAL_MODEL_SIZE_BYTES, type LocalAiStatus } from './types'

export interface LocalAiPlugin {
  getStatus(): Promise<LocalAiStatus>
  downloadModel(options: { wifiOnly: boolean }): Promise<void>
  cancelDownload(): Promise<void>
  deleteModel(): Promise<void>
  parseText(options: { prompt: string; today: string }): Promise<{ text: string }>
  parseImage(options: { prompt: string; today: string; imageBase64: string }): Promise<{ text: string }>
}

class LocalAiWeb extends WebPlugin implements LocalAiPlugin {
  private notOnWeb(action = '使用'): never {
    throw new Error(`本機模型只在 Android App 內提供，目前無法${action}。`)
  }

  async getStatus(): Promise<LocalAiStatus> {
    return {
      available: false,
      reason: '本機模型只在 Android App 內提供。之後會用 LiteRT-LM 在手機上跑 Gemma 4 E2B。',
      backend: '',
      modelName: LOCAL_MODEL_NAME,
      modelPath: '',
      downloadedBytes: 0,
      totalBytes: LOCAL_MODEL_SIZE_BYTES,
    }
  }

  async downloadModel(): Promise<void> {
    this.notOnWeb('下載')
  }

  async cancelDownload(): Promise<void> {
    this.notOnWeb('取消下載')
  }

  async deleteModel(): Promise<void> {
    this.notOnWeb('刪除')
  }

  async parseText(): Promise<{ text: string }> {
    this.notOnWeb('解析文字')
  }

  async parseImage(): Promise<{ text: string }> {
    this.notOnWeb('解析照片')
  }
}

export const LocalAi = registerPlugin<LocalAiPlugin>('LocalAi', {
  web: () => new LocalAiWeb(),
})
