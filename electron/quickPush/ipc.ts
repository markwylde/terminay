import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { QuickPushApplyRequest, QuickPushGenerateRequest } from '../../src/types/terminay'
import type { QuickPushService } from './service'

type RegisterQuickPushIpcOptions = {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void
  quickPushService: QuickPushService
  ipcMain: IpcMain
}

export function registerQuickPushIpcHandlers({ assertTrustedSender, quickPushService, ipcMain }: RegisterQuickPushIpcOptions): void {
  ipcMain.handle('quick-push:generate-plan', async (event, payload: QuickPushGenerateRequest) => {
    assertTrustedSender(event)
    return quickPushService.generatePlan(payload)
  })

  ipcMain.handle('quick-push:apply', async (event, payload: QuickPushApplyRequest) => {
    assertTrustedSender(event)
    return quickPushService.apply(payload)
  })
}
