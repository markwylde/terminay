import type { FileInfo, FileViewerEngine, FileViewerMode } from '../../types/fileViewer'

export type FilePanelInstanceParams = {
  color?: string
  diffLayout?: 'side-by-side' | 'unified'
  emoji?: string
  fileInfo?: FileInfo
  filePath: string
  initialMode?: FileViewerMode
  inheritsProjectColor?: boolean
  isDirty?: boolean
  isFocused?: boolean
  onSave?: () => Promise<boolean>
  preferredEngine?: FileViewerEngine
  projectColor?: string
}
