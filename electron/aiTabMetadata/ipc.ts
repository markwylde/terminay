import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AiTabMetadataGenerateRequest, AiTabMetadataProvider } from '../../src/types/terminay'
import type { AiTabMetadataService } from './service'

type RegisterAiTabMetadataIpcOptions = {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void
  aiTabMetadataService: AiTabMetadataService
  ipcMain: IpcMain
}

export function registerAiTabMetadataIpcHandlers({
  assertTrustedSender,
  aiTabMetadataService,
  ipcMain,
}: RegisterAiTabMetadataIpcOptions): void {
  ipcMain.handle('ai-tab-metadata:list-models', async (event, payload: { provider: AiTabMetadataProvider }) => {
    assertTrustedSender(event)
    return aiTabMetadataService.listModels(payload.provider)
  })

  ipcMain.handle('ai-tab-metadata:generate', async (event, payload: AiTabMetadataGenerateRequest) => {
    assertTrustedSender(event)
    return aiTabMetadataService.generate(payload)
  })
}
