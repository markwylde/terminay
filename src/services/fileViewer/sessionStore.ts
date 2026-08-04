import type { FileInfo, FileSessionState, FileViewerEngine, FileViewerMode } from '../../types/fileViewer'

export type FileSessionStore = ReturnType<typeof createFileSessionStore>

export function createFileSessionStore(file: FileInfo, options?: {
  diffLayout?: FileSessionState['diffLayout']
  engine?: FileViewerEngine
  mode?: FileViewerMode
}) {
  let state: FileSessionState = {
    conflict: { kind: 'none' },
    diffLayout: options?.diffLayout ?? 'side-by-side',
    draftMtimeMs: file.mtimeMs,
    engine: options?.engine ?? 'auto',
    file,
    isDirty: false,
    mode: options?.mode ?? 'preview',
  }

  const listeners = new Set<(state: FileSessionState) => void>()

  const emit = () => {
    for (const listener of listeners) {
      listener(state)
    }
  }

  return {
    getState() {
      return state
    },
    setConflict(conflict: FileSessionState['conflict']) {
      state = { ...state, conflict }
      emit()
    },
    setDiffLayout(diffLayout: FileSessionState['diffLayout']) {
      state = { ...state, diffLayout }
      emit()
    },
    setDirty(isDirty: boolean) {
      state = { ...state, isDirty }
      emit()
    },
    setEngine(engine: FileViewerEngine) {
      state = { ...state, engine }
      emit()
    },
    setFile(fileInfo: FileInfo) {
      state = {
        ...state,
        draftMtimeMs: fileInfo.mtimeMs,
        file: fileInfo,
      }
      emit()
    },
    setMode(mode: FileViewerMode) {
      state = { ...state, mode }
      emit()
    },
    subscribe(listener: (state: FileSessionState) => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
