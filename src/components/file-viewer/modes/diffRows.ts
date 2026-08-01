import type { GitFileDiffHunk, GitFileDiffLine } from '../../../types/fileViewer'

export type UnifiedDiffRow =
  | { header: string; key: string; kind: 'header' }
  | { key: string; kind: 'line'; line: GitFileDiffLine }

export type SideBySideDiffRow =
  | { header: string; key: string; kind: 'header' }
  | { key: string; kind: 'pair'; left: GitFileDiffLine | null; right: GitFileDiffLine | null }

function lineKey(line: GitFileDiffLine, index: number): string {
  return `${line.type}-${line.oldLineNumber ?? 'n'}-${line.newLineNumber ?? 'n'}-${index}`
}

export function buildUnifiedDiffRows(hunks: GitFileDiffHunk[]): UnifiedDiffRow[] {
  return hunks.flatMap((hunk, hunkIndex) => [
    { header: hunk.header, key: `header-${hunkIndex}`, kind: 'header' as const },
    ...hunk.lines.map((line, lineIndex) => ({
      key: `h${hunkIndex}-${lineKey(line, lineIndex)}`,
      kind: 'line' as const,
      line,
    })),
  ])
}

export function buildSideBySideDiffRows(hunks: GitFileDiffHunk[]): SideBySideDiffRow[] {
  const rows: SideBySideDiffRow[] = []

  for (const [hunkIndex, hunk] of hunks.entries()) {
    rows.push({ header: hunk.header, key: `header-${hunkIndex}`, kind: 'header' })
    let deleted: GitFileDiffLine[] = []
    let added: GitFileDiffLine[] = []
    let blockIndex = 0

    const flushChanges = () => {
      const rowCount = Math.max(deleted.length, added.length)
      for (let index = 0; index < rowCount; index += 1) {
        rows.push({
          key: `h${hunkIndex}-change-${blockIndex}-${index}`,
          kind: 'pair',
          left: deleted[index] ?? null,
          right: added[index] ?? null,
        })
      }
      deleted = []
      added = []
      blockIndex += 1
    }

    for (const line of hunk.lines) {
      if (line.type === 'delete') {
        deleted.push(line)
        continue
      }
      if (line.type === 'add') {
        added.push(line)
        continue
      }

      flushChanges()
      rows.push({
        key: `h${hunkIndex}-context-${line.oldLineNumber ?? line.newLineNumber ?? blockIndex}`,
        kind: 'pair',
        left: line,
        right: line,
      })
    }

    flushChanges()
  }

  return rows
}

export function getVirtualDiffRange(options: {
  overscan: number
  rowCount: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
}): { endIndex: number; startIndex: number } {
  const { overscan, rowCount, rowHeight, scrollTop, viewportHeight } = options
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIndex = Math.min(
    rowCount,
    Math.ceil((scrollTop + Math.max(viewportHeight, rowHeight)) / rowHeight) + overscan,
  )
  return { endIndex, startIndex }
}
