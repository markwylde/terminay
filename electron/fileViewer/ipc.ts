import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  FileViewerSaveRequest,
  FileViewerSparseFileSaveRequest,
  FileViewerTextEncoding,
} from '../../src/types/terminay'
import type { FileBufferService } from './fileBufferService'
import type { FileWatchService } from './fileWatchService'
import type { GitDiffService } from './gitDiffService'

type RegisterFileViewerIpcOptions = {
  assertTrustedSender: (event: IpcMainInvokeEvent) => void
  fileBufferService: FileBufferService
  fileWatchService: FileWatchService
  gitDiffService: GitDiffService
  ipcMain: IpcMain
}

export function registerFileViewerIpcHandlers({
  assertTrustedSender,
  fileBufferService,
  fileWatchService,
  gitDiffService,
  ipcMain,
}: RegisterFileViewerIpcOptions): void {
  ipcMain.handle('file:get-info', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    return fileBufferService.getFileInfo(payload.path)
  })

  ipcMain.handle('file:read-bytes', async (event, payload: { length: number; path: string; start: number }) => {
    assertTrustedSender(event)
    return fileBufferService.readBytes(payload.path, payload.start, payload.length)
  })

  ipcMain.handle(
    'file:read-text',
    async (
      event,
      payload: { encoding?: FileViewerTextEncoding; length: number; path: string; start: number },
    ) => {
      assertTrustedSender(event)
      return fileBufferService.readText(payload.path, payload.start, payload.length, payload.encoding)
    },
  )

  ipcMain.handle('file:save', async (event, payload: FileViewerSaveRequest) => {
    assertTrustedSender(event)
    return fileBufferService.saveFile(payload)
  })

  ipcMain.handle('file:get-text-metadata', async (event, payload: { path: string; projectRoot: string }) => {
    assertTrustedSender(event)
    return fileBufferService.getTextMetadata(payload.path, payload.projectRoot)
  })

  ipcMain.handle(
    'file:read-text-lines',
    async (
      event,
      payload: { lineCount: number; path: string; projectRoot: string; startLine: number },
    ) => {
      assertTrustedSender(event)
      return fileBufferService.readTextLines(
        payload.path,
        payload.projectRoot,
        payload.startLine,
        payload.lineCount,
      )
    },
  )

  ipcMain.handle('file:save-sparse', async (event, payload: FileViewerSparseFileSaveRequest) => {
    assertTrustedSender(event)
    return fileBufferService.saveSparseFile(payload)
  })

  ipcMain.handle('file:watch', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    await fileWatchService.watchFile(event.sender.id, payload.path)
  })

  ipcMain.handle('file:unwatch', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    await fileWatchService.unwatchFile(event.sender.id, payload.path)
  })

  ipcMain.handle('file:get-preview-source', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    return fileBufferService.getPreviewSource(payload.path)
  })

  ipcMain.handle('file:get-git-repo-info', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    return gitDiffService.getRepoInfo(payload.path)
  })

  ipcMain.handle('file:get-git-diff', async (event, payload: { path: string }) => {
    assertTrustedSender(event)
    return gitDiffService.getDiff(payload.path)
  })
}
