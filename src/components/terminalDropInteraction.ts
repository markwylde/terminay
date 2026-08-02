/**
 * Terminal drop handling deliberately distinguishes portable text/path drops
 * from Desktop File-object drops. Browsers do not expose an absolute path for
 * File objects, so resolving one is a privileged Desktop compatibility
 * capability, never part of a server-backed terminal attachment.
 */
export interface TerminalDropData {
  readonly types: readonly string[]
  readonly files: ArrayLike<unknown>
  getData(format: string): string
}

export type TerminalDroppedFilePathResolver = (file: unknown) => string | undefined
export type TerminalDroppedFileUploader = (path: string, bytes: Uint8Array<ArrayBuffer>) => Promise<void>
export const MAX_TERMINAL_DROP_UPLOAD_BYTES = 4 * 1024 * 1024

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

export function escapeTerminalPathForShell(path: string): string {
  if (path.length === 0) {
    return "''"
  }

  return `'${path.replace(/'/g, `'\\''`)}'`
}

function isPortableTerminalPath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('~/') || value.includes('\\')
}

export function getTerminalDropText(
  dataTransfer: TerminalDropData,
  resolveDesktopFilePath?: TerminalDroppedFilePathResolver,
): string | null {
  const customPath = dataTransfer.getData('terminay/path')
  if (customPath) {
    return escapeTerminalPathForShell(customPath)
  }

  const textData = dataTransfer.getData('text/plain')
  if (textData && isPortableTerminalPath(textData)) {
    return escapeTerminalPathForShell(textData)
  }

  if (!resolveDesktopFilePath || dataTransfer.files.length === 0) {
    return null
  }

  const paths = Array.from(dataTransfer.files)
    .map(resolveDesktopFilePath)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)

  return paths.length > 0 ? paths.map(escapeTerminalPathForShell).join(' ') : null
}

export function shouldInterceptTerminalDrop(
  dataTransfer: TerminalDropData,
  resolveDesktopFilePath?: TerminalDroppedFilePathResolver,
  canUploadBrowserFiles = false,
): boolean {
  if (dataTransfer.types.includes('terminay/path')) {
    return true
  }

  // Desktop resolves a native path; web clients must have a server-scoped
  // uploader before claiming a browser-local File drop.
  if (dataTransfer.types.includes('Files') && (resolveDesktopFilePath || canUploadBrowserFiles)) {
    return true
  }

  return getTerminalDropText(dataTransfer, resolveDesktopFilePath) !== null
}

export async function uploadBrowserTerminalDrop(
  files: ArrayLike<unknown>,
  projectRoot: string,
  upload: TerminalDroppedFileUploader,
): Promise<string | null> {
  const prepared: Array<{ name: string; bytes: Uint8Array<ArrayBuffer> }> = []
  for (const value of Array.from(files)) {
    const file = value as { name?: unknown; size?: unknown; arrayBuffer?: unknown }
    if (
      typeof file.name !== 'string' || file.name.length === 0 || file.name.length > 255 ||
      file.name === '.' || file.name === '..' || file.name.includes('/') || file.name.includes('\\') || hasControlCharacters(file.name) ||
      typeof file.size !== 'number' || file.size < 0 || file.size > MAX_TERMINAL_DROP_UPLOAD_BYTES ||
      typeof file.arrayBuffer !== 'function'
    ) {
      throw new Error('Dropped file cannot be uploaded (maximum 4 MB per file).')
    }
    const bytes = new Uint8Array(await (file.arrayBuffer as () => Promise<ArrayBuffer>)())
    if (bytes.byteLength !== file.size || bytes.byteLength > MAX_TERMINAL_DROP_UPLOAD_BYTES) {
      throw new Error('Dropped file changed or exceeded the upload limit while being read.')
    }
    prepared.push({ name: file.name, bytes })
  }
  if (prepared.length === 0) return null
  for (const file of prepared) await upload(file.name, file.bytes)
  const separator = projectRoot.endsWith('/') || projectRoot.endsWith('\\') ? '' : '/'
  return prepared.map(file => escapeTerminalPathForShell(`${projectRoot}${separator}${file.name}`)).join(' ')
}
