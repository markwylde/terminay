import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { FileDiffLayout, GitFileDiff, GitFileDiffLine } from '../../../types/fileViewer'
import { renderHighlightedCode } from '../codeHighlight'

type DiffViewerProps = {
  diff: GitFileDiff | null
  error?: string | null
  filePath?: string
  isLoading?: boolean
  layout?: FileDiffLayout
  onLayoutChange?: (layout: FileDiffLayout) => void
}

type DiffRenderRow =
  | { header: string; id: string; kind: 'header' }
  | { id: string; kind: 'unified'; line: GitFileDiffLine }
  | { id: string; kind: 'side-by-side'; left: GitFileDiffLine | null; right: GitFileDiffLine | null }

const DIFF_LAYOUT_STORAGE_KEY = 'terminay.fileViewer.diffLayout'
const DIFF_ROW_HEIGHT = 30
const DIFF_OVERSCAN_ROWS = 16

function readStoredLayout(fallback: FileDiffLayout): FileDiffLayout {
  try {
    const value = window.localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)
    return value === 'unified' || value === 'side-by-side' ? value : fallback
  } catch {
    return fallback
  }
}

function storeLayout(layout: FileDiffLayout): void {
  try {
    window.localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout)
  } catch {
    // Storage can be unavailable in a restricted or private renderer context.
  }
}

function normalizeRows(diff: GitFileDiff, layout: FileDiffLayout): DiffRenderRow[] {
  if (layout === 'unified') {
    return diff.hunks.flatMap((hunk, hunkIndex) => [
      { header: hunk.header, id: `hunk-${hunkIndex}`, kind: 'header' as const },
      ...hunk.lines.map((line, lineIndex) => ({ id: `hunk-${hunkIndex}-line-${lineIndex}`, kind: 'unified' as const, line })),
    ])
  }

  return diff.hunks.flatMap((hunk, hunkIndex) => {
    const rows: DiffRenderRow[] = [{ header: hunk.header, id: `hunk-${hunkIndex}`, kind: 'header' }]
    for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
      const line = hunk.lines[lineIndex]
      if (line.type === 'context') {
        rows.push({ id: `hunk-${hunkIndex}-line-${lineIndex}`, kind: 'side-by-side', left: line, right: line })
        continue
      }

      const blockStart = lineIndex
      const block: GitFileDiffLine[] = []
      while (lineIndex < hunk.lines.length && hunk.lines[lineIndex].type !== 'context') {
        block.push(hunk.lines[lineIndex])
        lineIndex += 1
      }
      lineIndex -= 1
      const removed = block.filter((entry) => entry.type === 'delete')
      const added = block.filter((entry) => entry.type === 'add')
      const rowCount = Math.max(removed.length, added.length)
      for (let pairIndex = 0; pairIndex < rowCount; pairIndex += 1) {
        rows.push({
          id: `hunk-${hunkIndex}-block-${blockStart}-pair-${pairIndex}`,
          kind: 'side-by-side',
          left: removed[pairIndex] ?? null,
          right: added[pairIndex] ?? null,
        })
      }
    }
    return rows
  })
}

function DiffEmptyState({ description, title }: { description: string; title: string }) {
  return (
    <div className="file-viewer-empty-state">
      <div className="file-viewer-empty-state__icon" aria-hidden="true">Δ</div>
      <div className="file-viewer-empty-state__title">{title}</div>
      <div className="file-viewer-empty-state__description">{description}</div>
    </div>
  )
}

function lineClass(line: GitFileDiffLine | null): string {
  if (!line) return 'file-diff-line-cell file-diff-line-cell--empty'
  return `file-diff-line-cell file-diff-line-cell--${line.type === 'add' ? 'added' : line.type === 'delete' ? 'removed' : 'context'}`
}

function LineCell({ filePath, line }: { filePath: string; line: GitFileDiffLine | null }) {
  return (
    <div className={lineClass(line)}>
      {line ? (
        <>
          <span className="file-diff-line-cell__number">{line.oldLineNumber ?? line.newLineNumber ?? ''}</span>
          <span className="file-diff-line-cell__indicator" aria-hidden="true">{line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' '}</span>
          <code className="file-diff-line-cell__content">{renderHighlightedCode(line.value, filePath)}</code>
        </>
      ) : null}
    </div>
  )
}

