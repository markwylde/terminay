import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useResizeObserver } from '../../../hooks/useResizeObserver'
import type {
  FileViewerSparseFileEdit,
  FileViewerTextLine,
  FileViewerTextMetadata,
} from '../../../types/terminay'
import { applySparseEdits } from '../../../services/fileViewer/sparseProjection'
import { createLegacyFileViewerClient } from '../../../services/fileViewer/terminayFileGateway'

type PerformantTextViewerProps = {
  filePath: string
  onSparseEditChange: (owner: string, edit: FileViewerSparseFileEdit | null, lineDelta?: number) => void
  onSwitchToMonaco: () => Promise<void>
  projectRoot: string
  sparseEdits: Array<[string, FileViewerSparseFileEdit]>
  sparseLineDeltas: ReadonlyMap<string, number>
}

type TextPage = {
  end: number
  lines: FileViewerTextLine[]
  originalText: string
  page: number
  start: number
}

const ROW_HEIGHT = 28
const OVERSCAN_LINES = 16
const PAGE_LINES = 128
const MAX_CACHED_PAGES = 8
const INDEX_CONTINUATION_DELAY_MS = 16

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

function pageOwner(page: number): string {
  return `text-page:${page}`
}

function countNewlines(text: string): number {
  return text.split('\n').length - 1
}

function projectPageText(page: TextPage, sparseEdits: Array<[string, FileViewerSparseFileEdit]>): string {
  const localEdits = sparseEdits
    .map(([, edit]) => edit)
    .filter((edit) => edit.start >= page.start && edit.end <= page.end)
    .map((edit) => ({
      ...edit,
      end: edit.end - page.start,
      start: edit.start - page.start,
    }))
  if (localEdits.length === 0) {
    return page.originalText
  }
  const original = new TextEncoder().encode(page.originalText)
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(applySparseEdits(original, localEdits))
}

function toTextPage(page: number, lines: FileViewerTextLine[]): TextPage | null {
  const first = lines[0]
  const last = lines[lines.length - 1]
  if (!first || !last) {
    return null
  }

  const end = last.end + new TextEncoder().encode(last.eol).byteLength
  const originalText = lines.map((line) => `${line.text}${line.eol}`).join('')
  if (new TextEncoder().encode(originalText).byteLength !== end - first.start) {
    throw new Error('The ranged UTF-8 page does not match its original byte boundaries.')
  }
  return {
    end,
    lines,
    originalText,
    page,
    start: first.start,
  }
}

