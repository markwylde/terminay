import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { languageFromFilePath } from '../codeHighlight'
import type { FileRangeRequest, FileTextWindow, FileViewerEngine } from '../../../types/fileViewer'
import { configureFileViewerMonaco, FILE_VIEWER_THEME } from '../monacoSetup'

type TextViewerProps = {
  engine: FileViewerEngine
  filePath?: string
  fileSize?: number
  language?: string
  onChangeText: (text: string) => void
  onCurrentTextGetterChange?: (getter: (() => string) | null) => void
  onPerformantEditChange?: (isDirty: boolean) => void
  readTextWindow?: (range: FileRangeRequest) => Promise<FileTextWindow>
  text: string
}

const LARGE_FILE_THRESHOLD_BYTES = 100 * 1024 * 1024
const PERFORMANT_PAGE_LINES = 256
const PERFORMANT_ROW_HEIGHT = 22
const PERFORMANT_OVERSCAN_ROWS = 12
const ESTIMATED_BYTES_PER_LINE = 80

type TextPage = {
  lines: string[]
  text: string
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

function useElementHeight(element: HTMLDivElement | null): number {
  const [height, setHeight] = useState(480)

  useEffect(() => {
    if (!element) {
      return
    }

    const updateHeight = () => {
      setHeight(Math.max(1, element.clientHeight))
    }
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)
    updateHeight()
    return () => observer.disconnect()
  }, [element])

  return height
}

