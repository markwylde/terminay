import type { FileInfo, FileViewerEngine, FileViewerMode } from '../../types/fileViewer'

export type FilePanelInstanceParams = {
  diffLayout?: 'side-by-side' | 'unified'
  fileInfo?: FileInfo
  filePath: string
  initialMode?: FileViewerMode
  isDirty?: boolean
  isFocused?: boolean
  onSave?: () => Promise<boolean>
  preferredEngine?: FileViewerEngine
}
