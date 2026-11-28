import { registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { LocalModelId } from '../types'
import {
  getLocalModelSpec,
  type LocalAiStatus,
  type LocalDownloadEvent,
  type NanoDownloadEvent,
} from './types'

export interface LocalAiPlugin {
  getStatus(options?: { modelId?: LocalModelId }): Promise<LocalAiStatus>
  downloadModel(options: { modelId?: LocalModelId; wifiOnly: boolean }): Promise<void>
  cancelDownload(): Promise<void>
  deleteModel(options?: { modelId?: LocalModelId }): Promise<void>
  downloadNano(): Promise<void>
  parseText(options: {
    prompt: string
    systemPrompt: string
    modelId?: LocalModelId
    runtime?: 'litert' | 'nano'
  }): Promise<{ text: string; modelUsed?: string; runtime?: string }>
  parseImage(options: {
    prompt: string
    systemPrompt: string
    imageBase64: string
    modelId?: LocalModelId
    runtime?: 'litert' | 'nano'
  }): Promise<{ text: string; modelUsed?: string; runtime?: string }>
  addListener(
    eventName: 'localDownloadProgress',
    listenerFunc: (event: LocalDownloadEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'nanoDownloadProgress',
    listenerFunc: (event: NanoDownloadEvent) => void,
  ): Promise<PluginListenerHandle>
}

class LocalAiWeb extends WebPlugin implements LocalAiPlugin {
  private notOnWeb(action = '使用'): never {
    throw new Error(`本機模型只在 Android App 內提供，目前無法${action}。`)
  }

  async getStatus(options?: { modelId?: LocalModelId }): Promise<LocalAiStatus> {
    const spec = getLocalModelSpec(options?.modelId ?? 'gemma-4-e2b')
    return {
      available: false,
      downloading: false,
      downloadProgress: 0,
      reason: '本機模型只在 Android App 內提供（LiteRT-LM / Gemini Nano）。',
      backend: '',
      modelId: spec.id,
      modelName: spec.label,
      modelPath: '',
      downloadedBytes: 0,
      totalBytes: spec.sizeBytes,
      freeStorageBytes: 0,
      nanoStatus: 'unavailable',
      nanoModelName: '',
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

  async downloadNano(): Promise<void> {
    this.notOnWeb('下載 Gemini Nano')
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