export function DiffViewer({ diff, error, filePath = '', isLoading = false, layout = 'side-by-side', onLayoutChange }: DiffViewerProps) {
  const [activeLayout, setActiveLayout] = useState<FileDiffLayout>(() => readStoredLayout(layout))
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const [viewportHeight, setViewportHeight] = useState(480)
  const [scrollTop, setScrollTop] = useState(0)
  const [selectedRange, setSelectedRange] = useState<{ end: number; start: number } | null>(null)
  const selectionAnchorRef = useRef<number | null>(null)

  useEffect(() => {
    if (!viewportElement) return
    const observer = new ResizeObserver(() => setViewportHeight(Math.max(1, viewportElement.clientHeight)))
    observer.observe(viewportElement)
    setViewportHeight(Math.max(1, viewportElement.clientHeight))
    return () => observer.disconnect()
  }, [viewportElement])

  const rows = useMemo(() => (diff ? normalizeRows(diff, activeLayout) : []), [activeLayout, diff])
  const firstRow = Math.max(0, Math.floor(scrollTop / DIFF_ROW_HEIGHT) - DIFF_OVERSCAN_ROWS)
  const lastRow = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / DIFF_ROW_HEIGHT) + DIFF_OVERSCAN_ROWS)

  const setDiffLayout = (nextLayout: FileDiffLayout) => {
    setActiveLayout(nextLayout)
    storeLayout(nextLayout)
    onLayoutChange?.(nextLayout)
    setSelectedRange(null)
    selectionAnchorRef.current = null
  }

  if (isLoading) {
    return <div className="file-diff-viewer file-diff-viewer--empty"><DiffEmptyState title="Loading diff" description="Fetching the latest Git diff for this file." /></div>
  }
  if (error) {
    return <div className="file-diff-viewer file-diff-viewer--empty"><DiffEmptyState title="Diff unavailable" description={error} /></div>
  }
  if (!diff?.isTracked || !diff.repositoryRoot) {
    return <div className="file-diff-viewer file-diff-viewer--empty"><DiffEmptyState title="Diff unavailable" description="This file is not tracked by Git in the current repository." /></div>
  }
  if (diff.isBinary) {
    return <div className="file-diff-viewer file-diff-viewer--empty"><DiffEmptyState title="Binary diff" description="Git reports this file as binary, so there is no text diff to display." /></div>
  }
  if (diff.hunks.length === 0) {
    const rawPatch = diff.rawPatch.trim()
    if (rawPatch.length > 0) {
      return <div className="file-diff-viewer file-diff-viewer--raw"><pre className="file-preview-text">{rawPatch}</pre></div>
    }
    return <div className="file-diff-viewer file-diff-viewer--empty"><DiffEmptyState title="No changes" description="This file matches HEAD, so there is no diff to show." /></div>
  }

  return (
    <div className={`file-diff-viewer file-diff-viewer--${activeLayout}`}>
      <div className="file-diff-layout-toggle">
        <button type="button" className={activeLayout === 'side-by-side' ? 'file-diff-layout-toggle__button file-diff-layout-toggle__button--active' : 'file-diff-layout-toggle__button'} aria-pressed={activeLayout === 'side-by-side'} onClick={() => setDiffLayout('side-by-side')}>Side-by-side</button>
        <button type="button" className={activeLayout === 'unified' ? 'file-diff-layout-toggle__button file-diff-layout-toggle__button--active' : 'file-diff-layout-toggle__button'} aria-pressed={activeLayout === 'unified'} onClick={() => setDiffLayout('unified')}>Unified</button>
      </div>
      <div ref={setViewportElement} className="file-diff-virtual-surface" data-testid="file-diff-virtual-surface" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="file-diff-virtual-surface__content" style={{ height: rows.length * DIFF_ROW_HEIGHT }}>
          {rows.slice(firstRow, lastRow).map((row, visibleIndex) => {
            const rowIndex = firstRow + visibleIndex
            const selected = selectedRange !== null && rowIndex >= selectedRange.start && rowIndex <= selectedRange.end
            const selectRow = (event: MouseEvent) => {
              const anchor = selectionAnchorRef.current
              if (event.shiftKey && anchor !== null) {
                setSelectedRange({ end: Math.max(rowIndex, anchor), start: Math.min(rowIndex, anchor) })
              } else {
                setSelectedRange({ end: rowIndex, start: rowIndex })
                selectionAnchorRef.current = rowIndex
              }
            }
            return (
              <div key={row.id} className={`file-diff-virtual-row${selected ? ' file-diff-virtual-row--selected' : ''}`} style={{ height: DIFF_ROW_HEIGHT, transform: `translateY(${rowIndex * DIFF_ROW_HEIGHT}px)` }} onClick={selectRow}>
                {row.kind === 'header' ? <div className="file-diff-row file-diff-row--header">{row.header}</div> : null}
                {row.kind === 'unified' ? (
                  <div className={`file-diff-row file-diff-row--${row.line.type === 'add' ? 'added' : row.line.type === 'delete' ? 'removed' : 'context'}`}>
                    <span className="file-diff-row__numbers"><span>{row.line.oldLineNumber ?? ''}</span><span>{row.line.newLineNumber ?? ''}</span></span>
                    <span className="file-diff-row__indicator" aria-hidden="true">{row.line.type === 'add' ? '+' : row.line.type === 'delete' ? '-' : ' '}</span>
                    <code className="file-diff-row__content">{renderHighlightedCode(row.line.value, filePath)}</code>
                  </div>
                ) : null}
                {row.kind === 'side-by-side' ? <div className="file-diff-grid-row"><LineCell filePath={filePath} line={row.left} /><LineCell filePath={filePath} line={row.right} /></div> : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
