import type { GitFileDiff } from '../../../types/fileViewer'
import { renderHighlightedCode } from '../codeHighlight'

type DiffViewerProps = {
  diff: GitFileDiff | null
  error?: string | null
  filePath?: string
  isLoading?: boolean
  layout: 'side-by-side' | 'unified'
}

function DiffEmptyState({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="file-viewer-empty-state">
      <div className="file-viewer-empty-state__icon" aria-hidden="true">
        Δ
      </div>
      <div className="file-viewer-empty-state__title">{title}</div>
      <div className="file-viewer-empty-state__description">{description}</div>
    </div>
  )
}

export function DiffViewer({ diff, error, filePath = '', isLoading = false, layout }: DiffViewerProps) {
  if (isLoading) {
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="Loading diff" description="Fetching the latest Git diff for this file." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="Diff unavailable" description={error} />
      </div>
    )
  }

  if (!diff?.isTracked || !diff.repositoryRoot) {
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="Diff unavailable" description="This file is not tracked by Git in the current repository." />
      </div>
    )
  }

  if (diff.isBinary) {
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="Binary diff" description="Git reports this file as binary, so there is no text diff to display." />
      </div>
    )
  }

  if (diff.hunks.length === 0) {
    const rawPatch = diff.rawPatch.trim()
    if (rawPatch.length > 0) {
      return (
        <div className="file-diff-viewer file-diff-viewer--raw">
          <pre className="file-preview-text">{rawPatch}</pre>
        </div>
      )
    }

    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="No changes" description="This file matches HEAD, so there is no diff to show." />
      </div>
    )
  }

  const rows = diff.hunks.flatMap((hunk) => [
    { kind: 'header' as const, header: hunk.header },
    ...hunk.lines.map((line) => ({ kind: 'line' as const, line })),
  ])

  return (
    <div className={`file-diff-viewer file-diff-viewer--${layout}`}>
      {rows.map((item) =>
        item.kind === 'header' ? (
          <div key={`header-${item.header}`} className="file-diff-row file-diff-row--header">
            {item.header}
          </div>
        ) : (
          <div
            key={`line-${item.line.oldLineNumber ?? 'n'}-${item.line.newLineNumber ?? 'n'}-${item.line.type}-${item.line.value}`}
            className={`file-diff-row file-diff-row--${item.line.type === 'add' ? 'added' : item.line.type === 'delete' ? 'removed' : 'context'}`}
          >
            <span className="file-diff-row__numbers">
              <span>{item.line.oldLineNumber ?? ''}</span>
              <span>{item.line.newLineNumber ?? ''}</span>
            </span>
            <span className="file-diff-row__indicator">
              {item.line.type === 'add' ? '+' : item.line.type === 'delete' ? '-' : ' '}
            </span>
            <code className="file-diff-row__content">{renderHighlightedCode(item.line.value, filePath)}</code>
          </div>
        ),
      )}
    </div>
  )
}
