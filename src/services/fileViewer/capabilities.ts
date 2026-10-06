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
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml'])
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
  '.htm',
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
  '.xhtml',
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

  if (HTML_EXTENSIONS.has(file.extension) && !file.isBinary) {
    return 'html'
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
  previewLeads: boolean
}): Pick<FilePreviewCapabilities, 'primaryModes' | 'secondaryModes'> {
  if (!input.canEditText) {
    const primaryModes: FileViewerMode[] = []
    if (input.canPreview) primaryModes.push('preview')
    if (input.canEditHex) primaryModes.push('hex')
    return { primaryModes, secondaryModes: [] }
  }

  const primaryModes: FileViewerMode[] = input.canTasks
    ? [...(input.canPreview ? (['preview'] as const) : []), 'tasks', 'text']
    : input.previewLeads && input.canPreview
      ? ['preview', 'text']
      : ['text', ...(input.canPreview ? (['preview'] as const) : [])]
  if (input.canDiff) primaryModes.push('diff')
  return { primaryModes, secondaryModes: input.canEditHex ? ['hex'] : [] }
}

export function detectFileCapabilities(
  file: FileInfo,
  host: { /** Whether this host can run the sandbox a page preview needs. */ pagePreview?: boolean } = {},
): FilePreviewCapabilities {
  const serverCapabilities = file.viewerCapabilities
  const previewKind = serverCapabilities?.previewKind ?? detectPreviewKind(file)
  // A page is rendered in the sandbox or not at all, so a host without the
  // sandbox has no Preview for it and the file opens in Text.
  const pagePreviewUnavailable = previewKind === 'html' && host.pagePreview === false
  const canPreview = !pagePreviewUnavailable && (serverCapabilities === undefined
    ? previewKind !== 'unsupported' && previewKind !== 'hex'
    : serverCapabilities.safePreview)
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
    previewLeads: previewKind === 'html',
  })

  const offered = (mode: FileViewerMode) =>
    mode !== 'diff' && (primaryModes.includes(mode) || secondaryModes.includes(mode))
  const preferredMode = serverCapabilities?.preferredMode
  const defaultMode: FileViewerMode = preferredMode !== undefined && offered(preferredMode)
    ? preferredMode
    : (canTasks || (previewKind === 'html' && serverCapabilities === undefined)) && canPreview
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

/**
 * Whether a panel may hold this file's complete content in memory.
 *
 * A large file is read whole only for the Monaco engine, which the user has to
 * choose. While the engine is still `auto` the choice is pending, and the
 * Performant engine reads ranges; neither may start a whole-file read.
 */
export function canLoadWholeFileContent(
  file: Pick<FileInfo, 'size'>,
  engine: FileViewerEngine,
): boolean {
  return file.size <= LARGE_FILE_THRESHOLD_BYTES || engine === 'monaco'
}