export function PerformantTextViewer({
  filePath,
  onSparseEditChange,
  onSwitchToMonaco,
  projectRoot,
  sparseEdits,
  sparseLineDeltas,
}: PerformantTextViewerProps) {
  const fileViewerClient = useMemo(() => createLegacyFileViewerClient(), [])
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const viewportRef = useCallback((element: HTMLDivElement | null) => setViewportElement(element), [])
  const { height: viewportHeight } = useResizeObserver(viewportElement)
  const [scrollTop, setScrollTop] = useState(0)
  const [metadata, setMetadata] = useState<FileViewerTextMetadata | null>(null)
  const [pages, setPages] = useState<Map<number, TextPage>>(() => new Map())
  const [error, setError] = useState<string | null>(null)
  const [isSwitchingEngine, setIsSwitchingEngine] = useState(false)
  const generationRef = useRef(0)
  const loadedPagesRef = useRef<Set<number>>(new Set())
  const loadingPagesRef = useRef<Set<number>>(new Set())
  const pageLineDeltas = useMemo(() => {
    const deltas = new Map<number, number>()
    for (const [owner, delta] of sparseLineDeltas) {
      const match = /^(?:text-page:|hex-byte:\d+:page:)(\d+)$/.exec(owner)
      if (match) {
        const page = Number(match[1])
        deltas.set(page, (deltas.get(page) ?? 0) + delta)
      }
    }
    return deltas
  }, [sparseLineDeltas])
  const totalLineDelta = useMemo(
    () => [...sparseLineDeltas.values()].reduce((total, delta) => total + delta, 0),
    [sparseLineDeltas],
  )

  const getLogicalPageStart = useCallback(
    (page: number) => {
      let line = page * PAGE_LINES
      for (const [changedPage, delta] of pageLineDeltas) {
        if (changedPage < page) {
          line += delta
        }
      }
      return line
    },
    [pageLineDeltas],
  )

  const findPageAtLogicalLine = useCallback(
    (logicalLine: number) => {
      const pageCount = Math.max(1, Math.ceil((metadata?.lineCount ?? 1) / PAGE_LINES))
      let page = Math.max(0, Math.min(pageCount - 1, Math.floor(logicalLine / PAGE_LINES)))
      while (page > 0 && getLogicalPageStart(page) > logicalLine) {
        page -= 1
      }
      while (page + 1 < pageCount && getLogicalPageStart(page + 1) <= logicalLine) {
        page += 1
      }
      return page
    },
    [getLogicalPageStart, metadata?.lineCount],
  )

  useEffect(() => {
    const generation = generationRef.current + 1
    let continuationTimer: number | null = null
    generationRef.current = generation
    setMetadata(null)
    setPages(new Map())
    setError(null)
    setScrollTop(0)
    loadedPagesRef.current = new Set()
    loadingPagesRef.current = new Set()

    const advanceIndex = () => {
      void fileViewerClient
        .getTextMetadata(filePath, projectRoot)
        .then((nextMetadata) => {
          if (generationRef.current !== generation) {
            return
          }
          setMetadata(nextMetadata)
          if (!nextMetadata.isComplete) {
            continuationTimer = window.setTimeout(advanceIndex, INDEX_CONTINUATION_DELAY_MS)
          }
        })
        .catch((reason) => {
          if (generationRef.current === generation) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        })
    }

    advanceIndex()
    return () => {
      generationRef.current += 1
      if (continuationTimer !== null) {
        window.clearTimeout(continuationTimer)
      }
    }
  }, [filePath, fileViewerClient, projectRoot])

  const visibleRange = useMemo(() => {
    const lineCount = Math.max(1, (metadata?.lineCount ?? 0) + totalLineDelta)
    const startLine = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_LINES)
    const endLine = Math.min(
      lineCount,
      Math.ceil((scrollTop + Math.max(viewportHeight, ROW_HEIGHT)) / ROW_HEIGHT) + OVERSCAN_LINES,
    )
    return { endLine, startLine }
  }, [metadata?.lineCount, scrollTop, totalLineDelta, viewportHeight])

  const visiblePages = useMemo(() => {
    if (visibleRange.endLine <= visibleRange.startLine) {
      return []
    }
    const firstPage = findPageAtLogicalLine(visibleRange.startLine)
    const finalPage = findPageAtLogicalLine(visibleRange.endLine - 1)
    return Array.from({ length: finalPage - firstPage + 1 }, (_, index) => firstPage + index)
  }, [findPageAtLogicalLine, visibleRange.endLine, visibleRange.startLine])

  useEffect(() => {
    if (!metadata || visiblePages.length === 0) {
      return
    }

    const generation = generationRef.current
    const missingPages = visiblePages.filter(
      (page) => !loadedPagesRef.current.has(page) && !loadingPagesRef.current.has(page),
    )
    for (const page of missingPages) {
      loadingPagesRef.current.add(page)
      void fileViewerClient
        .readTextLines(filePath, projectRoot, page * PAGE_LINES, PAGE_LINES)
        .then((result) => {
          if (generationRef.current !== generation) {
            return
          }
          const nextPage = toTextPage(page, [...result.lines])
          loadedPagesRef.current.add(page)
          if (!nextPage) {
            return
          }
          setPages((current) => {
            const next = new Map(current)
            next.set(page, nextPage)
            const nearestPage = visiblePages[0]
            const retained = [...loadedPagesRef.current].sort(
              (left, right) => Math.abs(left - nearestPage) - Math.abs(right - nearestPage),
            )
            for (const pageToRemove of retained.slice(MAX_CACHED_PAGES)) {
              loadedPagesRef.current.delete(pageToRemove)
              next.delete(pageToRemove)
            }
            return next
          })
          setError(null)
        })
        .catch((reason) => {
          if (generationRef.current === generation) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }
        })
        .finally(() => {
          loadingPagesRef.current.delete(page)
        })
    }
  }, [filePath, fileViewerClient, metadata, projectRoot, visiblePages])

  if (error && !metadata) {
    return <div className="file-preview-unsupported">Unable to open Performant text mode: {error}</div>
  }

  if (!metadata) {
    return <div className="file-panel file-panel--loading">Indexing text file…</div>
  }

  return (
    <div className="file-performant-text-viewer">
      <div className="file-performant-text-viewer__toolbar">
        <span>
          {(metadata.lineCount + totalLineDelta).toLocaleString()} lines
          {metadata.isComplete
            ? ''
            : ` discovered · indexing ${Math.floor((metadata.indexedByteLength / Math.max(1, metadata.size)) * 100)}%`}
          {' · ranged UTF-8'}
        </span>
        <button
          type="button"
          disabled={isSwitchingEngine}
          onClick={() => {
            setIsSwitchingEngine(true)
            void onSwitchToMonaco().finally(() => setIsSwitchingEngine(false))
          }}
        >
          {isSwitchingEngine ? 'Preparing draft…' : 'Switch to Monaco'}
        </button>
      </div>
      {error ? <div className="file-toolbar__fallback">{error}</div> : null}
      <div
        ref={viewportRef}
        className="file-viewer-virtual-surface file-performant-text-viewer__viewport"
        data-line-count={metadata.lineCount + totalLineDelta}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="file-viewer-virtual-surface__content"
          style={{ height: Math.max(1, metadata.lineCount + totalLineDelta) * ROW_HEIGHT }}
        >
          {visiblePages.map((pageNumber) => {
            const page = pages.get(pageNumber)
            const logicalPageStart = getLogicalPageStart(pageNumber)
            const firstLineNumber = logicalPageStart + 1
            const originalPageLineCount = Math.max(
              1,
              Math.min(PAGE_LINES, metadata.lineCount - pageNumber * PAGE_LINES),
            )
            const pageLineDelta = pageLineDeltas.get(pageNumber) ?? 0
            const height = Math.max(1, originalPageLineCount + pageLineDelta) * ROW_HEIGHT
            const value = page ? projectPageText(page, sparseEdits) : ''
            const visibleLineCount = Math.max(1, value.split('\n').length - (value.endsWith('\n') ? 1 : 0))
            const lastLineNumber = firstLineNumber + visibleLineCount - 1

            return (
              <div
                key={pageNumber}
                className="file-performant-text-page"
                style={{
                  height,
                  transform: `translateY(${logicalPageStart * ROW_HEIGHT}px)`,
                }}
              >
                {page ? (
                  <>
                    <div className="file-performant-text-page__numbers" aria-hidden="true">
                      {Array.from({ length: visibleLineCount }, (_, index) => (
                        <span key={index}>{firstLineNumber + index}</span>
                      ))}
                    </div>
                    <textarea
                      aria-label={`Lines ${firstLineNumber}–${lastLineNumber}`}
                      className="file-performant-text-page__editor"
                      spellCheck={false}
                      value={value}
                      wrap="off"
                      onChange={(event) => {
                        const nextText = event.target.value
                        if (nextText === page.originalText) {
                          onSparseEditChange(pageOwner(pageNumber), null)
                        } else {
                          onSparseEditChange(
                            pageOwner(pageNumber),
                            {
                              dataBase64: encodeBase64(nextText),
                              end: page.end,
                              start: page.start,
                            },
                            countNewlines(nextText) - countNewlines(page.originalText),
                          )
                        }
                      }}
                    />
                  </>
                ) : (
                  <span className="file-performant-text-page__loading">
                    Loading lines {firstLineNumber.toLocaleString()}–{lastLineNumber.toLocaleString()}…
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
