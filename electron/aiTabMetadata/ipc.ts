import type { IpcMain } from 'electron'
import type { AiTabMetadataGenerateRequest, AiTabMetadataProvider } from '../../src/types/terminay'
import type { AiTabMetadataService } from './service'

type RegisterAiTabMetadataIpcOptions = {
  aiTabMetadataService: AiTabMetadataService
  ipcMain: IpcMain
}

export function registerAiTabMetadataIpcHandlers({
  aiTabMetadataService,
  ipcMain,
}: RegisterAiTabMetadataIpcOptions): void {
  ipcMain.handle('ai-tab-metadata:list-models', async (_event, payload: { provider: AiTabMetadataProvider }) => {
    return aiTabMetadataService.listModels(payload.provider)
  })

  ipcMain.handle('ai-tab-metadata:generate', async (_event, payload: AiTabMetadataGenerateRequest) => {
    return aiTabMetadataService.generate(payload)
  })
}
