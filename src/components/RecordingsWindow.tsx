import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { Terminal } from '@xterm/xterm'
import {
  ExternalLink,
  Maximize2,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { buildTerminalOptions, defaultTerminalSettings, resolveTerminalTheme } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalSettings, TerminalThemeSettings } from '../types/settings'
import type { TerminalRecordingCast, TerminalRecordingListItem } from '../types/terminay'
import '../settings.css'
import '../recordings.css'

type ParsedCastEvent = {
  code: string
  data: string
  interval: number
  time: number
}

type ParsedCast = {
  cols: number
  duration: number
  events: ParsedCastEvent[]
  rows: number
  title: string
}

type ReplayScaleMode = 'actual' | 'custom' | 'fit'
type ReplayThemeMode = 'current' | 'recorded'

const SCALE_STEP = 0.1
const MIN_SCALE = 0.25
const MAX_SCALE = 2

function parseAsciicast(content: string): ParsedCast {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0)
  const header = JSON.parse(lines[0] ?? '{}') as {
    term?: { cols?: number; rows?: number }
    title?: string
  }
  const events: ParsedCastEvent[] = []
  let time = 0

  for (const line of lines.slice(1)) {
    if (line.startsWith('#')) {
      continue
    }

    let tuple: unknown
    try {
      tuple = JSON.parse(line)
    } catch {
      continue
    }

    if (!Array.isArray(tuple) || tuple.length < 3) {
      continue
    }

    const [interval, code, data] = tuple
    if (typeof interval !== 'number' || typeof code !== 'string' || typeof data !== 'string') {
      continue
    }

    time += Math.max(0, interval)
    events.push({ code, data, interval, time })
  }

  return {
    cols: Math.max(2, Math.floor(Number(header.term?.cols) || 80)),
    duration: events.length > 0 ? events[events.length - 1].time : 0,
    events,
    rows: Math.max(1, Math.floor(Number(header.term?.rows) || 24)),
    title: typeof header.title === 'string' ? header.title : 'Terminal Recording',
  }
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

function formatPlaybackTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds)
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = Math.floor(safeSeconds % 60)
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function getRecordingDisplayTitle(recording: TerminalRecordingListItem): string {
  return recording.projectTitle ? `${recording.projectTitle} > ${recording.title}` : recording.title
}

function getRecordingTabColor(recording: TerminalRecordingCast | TerminalRecordingListItem | null): string | undefined {
  if (!recording) {
    return undefined
  }

  const metadata = 'metadata' in recording ? recording.metadata : recording
  return metadata?.color ?? metadata?.projectColor ?? undefined
}

function buildReplayTerminalOptions(
  settings: TerminalSettings,
  scale: number,
  theme: TerminalThemeSettings,
) {
  const options = buildTerminalOptions(settings)
  return {
    ...options,
    fontSize: Math.max(1, settings.fontSize * scale),
    letterSpacing: settings.letterSpacing * scale,
    theme,
  }
}

