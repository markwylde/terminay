import type { IpcMain } from 'electron'
import type {
  FileViewerSaveRequest,
  FileViewerSparseFileSaveRequest,
  FileViewerTextEncoding,
} from '../../src/types/terminay'
import type { FileBufferService } from './fileBufferService'
import type { FileWatchService } from './fileWatchService'
import type { GitDiffService } from './gitDiffService'

type RegisterFileViewerIpcOptions = {
  fileBufferService: FileBufferService
  fileWatchService: FileWatchService
  gitDiffService: GitDiffService
  ipcMain: IpcMain
}

export function registerFileViewerIpcHandlers({
  fileBufferService,
  fileWatchService,
  gitDiffService,
  ipcMain,
}: RegisterFileViewerIpcOptions): void {
  ipcMain.handle('file:get-info', async (_event, payload: { path: string }) => {
    return fileBufferService.getFileInfo(payload.path)
  })

  ipcMain.handle('file:read-bytes', async (_event, payload: { length: number; path: string; start: number }) => {
    return fileBufferService.readBytes(payload.path, payload.start, payload.length)
  })

  ipcMain.handle(
    'file:read-text',
    async (
      _event,
      payload: { encoding?: FileViewerTextEncoding; length: number; path: string; start: number },
    ) => {
      return fileBufferService.readText(payload.path, payload.start, payload.length, payload.encoding)
    },
  )

  ipcMain.handle('file:save', async (_event, payload: FileViewerSaveRequest) => {
    return fileBufferService.saveFile(payload)
  })

  ipcMain.handle('file:get-text-metadata', async (_event, payload: { path: string; projectRoot: string }) => {
    return fileBufferService.getTextMetadata(payload.path, payload.projectRoot)
  })

  ipcMain.handle(
    'file:read-text-lines',
    async (
      _event,
      payload: { lineCount: number; path: string; projectRoot: string; startLine: number },
    ) => {
      return fileBufferService.readTextLines(
        payload.path,
        payload.projectRoot,
        payload.startLine,
        payload.lineCount,
      )
    },
  )

  ipcMain.handle('file:save-sparse', async (_event, payload: FileViewerSparseFileSaveRequest) => {
    return fileBufferService.saveSparseFile(payload)
  })

  ipcMain.handle('file:watch', async (event, payload: { path: string }) => {
    await fileWatchService.watchFile(event.sender.id, payload.path)
  })

  ipcMain.handle('file:unwatch', async (event, payload: { path: string }) => {
    await fileWatchService.unwatchFile(event.sender.id, payload.path)
  })

  ipcMain.handle('file:get-preview-source', async (_event, payload: { path: string }) => {
    return fileBufferService.getPreviewSource(payload.path)
  })

  ipcMain.handle('file:get-git-repo-info', async (_event, payload: { path: string }) => {
    return gitDiffService.getRepoInfo(payload.path)
  })

  ipcMain.handle('file:get-git-diff', async (_event, payload: { path: string }) => {
    return gitDiffService.getDiff(payload.path)
  })
}
