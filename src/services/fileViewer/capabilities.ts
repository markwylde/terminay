import type {
  FileInfo,
  FilePreviewCapabilities,
  FileViewerEngine,
  FileViewerMode,
} from '../../types/fileViewer'

export const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024
/**
 * Monaco is a complete in-memory text model. Keep that opt-in path bounded;
 * files beyond the shared content-transfer ceiling remain ranged/virtualized.
 */
export const MAX_MONACO_FILE_BYTES = 128 * 1024 * 1024

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mdx'])
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
  '.mdx',
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
  const serverCapabilities = file.viewerCapabilities
  const previewKind = serverCapabilities?.previewKind ?? detectPreviewKind(file)
  const canPreview = serverCapabilities === undefined
    ? previewKind !== 'unsupported'
    : serverCapabilities.safePreview || previewKind === 'unsupported'
  const canTasks = previewKind === 'markdown'
  const textLike = isTextLikeFile(file)
  const canEditText = !file.isDirectory && (serverCapabilities?.canEditText ?? true)
  const canUseMonaco = canEditText && file.size <= MAX_MONACO_FILE_BYTES
  const canEditHex = !file.isDirectory && (serverCapabilities?.canEditHex ?? true)
  const canDiff = !file.isDirectory

  const preferredMode = serverCapabilities?.preferredMode
  const defaultMode: FileViewerMode = preferredMode === 'preview' && canPreview
    ? 'preview'
    : preferredMode === 'text' && canEditText
      ? 'text'
      : preferredMode === 'hex' && canEditHex
        ? 'hex'
        : canPreview
          ? 'preview'
          : textLike && canEditText
            ? 'text'
            : 'hex'

  return {
    canDiff,
    canEditHex,
    canEditText,
    canPreview,
    canTasks,
    canUseMonaco,
    defaultMode,
    fallbackMode: canEditHex ? 'hex' : defaultMode,
    previewKind,
    shouldPromptForEngineChoice: file.size > LARGE_FILE_THRESHOLD_BYTES && canUseMonaco,
  }
}

export function isFileViewerModeAvailable(
  capabilities: FilePreviewCapabilities,
  mode: FileViewerMode,
): boolean {
  switch (mode) {
    case 'preview':
      return capabilities.canPreview
    case 'tasks':
      return capabilities.canTasks
    case 'text':
      return capabilities.canEditText
    case 'hex':
      return capabilities.canEditHex
    case 'diff':
      return capabilities.canDiff
  }
}

export function resolveFileViewerMode(
  capabilities: FilePreviewCapabilities,
  requestedMode: FileViewerMode,
): FileViewerMode {
  return isFileViewerModeAvailable(capabilities, requestedMode)
    ? requestedMode
    : capabilities.fallbackMode
}

/** Resolve the engine without allowing an unbounded whole-file Monaco read. */
export function resolveFileViewerEngine(
  file: FileInfo,
  capabilities: FilePreviewCapabilities,
  requestedEngine: FileViewerEngine,
): FileViewerEngine {
  if (!capabilities.canEditText) {
    return requestedEngine === 'performant' ? 'performant' : 'auto'
  }

  if (requestedEngine === 'performant') {
    return 'performant'
  }

  if (requestedEngine === 'monaco') {
    return capabilities.canUseMonaco ? 'monaco' : 'performant'
  }

  if (capabilities.shouldPromptForEngineChoice) {
    return 'auto'
  }

  return file.size > LARGE_FILE_THRESHOLD_BYTES && !capabilities.canUseMonaco ? 'performant' : 'monaco'
}