function PerformantTextViewer({
  filePath,
  fileSize,
  onCurrentTextGetterChange,
  onPerformantEditChange,
  readTextWindow,
}: Pick<
  TextViewerProps,
  'filePath' | 'fileSize' | 'onCurrentTextGetterChange' | 'onPerformantEditChange' | 'readTextWindow'
>) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const viewportHeight = useElementHeight(viewportElement)
  const [scrollTop, setScrollTop] = useState(0)
  const [pages, setPages] = useState<Map<number, TextPage>>(() => new Map())
  const [loadingPage, setLoadingPage] = useState<number | null>(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectionLength, setSelectionLength] = useState(0)
  const [estimatedBytesPerLine, setEstimatedBytesPerLine] = useState(ESTIMATED_BYTES_PER_LINE)
  const pageBytes = Math.max(1024, Math.min(64 * 1024, estimatedBytesPerLine * PERFORMANT_PAGE_LINES))
  const pageCount = Math.max(1, Math.ceil((fileSize ?? 0) / pageBytes))
  const totalHeight = pageCount * PERFORMANT_PAGE_LINES * PERFORMANT_ROW_HEIGHT
  const pageHeight = PERFORMANT_PAGE_LINES * PERFORMANT_ROW_HEIGHT
  const pageIndex = Math.min(pageCount - 1, Math.max(0, Math.floor(scrollTop / pageHeight)))
  const pageTop = pageIndex * pageHeight
  const localScrollTop = Math.max(0, scrollTop - pageTop)
  const firstRow = Math.max(0, Math.floor(localScrollTop / PERFORMANT_ROW_HEIGHT) - PERFORMANT_OVERSCAN_ROWS)
  const lastRow = Math.min(
    PERFORMANT_PAGE_LINES,
    Math.ceil((localScrollTop + viewportHeight) / PERFORMANT_ROW_HEIGHT) + PERFORMANT_OVERSCAN_ROWS,
  )
  const page = pages.get(pageIndex)
  const pageRequestRef = useRef<string | null>(null)

  useEffect(() => {
    setPages(new Map())
    setScrollTop(0)
    setSelectionLength(0)
    setLoadError(null)
    setLoadingPage(0)
    setEstimatedBytesPerLine(ESTIMATED_BYTES_PER_LINE)
    pageRequestRef.current = null
    onPerformantEditChange?.(false)
  }, [filePath, fileSize, onPerformantEditChange])

  useEffect(() => {
    onCurrentTextGetterChange?.(null)
  }, [onCurrentTextGetterChange])

  useEffect(() => {
    setSelectionLength(0)
  }, [pageIndex])

  useEffect(() => {
    if (pages.has(pageIndex) || !readTextWindow || !filePath || !fileSize) {
      setLoadingPage(null)
      return
    }

    const requestKey = `${filePath}:${pageIndex}:${pageBytes}`
    if (pageRequestRef.current === requestKey) {
      return
    }
    pageRequestRef.current = requestKey
    setLoadingPage(pageIndex)
    setLoadError(null)
    let cancelled = false
    const estimatedOffset = Math.min(Math.max(0, fileSize - 1), pageIndex * pageBytes)
    const requestOffset = estimatedOffset > 0 ? estimatedOffset - 1 : 0

    void readTextWindow({
      length: Math.min(fileSize - requestOffset, pageBytes + 1),
      offset: requestOffset,
    })
      .then((response) => {
        if (cancelled) {
          return
        }

        let nextText = response.text
        if (requestOffset > 0) {
          const firstLineEnd = nextText.search(/\r?\n/)
          nextText = firstLineEnd === -1 ? '' : nextText.slice(firstLineEnd + (nextText[firstLineEnd] === '\r' ? 2 : 1))
        }
        const rawLines = splitLines(nextText)
        if (pageIndex === 0 && rawLines.length > 1) {
          setEstimatedBytesPerLine(Math.max(8, Math.min(2048, Math.round(response.text.length / rawLines.length))))
        }
        const pageLines = rawLines.slice(0, PERFORMANT_PAGE_LINES)
        const nextPage: TextPage = {
          lines: pageLines,
          text: pageLines.join('\n'),
        }
        setPages((current) => {
          const next = new Map(current)
          next.set(pageIndex, nextPage)
          for (const key of next.keys()) {
            if (Math.abs(key - pageIndex) > 1) {
              next.delete(key)
            }
          }
          return next
        })
        setLoadingPage(null)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setLoadingPage(null)
        setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [filePath, fileSize, pageBytes, pageIndex, pages, readTextWindow])

  const updatePageText = useCallback(
    (nextText: string) => {
      const nextPage: TextPage = {
        lines: splitLines(nextText).slice(0, PERFORMANT_PAGE_LINES),
        text: nextText,
      }
      setPages((current) => {
        const next = new Map(current)
        next.set(pageIndex, nextPage)
        return next
      })
      onPerformantEditChange?.(true)
    },
    [onPerformantEditChange, pageIndex],
  )

  const visibleLines = page?.lines.slice(firstRow, lastRow) ?? []

  return (
    <div
      ref={setViewportElement}
      className="file-text-viewer file-text-viewer--performant file-text-virtual-surface"
      data-testid="file-text-performant-surface"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="file-text-virtual-surface__content" style={{ height: totalHeight }}>
        {page ? (
          <div className="file-text-virtual-page" style={{ height: pageHeight, transform: `translateY(${pageTop}px)` }}>
            <div className="file-text-virtual-page__gutter" aria-hidden="true">
              {visibleLines.map((_, index) => (
                <span
                  key={`${pageIndex}-${firstRow + index}`}
                  className="file-text-virtual-page__line-number"
                  style={{ transform: `translateY(${(firstRow + index) * PERFORMANT_ROW_HEIGHT}px)` }}
                >
                  {pageIndex * PERFORMANT_PAGE_LINES + firstRow + index + 1}
                </span>
              ))}
            </div>
            <textarea
              aria-label="Performant text editor"
              className="file-text-viewer__textarea file-text-viewer__textarea--virtual"
              spellCheck={false}
              value={page.text}
              onChange={(event) => updatePageText(event.target.value)}
              onSelect={(event) => {
                setSelectionLength(event.currentTarget.selectionEnd - event.currentTarget.selectionStart)
              }}
            />
          </div>
        ) : null}
      </div>
      {loadingPage !== null ? <div className="file-text-viewer__loading">Loading text window…</div> : null}
      {loadError ? <div className="file-text-viewer__error">Unable to load this text window: {loadError}</div> : null}
      <div className="file-text-viewer__selection" aria-live="polite">
        {selectionLength > 0 ? `Selected ${selectionLength.toLocaleString()} characters in the loaded window.` : 'Selection is limited to the loaded window.'}
      </div>
    </div>
  )
}

export function TextViewer({
  engine,
  filePath,
  fileSize,
  language,
  onChangeText,
  onCurrentTextGetterChange,
  onPerformantEditChange,
  readTextWindow,
  text,
}: TextViewerProps) {
  const monacoLanguage = useMemo(() => languageFromFilePath(filePath ?? '') ?? language, [filePath, language])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const useWindowedEngine = engine === 'performant' && (fileSize ?? 0) > LARGE_FILE_THRESHOLD_BYTES && readTextWindow

  useEffect(() => {
    return () => {
      onCurrentTextGetterChange?.(null)
    }
  }, [onCurrentTextGetterChange])

  if (useWindowedEngine) {
    return (
      <PerformantTextViewer
        filePath={filePath}
        fileSize={fileSize}
        onCurrentTextGetterChange={onCurrentTextGetterChange}
        onPerformantEditChange={onPerformantEditChange}
        readTextWindow={readTextWindow}
      />
    )
  }

  if (engine === 'performant') {
    return (
      <div className="file-text-viewer file-text-viewer--performant">
        <textarea
          ref={(element) => {
            textareaRef.current = element
            onCurrentTextGetterChange?.(element ? () => element.value : null)
          }}
          className="file-text-viewer__textarea"
          spellCheck={false}
          value={text}
          onChange={(event) => onChangeText(event.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="file-text-viewer">
      <Editor
        key={filePath ?? 'file-viewer-text'}
        height="100%"
        language={monacoLanguage}
        value={text}
        theme={FILE_VIEWER_THEME}
        beforeMount={configureFileViewerMonaco}
        onMount={(editor, monaco) => {
          configureFileViewerMonaco(monaco)
          const model = editor.getModel()
          if (model && monacoLanguage) {
            monaco.editor.setModelLanguage(model, monacoLanguage)
          }
          monaco.editor.setTheme(FILE_VIEWER_THEME)
          onCurrentTextGetterChange?.(() => editor.getValue())
          const node = editor.getDomNode()
          if (node) {
            const colorizeWhenVisible = () => {
              if (node.clientWidth === 0 || node.clientHeight === 0) return
              const model = editor.getModel()
              if (model) {
                const languageId = model.getLanguageId()
                monaco.editor.setModelLanguage(model, 'plaintext')
                monaco.editor.setModelLanguage(model, languageId)
              }
              editor.layout()
              editor.render(true)
              observer.disconnect()
            }
            const observer = new ResizeObserver(colorizeWhenVisible)
            observer.observe(node)
            editor.onDidDispose(() => observer.disconnect())
          }
        }}
        onChange={(value) => onChangeText(value ?? '')}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
        }}
      />
    </div>
  )
}
