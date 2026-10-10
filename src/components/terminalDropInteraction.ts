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

/** A path a drag or a paste supplied, or the fact that it carried a file whose path this host cannot resolve. */
export type DroppedPath = { readonly kind: 'path'; readonly path: string } | { readonly kind: 'unavailable' }

/** `file:///Users/sam/notes%20a.md` becomes `/Users/sam/notes a.md`. Anything else is not a file URL. */
export function pathFromFileUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!/^file:\/\//i.test(trimmed)) return null
  try {
    const url = new URL(trimmed)
    const path = decodeURIComponent(url.pathname)
    if (path.length === 0 || hasControlCharacters(path)) return null
    // A Windows drive arrives as `/C:/Users/…`.
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

function firstUriListEntry(value: string): string {
  return value.split(/\r?\n/).find((line) => line.length > 0 && !line.startsWith('#')) ?? ''
}

/**
 * The path a drop names, unescaped: it becomes a field value, not terminal
 * input. Resolution follows the terminal's own rules: Terminay's path data,
 * then a path or file URL in text, then a host-resolved native file. Nothing
 * is read from the file.
 */
export function getDroppedPath(
  dataTransfer: TerminalDropData,
  resolveDesktopFilePath?: TerminalDroppedFilePathResolver,
): DroppedPath | null {
  const customPath = dataTransfer.getData('terminay/path')
  if (customPath && !hasControlCharacters(customPath)) return { kind: 'path', path: customPath }

  const urlPath = pathFromFileUrl(firstUriListEntry(dataTransfer.getData('text/uri-list')))
  if (urlPath !== null) return { kind: 'path', path: urlPath }

  const text = dataTransfer.getData('text/plain').trim()
  const textUrlPath = pathFromFileUrl(text)
  if (textUrlPath !== null) return { kind: 'path', path: textUrlPath }
  if (text && isPortableTerminalPath(text) && !hasControlCharacters(text)) return { kind: 'path', path: text }

  return getNativeFilePath(dataTransfer, resolveDesktopFilePath)
}

/**
 * The path a paste names when the clipboard holds a copied file or a file URL.
 * A plain path on the clipboard returns null so the field pastes it as text.
 */
export function getPastedPath(
  dataTransfer: TerminalDropData,
  resolveDesktopFilePath?: TerminalDroppedFilePathResolver,
): DroppedPath | null {
  const native = getNativeFilePath(dataTransfer, resolveDesktopFilePath)
  if (native?.kind === 'path') return native
  const urlPath =
    pathFromFileUrl(firstUriListEntry(dataTransfer.getData('text/uri-list'))) ??
    pathFromFileUrl(dataTransfer.getData('text/plain'))
  if (urlPath !== null) return { kind: 'path', path: urlPath }
  return native
}

function getNativeFilePath(
  dataTransfer: TerminalDropData,
  resolveDesktopFilePath?: TerminalDroppedFilePathResolver,
): DroppedPath | null {
  if (dataTransfer.files.length === 0) return null
  const path = resolveDesktopFilePath?.(dataTransfer.files[0])
  return typeof path === 'string' && path.length > 0 ? { kind: 'path', path } : { kind: 'unavailable' }
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
