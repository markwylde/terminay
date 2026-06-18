import type { IpcMain } from 'electron'
import type { QuickPushApplyRequest, QuickPushGenerateRequest } from '../../src/types/terminay'
import type { QuickPushService } from './service'

type RegisterQuickPushIpcOptions = {
  quickPushService: QuickPushService
  ipcMain: IpcMain
}

export function registerQuickPushIpcHandlers({ quickPushService, ipcMain }: RegisterQuickPushIpcOptions): void {
  ipcMain.handle('quick-push:generate-plan', async (_event, payload: QuickPushGenerateRequest) => {
    return quickPushService.generatePlan(payload)
  })

  ipcMain.handle('quick-push:apply', async (_event, payload: QuickPushApplyRequest) => {
    return quickPushService.apply(payload)
  })
}
