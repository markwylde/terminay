/**
 * Terminal drop handling deliberately distinguishes portable text/path drops
 * from File-object drops. A native path is inserted only when Desktop can
 * resolve one and the terminal runs on this machine's own Local server; every
 * other File drop is copied to the terminal's server, which answers with paths
 * valid there (ADR-0113).
 */
export interface TerminalDropData {
  readonly types: readonly string[]
  readonly files: ArrayLike<unknown>
  getData(format: string): string
}

export type TerminalDroppedFilePathResolver = (file: unknown) => string | undefined

/** A File as a drop hands it over: enough to name it and read it in parts. */
export interface TerminalDroppedFileSource {
  readonly name: string
  readonly size: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

/** Streams named files to the terminal's server and answers with their server paths. */
export type TerminalDroppedFileUploader = (
  files: readonly { readonly name: string; readonly size: number }[],
  readPart: (file: number, offset: number, length: number) => Promise<Uint8Array>,
) => Promise<readonly string[]>

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
): boolean {
  if (dataTransfer.types.includes('terminay/path')) {
    return true
  }

  // Claim every OS file drop: a native path or an upload serves it, and one
  // that neither can serve fails visibly rather than letting the browser open
  // the file in place of the app.
  if (dataTransfer.types.includes('Files')) {
    return true
  }

  return getTerminalDropText(dataTransfer, resolveDesktopFilePath) !== null
}

/** The item list a drop event carries, as far as telling folders apart needs. */
export interface TerminalDropItems {
  readonly length: number
  readonly [index: number]: { readonly kind: string; webkitGetAsEntry?: () => { readonly isDirectory: boolean } | null } | undefined
}

/**
 * The dropped files, and whether any is a folder. Must be called during the
 * drop event itself: a browser empties `items` once the handler yields.
 */
export function droppedFileSources(
  files: ArrayLike<unknown>,
  items?: TerminalDropItems,
): { readonly files: readonly TerminalDroppedFileSource[]; readonly hasFolder: boolean } {
  let hasFolder = false
  if (items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item?.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory === true) hasFolder = true
    }
  }
  const sources = Array.from(files).filter((value): value is TerminalDroppedFileSource => {
    const file = value as Partial<TerminalDroppedFileSource>
    return typeof file.name === 'string' && typeof file.size === 'number' && typeof file.slice === 'function'
  })
  return { files: sources, hasFolder }
}

/**
 * Copy dropped files to the terminal's server and return the shell-escaped
 * server paths, space-separated, ready to insert. Files are read part by part.
 */
export async function uploadTerminalDropFiles(
  files: readonly TerminalDroppedFileSource[],
  upload: TerminalDroppedFileUploader,
): Promise<string | null> {
  if (files.length === 0) return null
  for (const file of files) {
    if (file.name.length === 0 || hasControlCharacters(file.name) || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error('A dropped file has no usable name.')
    }
  }
  const paths = await upload(
    files.map(({ name, size }) => ({ name, size })),
    async (index, offset, length) => {
      const file = files[index]
      if (file === undefined) throw new RangeError('no such dropped file')
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
    },
  )
  return paths.length > 0 ? paths.map(escapeTerminalPathForShell).join(' ') : null
}
