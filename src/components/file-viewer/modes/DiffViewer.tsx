import { useCallback, useMemo, useState } from 'react'
import { useResizeObserver } from '../../../hooks/useResizeObserver'
import type { FileDiffLayout, GitFileDiff, GitFileDiffLine } from '../../../types/fileViewer'
import { renderHighlightedCode } from '../codeHighlight'
import {
  buildSideBySideDiffRows,
  buildUnifiedDiffRows,
  getVirtualDiffRange,
  type SideBySideDiffRow,
  type UnifiedDiffRow,
} from './diffRows'

type DiffViewerProps = {
  diff: GitFileDiff | null
  error?: string | null
  filePath?: string
  isLoading?: boolean
  layout: FileDiffLayout
  onChangeLayout: (layout: FileDiffLayout) => void
}

const DIFF_ROW_HEIGHT = 30
const DIFF_ROW_OVERSCAN = 10

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

function DiffLayoutToggle({
  layout,
  onChangeLayout,
}: {
  layout: FileDiffLayout
  onChangeLayout: (layout: FileDiffLayout) => void
}) {
  return (
    <fieldset className="file-diff-layout-toggle" aria-label="Diff layout">
      {(['unified', 'side-by-side'] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={layout === candidate}
          className={`file-diff-layout-toggle__button${layout === candidate ? ' file-diff-layout-toggle__button--active' : ''}`}
          onClick={() => onChangeLayout(candidate)}
        >
          {candidate === 'unified' ? 'Unified' : 'Side by side'}
        </button>
      ))}
    </fieldset>
  )
}

function UnifiedLine({ filePath, line }: { filePath: string; line: GitFileDiffLine }) {
  return (
    <div
      className={`file-diff-row file-diff-row--${line.type === 'add' ? 'added' : line.type === 'delete' ? 'removed' : 'context'}`}
    >
      <span className="file-diff-row__numbers">
        <span>{line.oldLineNumber ?? ''}</span>
        <span>{line.newLineNumber ?? ''}</span>
      </span>
      <span className="file-diff-row__indicator">
        {line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}
      </span>
      <code className="file-diff-row__content">{renderHighlightedCode(line.value, filePath)}</code>
    </div>
  )
}

function SideCell({
  filePath,
  line,
  side,
}: {
  filePath: string
  line: GitFileDiffLine | null
  side: 'left' | 'right'
}) {
  const lineNumber = side === 'left' ? line?.oldLineNumber : line?.newLineNumber
  const tone = line?.type === 'delete' ? 'removed' : line?.type === 'add' ? 'added' : 'context'

  return (
    <div className={`file-diff-side file-diff-side--${tone}${line ? '' : ' file-diff-side--empty'}`}>
      <span className="file-diff-side__line-number">{lineNumber ?? ''}</span>
      <span className="file-diff-side__indicator">
        {line?.type === 'delete' ? '-' : line?.type === 'add' ? '+' : ' '}
      </span>
      <code className="file-diff-side__content">
        {line ? renderHighlightedCode(line.value, filePath) : null}
      </code>
    </div>
  )
}

function UnifiedVirtualRow({ filePath, row }: { filePath: string; row: UnifiedDiffRow }) {
  return row.kind === 'header' ? (
    <div className="file-diff-row file-diff-row--header">{row.header}</div>
  ) : (
    <UnifiedLine filePath={filePath} line={row.line} />
  )
}

function SideBySideVirtualRow({ filePath, row }: { filePath: string; row: SideBySideDiffRow }) {
  return row.kind === 'header' ? (
    <div className="file-diff-grid-row file-diff-row--header">{row.header}</div>
  ) : (
    <div className="file-diff-grid-row">
      <SideCell filePath={filePath} line={row.left} side="left" />
      <SideCell filePath={filePath} line={row.right} side="right" />
    </div>
  )
}

export function DiffViewer({
  diff,
  error,
  filePath = '',
  isLoading = false,
  layout,
  onChangeLayout,
}: DiffViewerProps) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const viewportRef = useCallback((element: HTMLDivElement | null) => setViewportElement(element), [])
  const { height: viewportHeight } = useResizeObserver(viewportElement)
  const [scrollTop, setScrollTop] = useState(0)
  const unifiedRows = useMemo(() => buildUnifiedDiffRows(diff?.hunks ?? []), [diff?.hunks])
  const sideBySideRows = useMemo(() => buildSideBySideDiffRows(diff?.hunks ?? []), [diff?.hunks])
  const rows = layout === 'unified' ? unifiedRows : sideBySideRows
  const visibleRange = getVirtualDiffRange({
    overscan: DIFF_ROW_OVERSCAN,
    rowCount: rows.length,
    rowHeight: DIFF_ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  })
  const visibleRows = rows.slice(visibleRange.startIndex, visibleRange.endIndex)

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

  if (diff.tooLarge) {
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState
          title="Diff too large"
          description="This diff exceeds the safe rendering limit. Use Git tooling to inspect the complete change."
        />
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
    return (
      <div className="file-diff-viewer file-diff-viewer--empty">
        <DiffEmptyState title="No changes" description="This file matches HEAD, so there is no diff to show." />
      </div>
    )
  }

  return (
    <div className={`file-diff-viewer file-diff-viewer--${layout}`}>
      <DiffLayoutToggle layout={layout} onChangeLayout={onChangeLayout} />
      <div
        ref={viewportRef}
        className="file-viewer-virtual-surface file-diff-viewer__viewport"
        data-row-count={rows.length}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="file-viewer-virtual-surface__content" style={{ height: rows.length * DIFF_ROW_HEIGHT }}>
          {visibleRows.map((row, index) => (
            <div
              key={row.key}
              className="file-viewer-virtual-surface__row"
              style={{
                height: DIFF_ROW_HEIGHT,
                transform: `translateY(${(visibleRange.startIndex + index) * DIFF_ROW_HEIGHT}px)`,
              }}
            >
              {layout === 'unified' ? (
                <UnifiedVirtualRow filePath={filePath} row={row as UnifiedDiffRow} />
              ) : (
                <SideBySideVirtualRow filePath={filePath} row={row as SideBySideDiffRow} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
