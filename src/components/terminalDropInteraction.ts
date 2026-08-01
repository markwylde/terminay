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
): boolean {
  if (dataTransfer.types.includes('terminay/path')) {
    return true
  }

  // A raw File can only be handled when a privileged Desktop resolver was
  // explicitly supplied. This prevents browser/server panels from claiming a
  // drop they cannot turn into a safe terminal path.
  if (dataTransfer.types.includes('Files') && resolveDesktopFilePath) {
    return true
  }

  return getTerminalDropText(dataTransfer, resolveDesktopFilePath) !== null
}
