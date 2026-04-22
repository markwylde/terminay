import type { FileInfo, FilePreviewCapabilities, FileViewerMode } from '../../types/fileViewer'

export const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd'])
const IMAGE_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
])
const PDF_EXTENSIONS = new Set(['.pdf'])
const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.conf',
  '.cpp',
  '.css',
  '.csv',
  '.env',
  '.go',
  '.graphql',
  '.h',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.log',
  '.md',
  '.markdown',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])

export function detectPreviewKind(file: FileInfo): FilePreviewCapabilities['previewKind'] {
  if (PDF_EXTENSIONS.has(file.extension)) {
    return 'pdf'
  }

  if (IMAGE_EXTENSIONS.has(file.extension) || file.mimeType?.startsWith('image/')) {
    return 'image'
  }

  if (MARKDOWN_EXTENSIONS.has(file.extension)) {
    return 'markdown'
  }

  if (!file.isBinary) {
    return 'text'
  }

  return 'unsupported'
}

export function isTextLikeFile(file: FileInfo): boolean {
  if (TEXT_EXTENSIONS.has(file.extension)) {
    return true
  }

  return (
    file.mimeType?.startsWith('text/') === true ||
    file.mimeType === 'application/json' ||
    file.mimeType === 'image/svg+xml'
  )
}

export function detectFileCapabilities(file: FileInfo): FilePreviewCapabilities {
  const previewKind = detectPreviewKind(file)
  const canPreview = previewKind !== 'unsupported'
  const textLike = isTextLikeFile(file)
  const canUseMonaco = textLike
  const canEditText = textLike
  const canEditHex = !file.isDirectory
  const canDiff = !file.isDirectory

  const fallbackMode: FileViewerMode = canPreview
    ? 'preview'
    : canEditText
      ? 'text'
      : 'hex'

  return {
    canDiff,
    canEditHex,
    canEditText,
    canPreview,
    canUseMonaco,
    fallbackMode,
    previewKind,
    shouldPromptForEngineChoice: file.size > LARGE_FILE_THRESHOLD_BYTES && canUseMonaco,
  }
}
