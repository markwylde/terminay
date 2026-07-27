import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import {
  Check,
  ChevronUp,
  ExternalLink,
  Pause,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { buildTerminalOptions, defaultTerminalSettings, resolveTerminalTheme } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalSettings, TerminalThemeSettings } from '../types/settings'
import type { TerminalRecordingListItem } from '../types/terminay'
import {
  advanceReplayCursor,
  buildReplayIndex,
  restoreReplayCursor,
  type ReplayCursor,
  type ReplayIndex,
} from '../recordingReplay'
import { createLegacyRecordingsClient, toLegacyRecordingMetadata } from '../services/recordings/legacyRecordingsClient'
import '../settings.css'
import '../recordings.css'

type ElementSize = {
  height: number
  width: number
}

type ReplayScaleMode = 'actual' | 'custom' | 'fit'
type ReplayThemeMode = 'current' | 'recorded'

const MIN_SCALE = 0.01
const MAX_SCALE = 2
const TERMINAL_STAGE_BORDER_SIZE = 2
const ZOOM_PRESETS = [
  { label: 'Fit', value: 'fit' },
  { label: '50%', value: '50' },
  { label: '75%', value: '75' },
  { label: '100%', value: '100' },
  { label: '125%', value: '125' },
  { label: '150%', value: '150' },
  { label: '200%', value: '200' },
]

function formatZoomScale(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

function parseZoomValue(value: string): number | 'fit' | null {
  const trimmedValue = value.trim()
  if (trimmedValue.length === 0) {
    return null
  }

  if (/^fit$/i.test(trimmedValue)) {
    return 'fit'
  }

  if (/x$/i.test(trimmedValue)) {
    const multiplierValue = Number.parseFloat(trimmedValue.replace(/x$/i, ''))
    if (!Number.isFinite(multiplierValue) || multiplierValue <= 0) {
      return null
    }

    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, multiplierValue))
  }

  const numericValue = Number.parseFloat(trimmedValue.replace(/%$/, ''))
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, numericValue / 100))
}

