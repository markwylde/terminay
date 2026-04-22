import path from 'node:path'

export function normalizeFileViewerPath(rawPath: string, homePath: string): string {
  const trimmedPath = rawPath.trim()

  if (trimmedPath === '~') {
    return homePath
  }

  if (trimmedPath.startsWith('~/') || trimmedPath.startsWith('~\\')) {
    return path.resolve(homePath, trimmedPath.slice(2))
  }

  return path.resolve(trimmedPath)
}

export function getPathNameParts(filePath: string): { extension: string; name: string } {
  return {
    extension: path.extname(filePath).toLowerCase(),
    name: path.basename(filePath),
  }
}

export function getGitWorkingDirectory(targetPath: string, isDirectory: boolean): string {
  return isDirectory ? targetPath : path.dirname(targetPath)
}
