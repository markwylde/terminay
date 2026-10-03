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

/**
 * The views a file offers, in the order they are worth reaching for. Views
 * that cannot show the file are left out; views that can but rarely matter
 * for its type wait in `secondaryModes`.
 */
function resolveViewModes(input: {
  canDiff: boolean
  canEditHex: boolean
  canEditText: boolean
  canPreview: boolean
  canTasks: boolean
}): Pick<FilePreviewCapabilities, 'primaryModes' | 'secondaryModes'> {
  if (!input.canEditText) {
    const primaryModes: FileViewerMode[] = []
    if (input.canPreview) primaryModes.push('preview')
    if (input.canEditHex) primaryModes.push('hex')
    return { primaryModes, secondaryModes: [] }
  }

  const primaryModes: FileViewerMode[] = input.canTasks
    ? [...(input.canPreview ? (['preview'] as const) : []), 'tasks', 'text']
    : ['text', ...(input.canPreview ? (['preview'] as const) : [])]
  if (input.canDiff) primaryModes.push('diff')
  return { primaryModes, secondaryModes: input.canEditHex ? ['hex'] : [] }
}

export function detectFileCapabilities(file: FileInfo): FilePreviewCapabilities {
  const serverCapabilities = file.viewerCapabilities
  const previewKind = serverCapabilities?.previewKind ?? detectPreviewKind(file)
  const canPreview = serverCapabilities === undefined
    ? previewKind !== 'unsupported' && previewKind !== 'hex'
    : serverCapabilities.safePreview
  const canTasks = previewKind === 'markdown'
  const isBinary = serverCapabilities?.isBinary ?? (file.isBinary && !isTextLikeFile(file))
  const canEditText = !file.isDirectory && (serverCapabilities?.canEditText ?? !isBinary)
  const canUseMonaco = canEditText && file.size <= MAX_MONACO_FILE_BYTES
  const canEditHex = !file.isDirectory && (serverCapabilities?.canEditHex ?? true)
  const canDiff = !file.isDirectory && canEditText
  const { primaryModes, secondaryModes } = resolveViewModes({
    canDiff,
    canEditHex,
    canEditText,
    canPreview,
    canTasks,
  })

  const offered = (mode: FileViewerMode) =>
    mode !== 'diff' && (primaryModes.includes(mode) || secondaryModes.includes(mode))
  const preferredMode = serverCapabilities?.preferredMode
  const defaultMode: FileViewerMode = preferredMode !== undefined && offered(preferredMode)
    ? preferredMode
    : canTasks && canPreview
      ? 'preview'
      : canEditText
        ? 'text'
        : canPreview
          ? 'preview'
          : 'hex'

  return {
    canDiff,
    canEditHex,
    canEditText,
    canPreview,
    canTasks,
    canUseMonaco,
    defaultMode,
    // A view that turns out to be unavailable gives way to the view the file
    // would have opened in, never to a rawer one.
    fallbackMode: defaultMode,
    previewKind,
    primaryModes,
    secondaryModes,
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
