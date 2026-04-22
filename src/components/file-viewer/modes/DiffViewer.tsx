import type { GitFileDiff } from '../../../types/fileViewer'
import { VirtualListSurface } from '../virtualization/VirtualListSurface'

type DiffViewerProps = {
  diff: GitFileDiff | null
  layout: 'side-by-side' | 'unified'
}

export function DiffViewer({ diff, layout }: DiffViewerProps) {
  if (!diff) {
    return <div className="file-diff-viewer file-diff-viewer--empty">Diff unavailable for this file.</div>
  }

  const rows = diff.hunks.flatMap((hunk) => [
    { kind: 'header' as const, header: hunk.header },
    ...hunk.lines.map((line) => ({ kind: 'line' as const, line })),
  ])

  return (
    <div className={`file-diff-viewer file-diff-viewer--${layout}`}>
      <VirtualListSurface
        items={rows}
        estimateSize={() => 32}
        getKey={(row, index) => (row.kind === 'header' ? `header-${index}-${row.header}` : `line-${index}`)}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <div className="file-diff-row file-diff-row--header">{item.header}</div>
          ) : (
            <div className={`file-diff-row file-diff-row--${item.line.type === 'add' ? 'added' : item.line.type === 'delete' ? 'removed' : 'modified'}`}>
              <span className="file-diff-row__numbers">
                <span>{item.line.oldLineNumber ?? ''}</span>
                <span>{item.line.newLineNumber ?? ''}</span>
              </span>
              <code className="file-diff-row__content">{item.line.value}</code>
            </div>
          )
        }
      />
    </div>
  )
}