export function RecordingsWindow() {
  const { settings } = useTerminalSettings()
  const terminalViewportRef = useRef<HTMLDivElement | null>(null)
  const terminalRootRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const playStartedAtRef = useRef(0)
  const playOffsetRef = useRef(0)
  const renderedEventIndexRef = useRef(0)
  const parsedCastRef = useRef<ParsedCast | null>(null)
  const playheadRef = useRef(0)
  const displayScaleRef = useRef(1)
  const [recordings, setRecordings] = useState<TerminalRecordingListItem[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [loadedCast, setLoadedCast] = useState<TerminalRecordingCast | null>(null)
  const [parsedCast, setParsedCast] = useState<ParsedCast | null>(null)
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [speed, setSpeed] = useState(1)
  const [scaleMode, setScaleMode] = useState<ReplayScaleMode>('fit')
  const [themeMode, setThemeMode] = useState<ReplayThemeMode>('recorded')
  const [customScale, setCustomScale] = useState(1)
  const [terminalSize, setTerminalSize] = useState({ height: 1, width: 1 })
  const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 })
  const selectedRecording = recordings.find((recording) => recording.castPath === selectedPath) ?? null

  useEffect(() => {
    playheadRef.current = playhead
  }, [playhead])

  const measureTerminal = useCallback(() => {
    window.requestAnimationFrame(() => {
      const terminalElement = terminalRootRef.current
      if (!terminalElement) {
        return
      }

      const scale = displayScaleRef.current || 1
      const rect = terminalElement.getBoundingClientRect()
      setTerminalSize({
        height: Math.max(1, terminalElement.offsetHeight, rect.height) / scale,
        width: Math.max(1, terminalElement.offsetWidth, rect.width) / scale,
      })
    })
  }, [])

  useEffect(() => {
    const viewport = terminalViewportRef.current
    if (!viewport) {
      return
    }

    const updateViewportSize = () => {
      setViewportSize({
        height: Math.max(1, viewport.clientHeight),
        width: Math.max(1, viewport.clientWidth),
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
    const availableWidth = Math.max(1, viewportSize.width)
    const availableHeight = Math.max(1, viewportSize.height)
    return Math.min(1, availableWidth / terminalSize.width, availableHeight / terminalSize.height)
  }, [terminalSize.height, terminalSize.width, viewportSize.height, viewportSize.width])

  const displayScale = scaleMode === 'fit' ? fitScale : scaleMode === 'actual' ? 1 : customScale
  displayScaleRef.current = displayScale
  const recordedTheme = loadedCast?.metadata?.theme ?? null
  const canUseRecordedTheme = recordedTheme !== null
  const replayThemeMode = themeMode === 'recorded' && canUseRecordedTheme ? 'recorded' : 'current'
  const replayTheme = useMemo(() => {
    if (replayThemeMode === 'recorded' && recordedTheme) {
      return recordedTheme
    }

    return resolveTerminalTheme(settings ?? defaultTerminalSettings, getRecordingTabColor(loadedCast ?? selectedRecording))
  }, [loadedCast, recordedTheme, replayThemeMode, selectedRecording, settings])

  const loadRecordings = useCallback(async () => {
    setIsLoading(true)
    setErrorText(null)
    try {
      const nextRecordings = await window.terminay.listTerminalRecordings()
      setRecordings(nextRecordings)
      setSelectedPath((current) => current ?? nextRecordings[0]?.castPath ?? null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecordings()
  }, [loadRecordings])

  const renderUpTo = useCallback((time: number) => {
    const terminal = terminalRef.current
    const cast = parsedCastRef.current
    if (!terminal || !cast) {
      return
    }

    terminal.reset()
    terminal.resize(cast.cols, cast.rows)
    let index = 0
    for (const event of cast.events) {
      if (event.time > time) {
        break
      }

      if (event.code === 'o') {
        terminal.write(event.data)
      } else if (event.code === 'r') {
        const [cols, rows] = event.data.split('x').map((part) => Number(part))
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
          terminal.resize(Math.max(2, cols), Math.max(1, rows))
          measureTerminal()
        }
      }
      index += 1
    }
    renderedEventIndexRef.current = index
    measureTerminal()
  }, [measureTerminal])

  useEffect(() => {
    const root = terminalRootRef.current
    if (!root) {
      return
    }

    root.innerHTML = ''
    const terminal = new Terminal({
      ...buildReplayTerminalOptions(settings ?? defaultTerminalSettings, displayScaleRef.current, replayTheme),
      allowProposedApi: true,
      cols: parsedCastRef.current?.cols ?? 80,
      disableStdin: false,
      rows: parsedCastRef.current?.rows ?? 24,
    })
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.open(root)
    terminal.attachCustomKeyEventHandler(() => false)
    terminal.focus()
    terminalRef.current = terminal
    measureTerminal()

    window.requestAnimationFrame(() => {
      if (parsedCastRef.current) {
        renderUpTo(playheadRef.current)
        terminal.focus()
      }
      measureTerminal()
    })

    return () => {
      terminal.dispose()
      terminalRef.current = null
    }
  }, [measureTerminal, renderUpTo, replayTheme, settings])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const options = buildReplayTerminalOptions(settings ?? defaultTerminalSettings, displayScale, replayTheme)
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
  }, [displayScale, measureTerminal, replayTheme, settings])

  useEffect(() => {
    if (!selectedPath) {
      setLoadedCast(null)
      setParsedCast(null)
      return
    }

    let canceled = false
    setErrorText(null)
    setIsPlaying(false)
    setPlayhead(0)

    void window.terminay.readTerminalRecording(selectedPath).then(
      (recording) => {
        if (canceled) {
          return
        }

        const parsed = parseAsciicast(recording.content)
        setLoadedCast(recording)
        setParsedCast(parsed)
        parsedCastRef.current = parsed
        renderedEventIndexRef.current = 0
        setScaleMode('fit')
        renderUpTo(0)
        measureTerminal()
      },
      (error) => {
        if (!canceled) {
          setErrorText(error instanceof Error ? error.message : String(error))
        }
      },
    )

    return () => {
      canceled = true
    }
  }, [measureTerminal, renderUpTo, selectedPath])

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const tickPlayback = useCallback(() => {
    const cast = parsedCastRef.current
    const terminal = terminalRef.current
    if (!cast || !terminal) {
      return
    }

    const elapsed = playOffsetRef.current + ((performance.now() - playStartedAtRef.current) / 1000) * speed
    const nextTime = Math.min(elapsed, cast.duration)
    let index = renderedEventIndexRef.current

    while (index < cast.events.length && cast.events[index].time <= nextTime) {
      const event = cast.events[index]
      if (event.code === 'o') {
        terminal.write(event.data)
      } else if (event.code === 'r') {
        const [cols, rows] = event.data.split('x').map((part) => Number(part))
        if (Number.isFinite(cols) && Number.isFinite(rows)) {
          terminal.resize(Math.max(2, cols), Math.max(1, rows))
          measureTerminal()
        }
      }
      index += 1
    }

    renderedEventIndexRef.current = index
    setPlayhead(nextTime)

    if (nextTime >= cast.duration) {
      setIsPlaying(false)
      animationFrameRef.current = null
      return
    }

    animationFrameRef.current = window.requestAnimationFrame(tickPlayback)
  }, [measureTerminal, speed])

  useEffect(() => {
    stopAnimation()
    if (!isPlaying || !parsedCast) {
      return
    }

    playStartedAtRef.current = performance.now()
    playOffsetRef.current = playhead
    animationFrameRef.current = window.requestAnimationFrame(tickPlayback)
    return stopAnimation
  }, [isPlaying, parsedCast, playhead, stopAnimation, tickPlayback])

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
        recording.cwd,
        recording.castPath,
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
    if (!parsedCast) {
      return
    }

    if (playhead >= parsedCast.duration) {
      renderUpTo(0)
      setPlayhead(0)
    }
    setIsPlaying((current) => !current)
  }

  const onRestart = () => {
    setIsPlaying(false)
    setPlayhead(0)
    renderUpTo(0)
  }

  const onScrub = (value: number) => {
    setIsPlaying(false)
    setPlayhead(value)
    renderUpTo(value)
  }

  const updateCustomScale = (nextScale: number) => {
    setCustomScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale)))
    setScaleMode('custom')
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
    if (!selectedPath || !confirm('Delete this recording?')) {
      return
    }

    await window.terminay.deleteTerminalRecording(selectedPath)
    setSelectedPath(null)
    setLoadedCast(null)
    setParsedCast(null)
    parsedCastRef.current = null
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
                  key={recording.castPath}
                  type="button"
                  className={`recordings-list-item${recording.castPath === selectedPath ? ' recordings-list-item--selected' : ''}`}
                  onClick={() => setSelectedPath(recording.castPath)}
                >
                  <span className="recordings-list-item__title">{getRecordingDisplayTitle(recording)}</span>
                  <span className="recordings-list-item__meta">
                    {(recording.cwd ?? 'Unknown cwd')} · {formatDuration(recording.durationMs)}
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
        {errorText ? <div className="recordings-error">{errorText}</div> : null}
        <header className="recordings-detail-header">
          <div>
            <h2>{selectedRecording ? getRecordingDisplayTitle(selectedRecording) : parsedCast?.title ?? 'Select a recording'}</h2>
            <p>
              {selectedRecording ? `${formatDate(selectedRecording.startedAt)} · ${selectedRecording.cwd ?? 'Unknown cwd'}` : 'Choose a saved session to replay it.'}
            </p>
            {selectedRecording ? (
              <p className="recordings-detail-path">
                {selectedRecording.recordingState} · exit {selectedRecording.exitCode ?? 'unknown'} · {selectedRecording.castPath}
              </p>
            ) : null}
          </div>
          {selectedRecording ? (
            <div className="recordings-actions">
              <button type="button" className="recordings-secondary-button" onClick={() => void window.terminay.revealTerminalRecording(selectedRecording.castPath)}>
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
          title={scaleMode === 'fit' ? 'Double-click for actual size' : 'Double-click to fit'}
        >
          <div className="recordings-terminal-stage">
            <div
              className="recordings-terminal"
              ref={terminalRootRef}
              style={{
                background: replayTheme.background,
              }}
            />
          </div>
        </div>
        <footer className="recordings-controls">
          <button type="button" className="recordings-primary-button" onClick={onTogglePlay} disabled={!loadedCast || !parsedCast}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="recordings-icon-button" onClick={onRestart} disabled={!parsedCast} aria-label="Restart replay">
            <RotateCcw size={16} />
          </button>
          <span className="recordings-time">
            {formatPlaybackTime(playhead)} / {formatPlaybackTime(parsedCast?.duration ?? 0)}
          </span>
          <input
            className="recordings-range"
            type="range"
            min={0}
            max={parsedCast?.duration ?? 0}
            step={0.1}
            value={Math.min(playhead, parsedCast?.duration ?? 0)}
            onChange={(event) => onScrub(Number(event.target.value))}
            disabled={!parsedCast}
          />
          <fieldset className="recordings-zoom-controls" aria-label="Replay zoom controls">
            <button
              type="button"
              className="recordings-icon-button"
              onClick={() => updateCustomScale(displayScaleRef.current - SCALE_STEP)}
              disabled={!parsedCast}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              className={`recordings-scale-button${scaleMode === 'fit' ? ' recordings-scale-button--active' : ''}`}
              onClick={() => setScaleMode('fit')}
              disabled={!parsedCast}
              title="Fit whole terminal"
            >
              <Maximize2 size={14} />
              Fit
            </button>
            <button
              type="button"
              className={`recordings-scale-button${scaleMode === 'actual' ? ' recordings-scale-button--active' : ''}`}
              onClick={() => setScaleMode('actual')}
              disabled={!parsedCast}
              title="Actual terminal size"
            >
              {Math.round(displayScale * 100)}%
            </button>
            <button
              type="button"
              className="recordings-icon-button"
              onClick={() => updateCustomScale(displayScaleRef.current + SCALE_STEP)}
              disabled={!parsedCast}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus size={15} />
            </button>
          </fieldset>
          <fieldset className="recordings-theme-controls" aria-label="Replay theme controls">
            <button
              type="button"
              className={`recordings-scale-button${replayThemeMode === 'recorded' ? ' recordings-scale-button--active' : ''}`}
              onClick={() => setThemeMode('recorded')}
              disabled={!parsedCast || !canUseRecordedTheme}
              title={canUseRecordedTheme ? 'Use the theme saved with this recording' : 'This recording has no saved theme'}
            >
              Recorded
            </button>
            <button
              type="button"
              className={`recordings-scale-button${replayThemeMode === 'current' ? ' recordings-scale-button--active' : ''}`}
              onClick={() => setThemeMode('current')}
              disabled={!parsedCast}
              title="Use your current settings theme"
            >
              Current
            </button>
          </fieldset>
          <select className="recordings-speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={1.5}>1.5x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
          </select>
        </footer>
      </main>
    </div>
  )
}