function formatDate(value: string | null): string {
  if (!value) {
    return 'Unknown'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDuration(ms: number | null): string {
  if (typeof ms !== 'number') {
    return 'Unknown'
  }

  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = Math.floor(safeSeconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function getRecordingDisplayTitle(recording: TerminalRecordingListItem): string {
  return recording.projectTitle ? `${recording.projectTitle} > ${recording.title}` : recording.title
}

function getRecordingTabColor(recording: TerminalRecordingListItem | null): string | undefined {
  if (!recording) {
    return undefined
  }
  return recording.color ?? recording.projectColor ?? undefined
}

type SelectDropupOption = {
  disabled?: boolean
  label: string
  title?: string
  value: string
}

type SelectDropupProps = {
  allowManualInput?: boolean
  ariaLabel: string
  className?: string
  disabled: boolean
  displayValue?: string
  icon?: ReactNode
  inputMode?: 'decimal' | 'numeric' | 'text'
  menuLabel: string
  onChange: (value: string) => void
  onManualInputCommit?: (value: string) => string | null
  options: SelectDropupOption[]
  value: string
}

function SelectDropup({
  allowManualInput = false,
  ariaLabel,
  className,
  disabled,
  displayValue: providedDisplayValue,
  icon,
  inputMode = 'text',
  menuLabel,
  onChange,
  onManualInputCommit,
  options,
  value,
}: SelectDropupProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const selectedOption = options.find((option) => option.value === value)
  const displayValue = providedDisplayValue ?? selectedOption?.label ?? value

  useEffect(() => {
    setDraftValue(displayValue)
  }, [displayValue])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
        setDraftValue(displayValue)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [displayValue, isOpen])

  const commitManualValue = (nextValue = draftValue) => {
    if (!allowManualInput) {
      return
    }

    const nextDisplayValue = onManualInputCommit?.(nextValue) ?? displayValue
    setDraftValue(nextDisplayValue)
    setIsOpen(false)
  }

  const selectValue = (nextValue: string) => {
    onChange(nextValue)
    const nextOption = options.find((option) => option.value === nextValue)
    setDraftValue(nextOption?.label ?? nextValue)
    setIsOpen(false)
  }

  return (
    <div className={`recordings-select${className ? ` ${className}` : ''}`} ref={rootRef}>
      <div className="recordings-select-control">
        {icon ? <span className="recordings-select-icon">{icon}</span> : null}
        {allowManualInput ? (
          <input
            aria-label={ariaLabel}
            className="recordings-select-input"
            disabled={disabled}
            inputMode={inputMode}
            onBlur={(event) => commitManualValue(event.currentTarget.value)}
            onChange={(event) => {
              setDraftValue(event.target.value)
              setIsOpen(true)
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitManualValue(event.currentTarget.value)
              } else if (event.key === 'Escape') {
                setDraftValue(displayValue)
                setIsOpen(false)
                event.currentTarget.blur()
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                setIsOpen(true)
              }
            }}
            value={draftValue}
          />
        ) : (
          <button
            type="button"
            aria-label={ariaLabel}
            aria-expanded={isOpen}
            className="recordings-select-value"
            disabled={disabled}
            onClick={() => setIsOpen((current) => !current)}
            title={selectedOption?.title}
          >
            <span>{displayValue}</span>
          </button>
        )}
        <button
          type="button"
          className="recordings-select-caret"
          aria-label={menuLabel}
          aria-expanded={isOpen}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setIsOpen((current) => !current)}
        >
          <ChevronUp size={14} />
        </button>
      </div>
      {isOpen && !disabled ? (
        <div className="recordings-select-menu" role="listbox" aria-label={menuLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="recordings-select-option"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectValue(option.value)}
              title={option.title}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function buildReplayTerminalOptions(settings: TerminalSettings, theme: TerminalThemeSettings) {
  const options = buildTerminalOptions(settings)
  return {
    ...options,
    theme,
  }
}

type ReplayMouseEventCoordinates = {
  clientX: number
  clientY: number
}

type XtermMouseService = {
  getCoords: (
    event: ReplayMouseEventCoordinates,
    element: HTMLElement,
    colCount: number,
    rowCount: number,
    isSelection?: boolean,
  ) => [number, number] | undefined
  getMouseReportCoords?: (
    event: ReplayMouseEventCoordinates,
    element: HTMLElement,
  ) => { col: number; row: number; x: number; y: number } | undefined
}

type XtermTerminalWithMouseService = Terminal & {
  _core?: {
    _mouseService?: XtermMouseService
  }
}

function scaleReplayMouseEvent(
  event: ReplayMouseEventCoordinates,
  element: HTMLElement,
  scale: number,
): ReplayMouseEventCoordinates {
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.001) {
    return event
  }

  const rect = element.getBoundingClientRect()
  return {
    clientX: rect.left + (event.clientX - rect.left) / scale,
    clientY: rect.top + (event.clientY - rect.top) / scale,
  }
}

function patchReplayTerminalMouseCoordinates(terminal: Terminal, getScale: () => number): () => void {
  const mouseService = (terminal as XtermTerminalWithMouseService)._core?._mouseService
  if (!mouseService) {
    return () => {}
  }

  const originalGetCoords = mouseService.getCoords.bind(mouseService)
  const originalGetMouseReportCoords = mouseService.getMouseReportCoords?.bind(mouseService)

  mouseService.getCoords = (event, element, colCount, rowCount, isSelection) =>
    originalGetCoords(scaleReplayMouseEvent(event, element, getScale()), element, colCount, rowCount, isSelection)

  if (originalGetMouseReportCoords) {
    mouseService.getMouseReportCoords = (event, element) =>
      originalGetMouseReportCoords(scaleReplayMouseEvent(event, element, getScale()), element)
  }

  return () => {
    mouseService.getCoords = originalGetCoords
    if (originalGetMouseReportCoords) {
      mouseService.getMouseReportCoords = originalGetMouseReportCoords
    }
  }
}

function readPixels(value: string): number {
  const pixels = Number.parseFloat(value)
  return Number.isFinite(pixels) ? pixels : 0
}

function measureReplayTerminal(root: HTMLElement): ElementSize {
  const rootStyle = window.getComputedStyle(root)
  const horizontalPadding = readPixels(rootStyle.paddingLeft) + readPixels(rootStyle.paddingRight)
  const verticalPadding = readPixels(rootStyle.paddingTop) + readPixels(rootStyle.paddingBottom)
  const screen = root.querySelector<HTMLElement>('.xterm-screen')
  const rows = root.querySelector<HTMLElement>('.xterm-rows')
  const canvases = Array.from(root.querySelectorAll<HTMLCanvasElement>('.xterm-screen canvas'))
  const canvasWidth = Math.max(
    0,
    ...canvases.map((canvas) => Math.max(canvas.offsetWidth, canvas.scrollWidth, readPixels(canvas.style.width))),
  )
  const canvasHeight = Math.max(
    0,
    ...canvases.map((canvas) => Math.max(canvas.offsetHeight, canvas.scrollHeight, readPixels(canvas.style.height))),
  )

  const contentWidth = Math.max(
    1,
    screen?.offsetWidth ?? 0,
    screen?.scrollWidth ?? 0,
    readPixels(screen?.style.width ?? ''),
    rows?.offsetWidth ?? 0,
    rows?.scrollWidth ?? 0,
    canvasWidth,
  )
  const contentHeight = Math.max(
    1,
    screen?.offsetHeight ?? 0,
    screen?.scrollHeight ?? 0,
    readPixels(screen?.style.height ?? ''),
    rows?.offsetHeight ?? 0,
    rows?.scrollHeight ?? 0,
    canvasHeight,
  )

  return {
    height: Math.ceil(contentHeight + verticalPadding),
    width: Math.ceil(contentWidth + horizontalPadding),
  }
}

export function RecordingsWindow() {
  const { settings } = useTerminalSettings()
  const recordingsClient = useMemo(() => createLegacyRecordingsClient(), [])
  const readRecordingChunk = useCallback(
    (request: { recordingId: string; start?: number; maxBytes?: number }) => recordingsClient.replay(request.recordingId, request),
    [recordingsClient],
  )
  const terminalViewportRef = useRef<HTMLDivElement | null>(null)
  const terminalRootRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const indexAbortRef = useRef<AbortController | null>(null)
  const playStartedAtRef = useRef(0)
  const playOffsetRef = useRef(0)
  const playbackAbortRef = useRef<AbortController | null>(null)
  const replayCursorRef = useRef<ReplayCursor | null>(null)
  const replayIndexRef = useRef<ReplayIndex | null>(null)
  const seekAbortRef = useRef<AbortController | null>(null)
  const playheadRef = useRef(0)
  const displayScaleRef = useRef(1)
  const measureFrameRef = useRef<number | null>(null)
  const [recordings, setRecordings] = useState<TerminalRecordingListItem[]>([])
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null)
  const [replayIndex, setReplayIndex] = useState<ReplayIndex | null>(null)
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isReplayLoading, setIsReplayLoading] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [replayWarning, setReplayWarning] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [scaleMode, setScaleMode] = useState<ReplayScaleMode>('fit')
  const [themeMode, setThemeMode] = useState<ReplayThemeMode>('recorded')
  const [customScale, setCustomScale] = useState(1)
  const [terminalSize, setTerminalSize] = useState<ElementSize>({ height: 1, width: 1 })
  const [viewportSize, setViewportSize] = useState<ElementSize>({ height: 1, width: 1 })
  const selectedRecording = recordings.find((recording) => recording.recordingId === selectedRecordingId) ?? null

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  const measureTerminal = useCallback(() => {
    if (measureFrameRef.current !== null) {
      return
    }

    measureFrameRef.current = window.requestAnimationFrame(() => {
      measureFrameRef.current = null
      const terminalElement = terminalRootRef.current
      if (!terminalElement) {
        return
      }

      const nextSize = measureReplayTerminal(terminalElement)

      setTerminalSize((current) => {
        if (current.height === nextSize.height && current.width === nextSize.width) {
          return current
        }

        return nextSize
      })
    })
  }, [])

  useEffect(() => {
    return () => {
      if (measureFrameRef.current !== null) {
        window.cancelAnimationFrame(measureFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const viewport = terminalViewportRef.current
    if (!viewport) {
      return
    }

    const updateViewportSize = () => {
      const nextSize = {
        height: Math.max(1, viewport.clientHeight),
        width: Math.max(1, viewport.clientWidth),
      }

      setViewportSize((current) => {
        if (current.height === nextSize.height && current.width === nextSize.width) {
          return current
        }

        return nextSize
      })
    }

    updateViewportSize()
    const resizeObserver = new ResizeObserver(updateViewportSize)
    resizeObserver.observe(viewport)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  const fitScale = useMemo(() => {
    const availableWidth = Math.max(1, viewportSize.width - TERMINAL_STAGE_BORDER_SIZE)
    const availableHeight = Math.max(1, viewportSize.height - TERMINAL_STAGE_BORDER_SIZE)
    return Math.min(1, availableWidth / terminalSize.width, availableHeight / terminalSize.height)
  }, [terminalSize.height, terminalSize.width, viewportSize.height, viewportSize.width])

  const displayScale = scaleMode === 'fit' ? fitScale : scaleMode === 'actual' ? 1 : customScale
  displayScaleRef.current = displayScale
  const renderedTerminalSize = useMemo(
    () => ({
      height: Math.max(1, Math.ceil(terminalSize.height * displayScale)),
      width: Math.max(1, Math.ceil(terminalSize.width * displayScale)),
    }),
    [displayScale, terminalSize.height, terminalSize.width],
  )
  const recordedTheme = selectedRecording?.theme ?? null
  const canUseRecordedTheme = recordedTheme !== null
  const replayThemeMode = themeMode === 'recorded' && canUseRecordedTheme ? 'recorded' : 'current'
  const zoomValue = scaleMode === 'fit' ? 'fit' : String(Math.round(displayScale * 100))
  const paletteOptions = useMemo<SelectDropupOption[]>(
    () => [
      {
        disabled: !canUseRecordedTheme,
        label: 'Recorded',
        title: canUseRecordedTheme ? 'Use the theme saved with this recording' : 'This recording has no saved theme',
        value: 'recorded',
      },
      {
        label: 'Current',
        title: 'Use your current settings theme',
        value: 'current',
      },
    ],
    [canUseRecordedTheme],
  )
  const replayTheme = useMemo(() => {
    if (replayThemeMode === 'recorded' && recordedTheme) {
      return recordedTheme
    }

    return resolveTerminalTheme(settings ?? defaultTerminalSettings, getRecordingTabColor(selectedRecording))
  }, [recordedTheme, replayThemeMode, selectedRecording, settings])

  const loadRecordings = useCallback(async () => {
    setIsLoading(true)
    setErrorText(null)
    try {
      const nextRecordings = (await recordingsClient.list()).items.map(toLegacyRecordingMetadata)
      setRecordings(nextRecordings)
      setSelectedRecordingId((current) =>
        current && nextRecordings.some((recording) => recording.recordingId === current)
          ? current
          : nextRecordings[0]?.recordingId ?? null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }, [recordingsClient])

  useEffect(() => {
    void loadRecordings()
  }, [loadRecordings])

  const seekToTime = useCallback(async (time: number) => {
    const terminal = terminalRef.current
    const index = replayIndexRef.current
    if (!terminal || !index) {
      return false
    }

    seekAbortRef.current?.abort()
    playbackAbortRef.current?.abort()
    const controller = new AbortController()
    seekAbortRef.current = controller
    setErrorText(null)
    try {
      replayCursorRef.current = await restoreReplayCursor(
        index,
        time,
        terminal,
        readRecordingChunk,
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setPlayhead(Math.max(0, Math.min(time, index.duration)))
        measureTerminal()
        return true
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setErrorText(error instanceof Error ? error.message : String(error))
      }
    }
    return false
  }, [measureTerminal, readRecordingChunk])

  useEffect(() => {
    const root = terminalRootRef.current
    if (!root) {
      return
    }

    setIsPlaying(false)
    root.innerHTML = ''
    const terminal = new Terminal({
      ...buildReplayTerminalOptions(settings ?? defaultTerminalSettings, replayTheme),
      allowProposedApi: true,
      cols: replayIndexRef.current?.cols ?? 80,
      disableStdin: false,
      rows: replayIndexRef.current?.rows ?? 24,
    })
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.open(root)
    const restoreMouseCoordinates = patchReplayTerminalMouseCoordinates(terminal, () => displayScaleRef.current)
    terminal.attachCustomKeyEventHandler(() => false)
    terminal.focus()
    terminalRef.current = terminal
    const resizeObserver = new ResizeObserver(measureTerminal)
    resizeObserver.observe(root)
    if (terminal.element) {
      resizeObserver.observe(terminal.element)
    }
    const screen = root.querySelector<HTMLElement>('.xterm-screen')
    if (screen) {
      resizeObserver.observe(screen)
    }
    measureTerminal()

    window.requestAnimationFrame(() => {
      if (replayIndexRef.current) {
        void seekToTime(playheadRef.current)
        terminal.focus()
      }
      measureTerminal()
    })

    return () => {
      resizeObserver.disconnect()
      seekAbortRef.current?.abort()
      playbackAbortRef.current?.abort()
      restoreMouseCoordinates()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [measureTerminal, replayTheme, seekToTime, settings])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const options = buildReplayTerminalOptions(settings ?? defaultTerminalSettings, replayTheme)
    terminal.options.cursorBlink = options.cursorBlink
    terminal.options.cursorStyle = options.cursorStyle
    terminal.options.fontFamily = options.fontFamily
    terminal.options.fontSize = options.fontSize
    terminal.options.fontWeight = options.fontWeight
    terminal.options.fontWeightBold = options.fontWeightBold
    terminal.options.letterSpacing = options.letterSpacing
    terminal.options.lineHeight = options.lineHeight
    terminal.options.theme = options.theme
    terminal.refresh(0, terminal.rows - 1)
    measureTerminal()
  }, [measureTerminal, replayTheme, settings])

  useEffect(() => {
    const recordingId = selectedRecording?.recordingId
    indexAbortRef.current?.abort()
    seekAbortRef.current?.abort()
    playbackAbortRef.current?.abort()
    setIsPlaying(false)
    setPlayhead(0)
    setReplayWarning(null)
    replayCursorRef.current = null
    replayIndexRef.current = null
    setReplayIndex(null)
    terminalRef.current?.reset()
    if (!recordingId) {
      return
    }

    const controller = new AbortController()
    indexAbortRef.current = controller
    setErrorText(null)
    setIsReplayLoading(true)
    void buildReplayIndex(recordingId, readRecordingChunk, controller.signal)
      .then(async (index) => {
        if (controller.signal.aborted) {
          return
        }
        replayIndexRef.current = index
        setReplayIndex(index)
        const warnings = [
          index.malformedRecordCount > 0
            ? `${index.malformedRecordCount} malformed replay record${index.malformedRecordCount === 1 ? ' was' : 's were'} skipped.`
            : null,
          index.truncatedTail ? 'The recording ends with an incomplete record; the valid prefix remains playable.' : null,
        ].filter(Boolean)
        setReplayWarning(warnings.join(' ') || null)
        setScaleMode('fit')
        await seekToTime(0)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setErrorText(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsReplayLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [readRecordingChunk, seekToTime, selectedRecording?.recordingId])

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    stopAnimation()
    playbackAbortRef.current?.abort()
    if (!isPlaying || !replayIndex) {
      return
    }

    const controller = new AbortController()
    playbackAbortRef.current = controller
    let advancing = false
    playStartedAtRef.current = performance.now()
    playOffsetRef.current = playheadRef.current

    const tickPlayback = () => {
      if (controller.signal.aborted) {
        return
      }
      if (advancing) {
        animationFrameRef.current = window.requestAnimationFrame(tickPlayback)
        return
      }
      const terminal = terminalRef.current
      const cursor = replayCursorRef.current
      if (!terminal || !cursor) {
        setIsPlaying(false)
        return
      }

      const elapsed = playOffsetRef.current + ((performance.now() - playStartedAtRef.current) / 1000) * speed
      const nextTime = Math.min(elapsed, replayIndex.duration)
      advancing = true
      void advanceReplayCursor(
        cursor,
        nextTime,
        terminal,
        readRecordingChunk,
        controller.signal,
      )
        .then(() => {
          if (controller.signal.aborted) {
            return
          }
          setPlayhead(nextTime)
          measureTerminal()
          if (nextTime >= replayIndex.duration) {
            setIsPlaying(false)
            return
          }
          animationFrameRef.current = window.requestAnimationFrame(tickPlayback)
        })
        .catch((error) => {
          if (!controller.signal.aborted) {
            setErrorText(error instanceof Error ? error.message : String(error))
            setIsPlaying(false)
          }
        })
        .finally(() => {
          advancing = false
        })
    }

    animationFrameRef.current = window.requestAnimationFrame(tickPlayback)
    return () => {
      controller.abort()
      stopAnimation()
    }
  }, [isPlaying, measureTerminal, readRecordingChunk, replayIndex, speed, stopAnimation])

  const filteredRecordings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return recordings
    }

    return recordings.filter((recording) =>
      [
        recording.title,
        recording.projectTitle,
        getRecordingDisplayTitle(recording),
        recording.cwdLabel,
        recording.shellName,
        recording.startedAt,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    )
  }, [query, recordings])

  const groupedRecordings = useMemo(() => {
    const groups = new Map<string, TerminalRecordingListItem[]>()
    for (const recording of filteredRecordings) {
      const key = recording.startedAt.slice(0, 10) || 'Unknown'
      const items = groups.get(key) ?? []
      items.push(recording)
      groups.set(key, items)
    }
    return [...groups.entries()]
  }, [filteredRecordings])

  const onTogglePlay = () => {
    if (!replayIndex || isReplayLoading) {
      return
    }
    if (isPlaying) {
      setIsPlaying(false)
      return
    }
    if (playhead >= replayIndex.duration) {
      void seekToTime(0).then((restored) => {
        if (restored) {
          setIsPlaying(true)
        }
      })
      return
    }
    setIsPlaying(true)
  }

  const onRestart = () => {
    setIsPlaying(false)
    setPlayhead(0)
    void seekToTime(0)
  }

  const onScrub = (value: number) => {
    setIsPlaying(false)
    setPlayhead(value)
    void seekToTime(value)
  }

  const updateCustomScale = (nextScale: number) => {
    const normalizedScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
    setCustomScale(normalizedScale)
    if (normalizedScale === 1) {
      setScaleMode('actual')
      return
    }

    setScaleMode('custom')
  }

  const onZoomPresetChange = (value: string) => {
    if (value === 'fit') {
      setScaleMode('fit')
      return
    }

    updateCustomScale(Number(value) / 100)
  }

  const onZoomManualInputCommit = (value: string): string => {
    const parsedValue = parseZoomValue(value)
    if (parsedValue === 'fit') {
      setScaleMode('fit')
      return 'Fit'
    }

    if (typeof parsedValue === 'number') {
      updateCustomScale(parsedValue)
      return formatZoomScale(parsedValue)
    }

    return scaleMode === 'fit' ? 'Fit' : formatZoomScale(displayScale)
  }

  const onToggleFitActual = () => {
    if (scaleMode === 'fit') {
      setScaleMode('actual')
      window.requestAnimationFrame(() => {
        terminalViewportRef.current?.scrollTo({ left: 0, top: 0 })
      })
      return
    }

    setScaleMode('fit')
    window.requestAnimationFrame(() => {
      terminalViewportRef.current?.scrollTo({ left: 0, top: 0 })
    })
  }

  const onDelete = async () => {
    if (!selectedRecordingId || !confirm('Delete this recording?')) {
      return
    }

    if (!selectedRecording) {
      return
    }
    await recordingsClient.delete(selectedRecording.recordingId)
    setSelectedRecordingId(null)
    setReplayIndex(null)
    replayIndexRef.current = null
    replayCursorRef.current = null
    await loadRecordings()
  }

  return (
    <div className="recordings-window">
      <aside className="recordings-sidebar">
        <header className="recordings-header">
          <div>
            <h1>Recordings</h1>
            <p>{recordings.length} saved session{recordings.length === 1 ? '' : 's'}</p>
          </div>
          <button type="button" className="recordings-icon-button" onClick={() => void loadRecordings()} aria-label="Refresh recordings">
            <RefreshCw size={16} />
          </button>
        </header>
        <label className="recordings-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recordings" />
        </label>
        <div className="recordings-list">
          {isLoading ? <div className="recordings-empty">Loading recordings...</div> : null}
          {!isLoading && groupedRecordings.length === 0 ? <div className="recordings-empty">No recordings found.</div> : null}
          {groupedRecordings.map(([date, items]) => (
            <section key={date} className="recordings-group">
              <h2>{date}</h2>
              {items.map((recording) => (
                <button
                  key={recording.recordingId}
                  type="button"
                  className={`recordings-list-item${recording.recordingId === selectedRecordingId ? ' recordings-list-item--selected' : ''}`}
                  onClick={() => setSelectedRecordingId(recording.recordingId)}
                >
                  <span className="recordings-list-item__title">{getRecordingDisplayTitle(recording)}</span>
                  <span className="recordings-list-item__meta">
                    {(recording.cwdLabel ?? 'Unknown folder')} · {formatDuration(recording.durationMs)}
                  </span>
                  <span className={`recordings-list-item__state recordings-list-item__state--${recording.recordingState}`}>
                    {recording.recordingState}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>
      <main className="recordings-main">
        {errorText ? <div className="recordings-error" role="alert">{errorText}</div> : null}
        {isReplayLoading ? <div className="recordings-empty" role="status">Preparing replay…</div> : null}
        {replayWarning ? <div className="recordings-warning" role="status">{replayWarning}</div> : null}
        <header className="recordings-detail-header">
          <div>
            <h2>{selectedRecording ? getRecordingDisplayTitle(selectedRecording) : replayIndex?.title ?? 'Select a recording'}</h2>
            <p>
              {selectedRecording ? `${formatDate(selectedRecording.startedAt)} · ${selectedRecording.cwdLabel ?? 'Unknown folder'}` : 'Choose a saved session to replay it.'}
            </p>
            {selectedRecording ? (
              <p className="recordings-detail-path">
                {selectedRecording.recordingState} · exit {selectedRecording.exitCode ?? 'unknown'} · {formatBytes(selectedRecording.bytesWritten)}
              </p>
            ) : null}
          </div>
          {selectedRecording ? (
            <div className="recordings-actions">
              <button
                type="button"
                className="recordings-secondary-button"
                onClick={() => void recordingsClient.reveal(selectedRecording.recordingId)}
              >
                <ExternalLink size={15} />
                Reveal
              </button>
              <button type="button" className="recordings-secondary-button recordings-secondary-button--danger" onClick={() => void onDelete()}>
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          ) : null}
        </header>
        <div
          className={`recordings-terminal-shell recordings-terminal-shell--${scaleMode}`}
          ref={terminalViewportRef}
          onDoubleClick={onToggleFitActual}
        >
          <div
            className="recordings-terminal-stage"
            style={{
              height: renderedTerminalSize.height + TERMINAL_STAGE_BORDER_SIZE,
              width: renderedTerminalSize.width + TERMINAL_STAGE_BORDER_SIZE,
            }}
          >
            <div
              className="recordings-terminal"
              ref={terminalRootRef}
              style={{
                background: replayTheme.background,
                height: terminalSize.height,
                transform: `scale(${displayScale})`,
                transformOrigin: 'top left',
                width: terminalSize.width,
              }}
            />
          </div>
        </div>
        <footer className="recordings-controls-container">
          <div
            className="recordings-timeline"
            style={
              {
                '--progress': `${replayIndex?.duration ? (Math.min(playhead, replayIndex.duration) / replayIndex.duration) * 100 : 0}%`,
              } as React.CSSProperties
            }
          >
            <input
              className="recordings-range"
              type="range"
              min={0}
              max={replayIndex?.duration ?? 0}
              step={0.1}
              value={Math.min(playhead, replayIndex?.duration ?? 0)}
              onChange={(event) => onScrub(Number(event.target.value))}
              disabled={!replayIndex || isReplayLoading}
            />
          </div>
          <div className="recordings-controls">
            <div className="recordings-controls-left">
              <button
                type="button"
                className="recordings-control-button"
                onClick={onTogglePlay}
                disabled={!replayIndex || isReplayLoading}
                aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={20} fill="currentColor" color="currentColor" /> : <Play size={20} className="recordings-play-icon" fill="currentColor" color="currentColor" />}
              </button>
              <button type="button" className="recordings-control-button" onClick={onRestart} disabled={!replayIndex || isReplayLoading} aria-label="Restart replay" title="Restart">
                <RotateCcw size={16} />
              </button>
              <div className="recordings-time">
                {formatPlaybackTime(playhead)} / {formatPlaybackTime(replayIndex?.duration ?? 0)}
              </div>
            </div>

            <div className="recordings-controls-right">
              <SelectDropup
                allowManualInput
                ariaLabel="Replay zoom"
                className="recordings-select--zoom"
                disabled={!replayIndex || isReplayLoading}
                displayValue={scaleMode === 'fit' ? 'Fit' : formatZoomScale(displayScale)}
                inputMode="decimal"
                menuLabel="Zoom presets"
                onChange={onZoomPresetChange}
                onManualInputCommit={onZoomManualInputCommit}
                options={ZOOM_PRESETS}
                value={zoomValue}
              />
              <SelectDropup
                ariaLabel="Replay palette"
                className="recordings-select--palette"
                disabled={!replayIndex || isReplayLoading}
                icon={<Palette size={15} />}
                menuLabel="Palette choices"
                onChange={(value) => setThemeMode(value as ReplayThemeMode)}
                options={paletteOptions}
                value={replayThemeMode}
              />
              <SelectDropup
                ariaLabel="Playback speed"
                className="recordings-select--speed"
                disabled={!replayIndex || isReplayLoading}
                menuLabel="Speed choices"
                onChange={(value) => setSpeed(Number(value))}
                options={[
                  { label: '0.5x', value: '0.5' },
                  { label: '1x', value: '1' },
                  { label: '1.5x', value: '1.5' },
                  { label: '2x', value: '2' },
                  { label: '4x', value: '4' },
                ]}
                value={String(speed)}
                displayValue={`${speed}x`}
              />
            </div>
          </div>
        </footer>
      </main>
    </div>
  )
}
