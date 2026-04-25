import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { termideFileGateway } from '../../../services/fileViewer'
import { useResizeObserver } from '../../../hooks/useResizeObserver'

type HexViewerProps = {
  filePath: string
  fileSize: number
  onChangeByte: (offset: number, value: number) => void
  onValidationChange: (isValid: boolean) => void
}

const ROW_HEIGHT = 34
const MIN_BYTES_PER_ROW = 4
const MAX_BYTES_PER_ROW = 32

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase()
}

function toAscii(value: number): string {
  return value >= 32 && value <= 126 ? String.fromCharCode(value) : '.'
}

function isValidByteText(value: string): boolean {
  return /^[0-9a-fA-F]{2}$/.test(value)
}

export function HexViewer({ filePath, fileSize, onChangeByte, onValidationChange }: HexViewerProps) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null)
  const viewportRef = useCallback((element: HTMLDivElement | null) => {
    setViewportElement(element)
  }, [])
  const { height: viewportHeight, width: viewportWidth } = useResizeObserver(viewportElement)
  const [scrollTop, setScrollTop] = useState(0)
  const [pages, setPages] = useState<Record<number, Uint8Array>>({})
  const [editedBytes, setEditedBytes] = useState<Map<number, number>>(() => new Map())
  const [editedTexts, setEditedTexts] = useState<Map<number, string>>(() => new Map())
  const [invalidOffsets, setInvalidOffsets] = useState<Set<number>>(() => new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const failedOffsetsRef = useRef<Set<number>>(new Set())
  const invalidOffsetsRef = useRef<Set<number>>(new Set())
  const previousPageLayoutKeyRef = useRef<string | null>(null)
  const previousFilePathRef = useRef<string | null>(null)
  const bytesPerRow = useMemo(() => {
    const availableWidth = Math.max(0, viewportWidth - 142) // 110px offset + 2 * 16px gaps
    const hexPaneWidth = availableWidth * 0.75
    const asciiPaneWidth = availableWidth * 0.25
    
    // Hex pane roughly needs 38px per byte (32px content + 6px gap), ASCII needs ~9px.
    const rawCount = Math.floor(
      Math.min(
        hexPaneWidth / 38,
        asciiPaneWidth / 9,
      ),
    )
    const clamped = Math.max(MIN_BYTES_PER_ROW, Math.min(MAX_BYTES_PER_ROW, rawCount || 16))
    const snapped = Math.floor(clamped / 4) * 4
    return Math.max(MIN_BYTES_PER_ROW, snapped || MIN_BYTES_PER_ROW)
  }, [viewportWidth])
  const pageSize = bytesPerRow * 128
  const totalRows = Math.max(1, Math.ceil(fileSize / bytesPerRow))
  const pageLayoutKey = `${filePath}:${bytesPerRow}`

  useEffect(() => {
    if (previousPageLayoutKeyRef.current === pageLayoutKey) {
      return
    }

    previousPageLayoutKeyRef.current = pageLayoutKey
    setPages({})
    setScrollTop(0)
    setLoadError(null)
    failedOffsetsRef.current = new Set()
  }, [pageLayoutKey])

  useEffect(() => {
    if (previousFilePathRef.current === filePath) {
      return
    }

    previousFilePathRef.current = filePath
    setEditedBytes(new Map())
    setEditedTexts(new Map())
    invalidOffsetsRef.current = new Set()
    setInvalidOffsets(invalidOffsetsRef.current)
    onValidationChange(true)
  }, [filePath, onValidationChange])

  const updateByte = useCallback(
    (offset: number, text: string) => {
      setEditedTexts((current) => {
        const next = new Map(current)
        next.set(offset, text)
        return next
      })

      const isValid = isValidByteText(text)
      const nextInvalidOffsets = new Set(invalidOffsetsRef.current)
      if (isValid) {
        nextInvalidOffsets.delete(offset)
      } else {
        nextInvalidOffsets.add(offset)
      }
      invalidOffsetsRef.current = nextInvalidOffsets
      setInvalidOffsets(nextInvalidOffsets)
      onValidationChange(nextInvalidOffsets.size === 0)

      if (!isValid) {
        return
      }

      const value = Number.parseInt(text, 16)
      setPages((current) => {
        const pageOffset = Math.floor(offset / pageSize) * pageSize
        const page = current[pageOffset]
        if (!page) {
          return current
        }

        const pageIndex = offset - pageOffset
        if (pageIndex < 0 || pageIndex >= page.length || page[pageIndex] === value) {
          return current
        }

        const nextPage = page.slice()
        nextPage[pageIndex] = value
        return {
          ...current,
          [pageOffset]: nextPage,
        }
      })
      setEditedBytes((current) => {
        const next = new Map(current)
        next.set(offset, value)
        return next
      })
      onChangeByte(offset, value)
    },
    [onChangeByte, onValidationChange, pageSize],
  )

  const visibleRange = useMemo(() => {
    const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8)
    const endRow = Math.min(totalRows, Math.ceil((scrollTop + Math.max(viewportHeight, ROW_HEIGHT)) / ROW_HEIGHT) + 8)
    return { endRow, startRow }
  }, [scrollTop, totalRows, viewportHeight])

  useEffect(() => {
    let cancelled = false
    const requiredPageOffsets = new Set<number>()

    for (let row = visibleRange.startRow; row < visibleRange.endRow; row += 1) {
      requiredPageOffsets.add(Math.floor((row * bytesPerRow) / pageSize) * pageSize)
    }

    const missingPageOffsets = [...requiredPageOffsets].filter(
      (offset) => !pages[offset] && !failedOffsetsRef.current.has(offset),
    )
    if (missingPageOffsets.length === 0) {
      return
    }

    void Promise.all(
      missingPageOffsets.map(async (offset) => {
        const response = await termideFileGateway.readFileBytes(filePath, {
          length: Math.min(pageSize, Math.max(0, fileSize - offset)),
          offset,
        })
        return {
          bytes: Uint8Array.from(window.atob(response.base64), (character) => character.charCodeAt(0)),
          offset,
        }
      }),
    )
      .then((results) => {
        if (cancelled) {
          return
        }

        setLoadError(null)
        setPages((current) => {
          const next = { ...current }
          for (const result of results) {
            next[result.offset] = result.bytes
          }
          return next
        })
      })
      .catch((error) => {
        if (cancelled) {
          return
        }

        for (const offset of missingPageOffsets) {
          failedOffsetsRef.current.add(offset)
        }

        setLoadError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
  }, [bytesPerRow, filePath, fileSize, pageSize, pages, visibleRange.endRow, visibleRange.startRow])

  const visibleRows = useMemo(() => {
    const result: Array<{ ascii: string; offset: number; values: Array<number | null> }> = []

    for (let row = visibleRange.startRow; row < visibleRange.endRow; row += 1) {
      const offset = row * bytesPerRow
      const values: Array<number | null> = []

      for (let column = 0; column < bytesPerRow; column += 1) {
        const byteOffset = offset + column
        if (byteOffset >= fileSize) {
          values.push(null)
          continue
        }

        const pageOffset = Math.floor(byteOffset / pageSize) * pageSize
        const page = pages[pageOffset]
        const pageIndex = byteOffset - pageOffset
        values.push(editedBytes.get(byteOffset) ?? (page ? page[pageIndex] ?? null : null))
      }

      result.push({
        ascii: values.map((value) => (value === null ? ' ' : toAscii(value))).join(''),
        offset,
        values,
      })
    }

    return result
  }, [bytesPerRow, editedBytes, fileSize, pageSize, pages, visibleRange.endRow, visibleRange.startRow])

  return (
    <div className="file-hex-viewer">
      <div className="file-hex-viewer__header">
        <span>Offset</span>
        <span>HEX</span>
        <span>ASCII</span>
      </div>
      {loadError ? <div className="file-preview-unsupported">Unable to load HEX data: {loadError}</div> : null}
      <div
        ref={viewportRef}
        className="file-viewer-virtual-surface"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="file-viewer-virtual-surface__content" style={{ height: totalRows * ROW_HEIGHT }}>
          {visibleRows.map((row, index) => (
            <div
              key={row.offset}
              className="file-viewer-virtual-surface__row"
              style={{ height: ROW_HEIGHT, transform: `translateY(${(visibleRange.startRow + index) * ROW_HEIGHT}px)` }}
            >
              <div
                className="file-hex-row"
                style={
                  {
                    '--bytes-per-row': String(bytesPerRow),
                  } as React.CSSProperties
                }
              >
                <span className="file-hex-row__offset">{row.offset.toString(16).padStart(8, '0')}</span>
                <div className="file-hex-row__bytes">
                  {row.values.map((value, columnIndex) => {
                    const byteOffset = row.offset + columnIndex
                    return value === null ? (
                      <span key={byteOffset} className="file-hex-row__byte file-hex-row__byte--placeholder">--</span>
                    ) : (
                      <input
                        key={byteOffset}
                        aria-label={`Byte ${byteOffset.toString(16).padStart(8, '0')}`}
                        className={`file-hex-viewer__byte${editedBytes.has(byteOffset) ? ' file-hex-row__byte--changed' : ''}${invalidOffsets.has(byteOffset) ? ' file-hex-row__byte--invalid' : ''}`}
                        value={editedTexts.get(byteOffset) ?? toHex(value)}
                        maxLength={2}
                        pattern="[0-9a-fA-F]{1,2}"
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => updateByte(byteOffset, event.target.value)}
                      />
                    )
                  })}
                </div>
                <span className="file-hex-row__ascii">{row.ascii}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
