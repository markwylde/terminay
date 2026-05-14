import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { buildTerminalOptions } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalPanelParams } from './TerminalTab'
import type { TerminalSettings } from '../types/settings'

const OPEN_TERMINAL_SWITCHER_EVENT = 'terminay-open-terminal-switcher'
const DROP_FILE_EXPLORER_PATH_EVENT = 'terminay-drop-file-explorer-path'
const CLEAR_TERMINAL_EVENT = 'terminay-clear-terminal'
const COPY_TERMINAL_EVENT = 'terminay-copy-terminal'
const BRACKETED_PASTE_NEWLINE = '\x1b[200~\n\x1b[201~'
const TERMINAL_CONTEXT_MAX_LINES = 200
const TERMINAL_CONTEXT_MAX_CHARS = 20_000
const REMOTE_TERMINAL_SCALE_PROPERTY = '--terminal-remote-scale'

const searchOptions = {
  incremental: true,
  decorations: {
    matchBackground: '#24415f',
    matchBorder: '#4db5ff',
    matchOverviewRuler: '#4db5ff',
    activeMatchBackground: '#ffd76a',
    activeMatchBorder: '#ffb11a',
    activeMatchColorOverviewRuler: '#ffb11a',
  },
} as const

function buildTerminalTheme(settings: TerminalSettings, tabColor?: string): TerminalSettings['theme'] {
  return {
    ...settings.theme,
    cursor: tabColor || settings.theme.cursor,
  }
}

function applyTerminalSettings(terminal: Terminal, settings: TerminalSettings, tabColor?: string, zoomLevel = 0) {
  Object.assign(terminal.options, {
    ...buildTerminalOptions(settings),
    fontSize: Math.max(6, (settings.fontSize ?? 13) + zoomLevel),
    theme: buildTerminalTheme(settings, tabColor),
  })
}

function updateRemoteViewportMetadata(sessionId: string, root: HTMLElement) {
  window.terminay.updateTerminalRemoteMetadata(sessionId, {
    viewportHeight: Math.max(0, Math.round(root.clientHeight)),
    viewportWidth: Math.max(0, Math.round(root.clientWidth)),
  })
}

function clearRemoteTerminalElementSize(root: HTMLElement, terminal: Terminal) {
  root.style.removeProperty(REMOTE_TERMINAL_SCALE_PROPERTY)

  if (!terminal.element) {
    return
  }

  terminal.element.style.height = ''
  terminal.element.style.width = ''
}

function syncRemoteTerminalElementSize(root: HTMLElement, terminal: Terminal) {
  const element = terminal.element
  if (!element) {
    return
  }

  const screen = root.querySelector<HTMLElement>('.xterm-screen')
  const viewport = root.querySelector<HTMLElement>('.xterm-viewport')
  const measuredWidth =
    screen?.offsetWidth ??
    viewport?.offsetWidth ??
    screen?.getBoundingClientRect().width ??
    viewport?.getBoundingClientRect().width ??
    0
  const measuredHeight =
    screen?.offsetHeight ??
    viewport?.offsetHeight ??
    screen?.getBoundingClientRect().height ??
    viewport?.getBoundingClientRect().height ??
    0

  if (measuredWidth > 0) {
    element.style.width = `${Math.ceil(measuredWidth)}px`
  }

  if (measuredHeight > 0) {
    element.style.height = `${Math.ceil(measuredHeight)}px`
  }

  const availableWidth = root.clientWidth
  const availableHeight = root.clientHeight
  const scale =
    measuredWidth > 0 && measuredHeight > 0 && availableWidth > 0 && availableHeight > 0
      ? Math.min(1, availableWidth / measuredWidth, availableHeight / measuredHeight)
      : 1

  root.style.setProperty(REMOTE_TERMINAL_SCALE_PROPERTY, String(scale))
}

function applyRemoteTerminalSize(
  root: HTMLElement,
  terminal: Terminal,
  cols: number,
  rows: number,
  shouldSyncAfterFrame: () => boolean,
) {
  terminal.resize(cols, rows)
  syncRemoteTerminalElementSize(root, terminal)
  window.requestAnimationFrame(() => {
    if (!shouldSyncAfterFrame()) {
      return
    }

    syncRemoteTerminalElementSize(root, terminal)
  })
}

function escapePathForShell(path: string): string {
  if (path.length === 0) {
    return "''"
  }

  return `'${path.replace(/'/g, `'\\''`)}'`
}

function getDroppedFileText(dataTransfer: DataTransfer): string | null {
  const customPath = dataTransfer.getData('terminay/path')
  if (customPath) {
    return escapePathForShell(customPath)
  }

  const textData = dataTransfer.getData('text/plain')
  if (textData && (textData.startsWith('/') || textData.startsWith('~/') || textData.includes('\\'))) {
    return escapePathForShell(textData)
  }

  if (dataTransfer.files.length > 0) {
    const paths = Array.from(dataTransfer.files)
      .map((file) => window.terminay.getPathForFile(file))
      .filter((path): path is string => typeof path === 'string' && path.length > 0)

    if (paths.length > 0) {
      return paths.map(escapePathForShell).join(' ')
    }
  }

  return null
}

function shouldInterceptTerminalDrop(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.types.includes('terminay/path') || dataTransfer.types.includes('Files')) {
    return true
  }

  return getDroppedFileText(dataTransfer) !== null
}

function getRecentTerminalOutput(terminal: Terminal): string {
  const buffer = terminal.buffer.active
  const startLine = Math.max(0, buffer.length - TERMINAL_CONTEXT_MAX_LINES)
  const lines: string[] = []

  for (let lineIndex = startLine; lineIndex < buffer.length; lineIndex += 1) {
    const line = buffer.getLine(lineIndex)
    if (line) {
      lines.push(line.translateToString(true))
    }
  }

  return lines.join('\n').trim().slice(-TERMINAL_CONTEXT_MAX_CHARS)
}

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const xtermRootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const tabColorRef = useRef(props.params.color)
  const zoomLevelRef = useRef(0)
  const remoteSizeOverrideRef = useRef<{ cols: number; rows: number } | null>(null)
  const { settings } = useTerminalSettings()
  const settingsRef = useRef(settings)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isRemoteSizeOverrideActive, setIsRemoteSizeOverrideActive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSummary, setSearchSummary] = useState<{ index: number; count: number }>({
    index: 0,
    count: 0,
  })
  const hasTerminalNote = typeof props.params.terminalNote === 'string'

  tabColorRef.current = props.params.color

  const runSearchAction = useCallback((action: (searchAddon: SearchAddon) => void) => {
    const searchAddon = searchAddonRef.current
    if (!searchAddon) {
      return
    }

    try {
      action(searchAddon)
    } catch (error) {
      console.error('Terminal search failed', error)
      setIsSearchOpen(false)
    }
  }, [])

  const announceTerminalFocus = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent('terminay-terminal-focused', {
        detail: { sessionId: props.params.sessionId },
      }),
    )
  }, [props.params.sessionId])

  useEffect(() => {
    const container = containerRef.current
    const root = xtermRootRef.current
    if (!container || !root) {
      return
    }

    const sessionId = props.params.sessionId

    root.innerHTML = ''

    const terminal = new Terminal({
      ...buildTerminalOptions(settingsRef.current),
      theme: buildTerminalTheme(settingsRef.current, tabColorRef.current),
      allowProposedApi: true,
    })
    terminalRef.current = terminal

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11Addon = new Unicode11Addon()
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(unicode11Addon)

    const isMac = navigator.platform.toLowerCase().includes('mac')
    const announceTerminalUserInput = () => {
      window.dispatchEvent(
        new CustomEvent('terminay-terminal-user-input', {
          detail: { sessionId },
        }),
      )
    }

    const linkHandler = (event: MouseEvent, uri: string) => {
      const modifierKey = isMac ? event.metaKey : event.ctrlKey
      if (modifierKey) {
        event.preventDefault()
        window.terminay.openExternal(uri)
      }
    }

    const linkHover = () => {
      document.body.style.cursor = 'pointer'
    }

    const linkLeave = () => {
      document.body.style.cursor = ''
    }

    terminal.loadAddon(
      new WebLinksAddon(linkHandler, {
        hover: linkHover,
        leave: linkLeave,
      }),
    )
    terminal.unicode.activeVersion = '11'
    terminal.open(root)

    const copySelectionToClipboard = () => {
      const selectedText = terminal.getSelection()
      if (selectedText.length === 0) {
        return false
      }

      void window.terminay.writeClipboardText(selectedText)
      return true
    }

    terminal.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase()
      const isCopyShortcut =
        (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'c') ||
        (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'c')

      if (isCopyShortcut) {
        if (terminal.hasSelection()) {
          event.preventDefault()
          event.stopPropagation()
          if (event.type === 'keydown') {
            copySelectionToClipboard()
          }
          return false
        }

        return true
      }

      const isPasteShortcut =
        (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === 'v') ||
        (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === 'v')

      if (isPasteShortcut) {
        event.preventDefault()
        event.stopPropagation()
        if (event.type !== 'keydown') {
          return false
        }

        void window.terminay.smartPasteClipboard().then((pasted) => {
          if (pasted.length === 0) {
            return
          }

          announceTerminalUserInput()
          terminal.paste(pasted)
        })

        return false
      }

      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        if (event.type !== 'keydown') {
          return false
        }

        if (event.repeat) {
          return false
        }

        window.dispatchEvent(
          new CustomEvent(OPEN_TERMINAL_SWITCHER_EVENT, {
            detail: { direction: event.shiftKey ? -1 : 1 },
          }),
        )
        return false
      }

      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setIsSearchOpen(true)
        return false
      }

      if (event.key === 'Enter' && (event.shiftKey || event.altKey)) {
        event.preventDefault()
        if (event.type !== 'keydown') {
          return false
        }

        // Send the newline through bracketed paste so shells keep it in the
        // current command buffer instead of accepting the line.
        announceTerminalUserInput()
        window.terminay.writeTerminal(sessionId, BRACKETED_PASTE_NEWLINE)
        return false
      }

      return true
    })

    const fitAndResize = () => {
      const remoteSizeOverride = remoteSizeOverrideRef.current
      if (remoteSizeOverride) {
        applyRemoteTerminalSize(root, terminal, remoteSizeOverride.cols, remoteSizeOverride.rows, () => {
          const currentOverride = remoteSizeOverrideRef.current
          return (
            terminalRef.current === terminal &&
            currentOverride?.cols === remoteSizeOverride.cols &&
            currentOverride.rows === remoteSizeOverride.rows
          )
        })
        updateRemoteViewportMetadata(sessionId, root)
        return
      }

      clearRemoteTerminalElementSize(root, terminal)
      fitAddon.fit()
      window.terminay.resizeTerminal(sessionId, terminal.cols, terminal.rows)
      updateRemoteViewportMetadata(sessionId, root)
    }

    fitAndResize()

    const terminalDataDisposer = window.terminay.onTerminalData((message) => {
      if (message.id !== sessionId) {
        return
      }

      terminal.write(message.data)
    })

    const terminalExitDisposer = window.terminay.onTerminalExit((message) => {
      if (message.id !== sessionId) {
        return
      }

      if (settingsRef.current.autoCloseTerminalOnExitZero && message.exitCode === 0) {
        return
      }

      terminal.write(`\r\n\x1b[31m[process exited with code ${message.exitCode}]\x1b[0m\r\n`)
    })

    const zoomDisposer = window.terminay.onTerminalZoomChanged((message) => {
      zoomLevelRef.current = message.zoomLevel
      const baseFontSize = settingsRef.current.fontSize ?? 13
      const newFontSize = baseFontSize + message.zoomLevel
      terminal.options.fontSize = Math.max(6, newFontSize)
      fitAndResize()
    })

    const remoteSizeOverrideDisposer = window.terminay.onTerminalRemoteSizeOverrideChanged((message) => {
      if (message.id !== sessionId) {
        return
      }

      if (!message.active) {
        remoteSizeOverrideRef.current = null
        setIsRemoteSizeOverrideActive(false)
        fitAndResize()
        return
      }

      const cols = Math.max(2, Math.floor(message.cols))
      const rows = Math.max(1, Math.floor(message.rows))
      remoteSizeOverrideRef.current = { cols, rows }
      setIsRemoteSizeOverrideActive(true)
      applyRemoteTerminalSize(root, terminal, cols, rows, () => {
        const currentOverride = remoteSizeOverrideRef.current
        return terminalRef.current === terminal && currentOverride?.cols === cols && currentOverride.rows === rows
      })
      updateRemoteViewportMetadata(sessionId, root)
    })

    void window.terminay.getTerminalZoom().then((zoomLevel) => {
      if (terminalRef.current !== terminal) {
        return
      }

      terminal.options.fontSize = Math.max(6, (settingsRef.current.fontSize ?? 13) + zoomLevel)
      zoomLevelRef.current = zoomLevel
      fitAndResize()
    })

    const keyDisposer = terminal.onKey(() => {
      announceTerminalUserInput()
    })

    const dataDisposer = terminal.onData((data) => {
      window.terminay.writeTerminal(sessionId, data)
    })

    const resizeDisposer = props.api.onDidDimensionsChange(() => {
      fitAndResize()
    })

    let activeFocusFrame: number | null = null

    const activeDisposer = props.api.onDidActiveChange((event) => {
      if (!event.isActive) {
        if (activeFocusFrame !== null) {
          window.cancelAnimationFrame(activeFocusFrame)
          activeFocusFrame = null
        }
        return
      }

      activeFocusFrame = window.requestAnimationFrame(() => {
        activeFocusFrame = null
        terminal.focus()
        announceTerminalFocus()
      })
    })

    const focusTerminal = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>
      if (customEvent.detail?.sessionId && customEvent.detail.sessionId !== sessionId) {
        return
      }

      terminal.focus()
      announceTerminalFocus()
    }

    const clearTerminal = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>
      if (customEvent.detail?.sessionId !== sessionId) {
        return
      }

      terminal.clear()
      terminal.focus()
      announceTerminalFocus()
    }

    const copyTerminal = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>
      if (customEvent.detail?.sessionId !== sessionId) {
        return
      }

      copySelectionToClipboard()
    }

    const focusTerminalNote = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string }>
      if (customEvent.detail?.sessionId !== sessionId) {
        return
      }

      const note = noteRef.current
      if (!note) {
        return
      }

      note.focus()
      note.setSelectionRange(note.value.length, note.value.length)
    }

    const handleExplorerPathDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string; sessionId?: string }>
      if (customEvent.detail?.sessionId !== sessionId || !customEvent.detail.path) {
        return
      }

      window.terminay.writeTerminal(sessionId, `${escapePathForShell(customEvent.detail.path)} `)
      terminal.focus()
      announceTerminalFocus()
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize()
    })

    const searchResultsDisposer = searchAddon.onDidChangeResults((event) => {
      setSearchSummary({
        index: event.resultCount > 0 ? event.resultIndex + 1 : 0,
        count: event.resultCount,
      })
    })

    const handleDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer || !shouldInterceptTerminalDrop(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || !shouldInterceptTerminalDrop(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = (event: DragEvent) => {
      if (!event.dataTransfer) {
        return
      }

      const droppedText = getDroppedFileText(event.dataTransfer)
      if (!droppedText) {
        return
      }

      // We handle the event here so xterm doesn't get it
      event.preventDefault()
      event.stopPropagation()

      window.terminay.writeTerminal(sessionId, `${droppedText} `)
      terminal.focus()
      announceTerminalFocus()
    }

    const dragListenerOptions = { capture: true } as const
    const contextReaderDisposer = props.params.registerTerminalContextReader?.(sessionId, () => ({
      recentOutput: getRecentTerminalOutput(terminal),
    }))

    resizeObserver.observe(root)
    container.addEventListener('dragenter', handleDragEnter, dragListenerOptions)
    container.addEventListener('dragover', handleDragOver, dragListenerOptions)
    container.addEventListener('drop', handleDrop, dragListenerOptions)
    root.addEventListener('dragenter', handleDragEnter, dragListenerOptions)
    root.addEventListener('dragover', handleDragOver, dragListenerOptions)
    root.addEventListener('drop', handleDrop, dragListenerOptions)
    root.addEventListener('paste', announceTerminalUserInput)
    root.addEventListener('pointerdown', announceTerminalFocus)
    root.addEventListener('pointerdown', announceTerminalUserInput)
    window.addEventListener('terminay-focus-terminal', focusTerminal)
    window.addEventListener('terminay-focus-terminal-note', focusTerminalNote)
    window.addEventListener(CLEAR_TERMINAL_EVENT, clearTerminal)
    window.addEventListener(COPY_TERMINAL_EVENT, copyTerminal)
    window.addEventListener(DROP_FILE_EXPLORER_PATH_EVENT, handleExplorerPathDrop)
    terminal.focus()
    announceTerminalFocus()

    return () => {
      searchResultsDisposer.dispose()
      resizeObserver.disconnect()
      container.removeEventListener('dragenter', handleDragEnter, dragListenerOptions)
      container.removeEventListener('dragover', handleDragOver, dragListenerOptions)
      container.removeEventListener('drop', handleDrop, dragListenerOptions)
      root.removeEventListener('dragenter', handleDragEnter, dragListenerOptions)
      root.removeEventListener('dragover', handleDragOver, dragListenerOptions)
      root.removeEventListener('drop', handleDrop, dragListenerOptions)
      root.removeEventListener('paste', announceTerminalUserInput)
      root.removeEventListener('pointerdown', announceTerminalFocus)
      root.removeEventListener('pointerdown', announceTerminalUserInput)
      window.removeEventListener('terminay-focus-terminal', focusTerminal)
      window.removeEventListener('terminay-focus-terminal-note', focusTerminalNote)
      window.removeEventListener(CLEAR_TERMINAL_EVENT, clearTerminal)
      window.removeEventListener(COPY_TERMINAL_EVENT, copyTerminal)
      window.removeEventListener(DROP_FILE_EXPLORER_PATH_EVENT, handleExplorerPathDrop)
      activeDisposer.dispose()
      if (activeFocusFrame !== null) {
        window.cancelAnimationFrame(activeFocusFrame)
      }
      resizeDisposer.dispose()
      keyDisposer.dispose()
      dataDisposer.dispose()
      terminalExitDisposer()
      terminalDataDisposer()
      contextReaderDisposer?.()
      zoomDisposer()
      remoteSizeOverrideDisposer()
      searchAddonRef.current = null
      fitAddonRef.current = null
      terminalRef.current = null
      terminal.dispose()
    }
  }, [announceTerminalFocus, props.api, props.params.registerTerminalContextReader, props.params.sessionId])

  useEffect(() => {
    settingsRef.current = settings

    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const root = xtermRootRef.current
    if (!terminal || !fitAddon || !root) {
      return
    }

    applyTerminalSettings(terminal, settings, props.params.color, zoomLevelRef.current)
    const remoteSizeOverride = remoteSizeOverrideRef.current
    if (remoteSizeOverride) {
      applyRemoteTerminalSize(root, terminal, remoteSizeOverride.cols, remoteSizeOverride.rows, () => {
        const currentOverride = remoteSizeOverrideRef.current
        return (
          terminalRef.current === terminal &&
          currentOverride?.cols === remoteSizeOverride.cols &&
          currentOverride.rows === remoteSizeOverride.rows
        )
      })
      updateRemoteViewportMetadata(props.params.sessionId, root)
      return
    }

    clearRemoteTerminalElementSize(root, terminal)
    fitAddon.fit()
    window.terminay.resizeTerminal(props.params.sessionId, terminal.cols, terminal.rows)
    updateRemoteViewportMetadata(props.params.sessionId, root)
  }, [props.params.color, props.params.sessionId, settings])

  useEffect(() => {
    const note = noteRef.current
    if (!note) {
      return
    }

    const nextText = props.params.terminalNote ?? ''
    if (note.value !== nextText && note.ownerDocument.activeElement !== note) {
      note.value = nextText
    }
    note.style.height = '0px'
    note.style.height = `${note.scrollHeight}px`
  }, [props.params.terminalNote])

  const resizeNote = () => {
    const note = noteRef.current
    if (!note) {
      return
    }

    note.style.height = '0px'
    note.style.height = `${note.scrollHeight}px`
  }

  useEffect(() => {
    if (!isSearchOpen) {
      runSearchAction((searchAddon) => {
        searchAddon.clearDecorations()
        searchAddon.clearActiveDecoration()
      })
      setSearchSummary({ index: 0, count: 0 })
      terminalRef.current?.focus()
      return
    }

    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    })
  }, [isSearchOpen, runSearchAction])

  useEffect(() => {
    if (!searchQuery) {
      runSearchAction((searchAddon) => {
        searchAddon.clearDecorations()
        searchAddon.clearActiveDecoration()
      })
      setSearchSummary({ index: 0, count: 0 })
      return
    }

    runSearchAction((searchAddon) => {
      searchAddon.findNext(searchQuery, searchOptions)
    })
  }, [searchQuery, runSearchAction])

  const closeSearch = () => {
    setIsSearchOpen(false)
  }

  const goToNextResult = () => {
    if (!searchQuery) {
      return
    }

    runSearchAction((searchAddon) => {
      searchAddon.findNext(searchQuery, searchOptions)
    })
  }

  const goToPreviousResult = () => {
    if (!searchQuery) {
      return
    }

    runSearchAction((searchAddon) => {
      searchAddon.findPrevious(searchQuery, searchOptions)
    })
  }

  const terminalPanelStyle = {
    '--terminal-panel-surface': settings.theme.background,
    '--terminal-note-color': props.params.color || settings.theme.cursor,
  } as CSSProperties

  return (
    <div
      className={`terminal-panel${hasTerminalNote ? ' terminal-panel--has-note' : ''}${
        isRemoteSizeOverrideActive ? ' terminal-panel--remote-size-override' : ''
      }`}
      data-terminay-terminal-session-id={props.params.sessionId}
      ref={containerRef}
      style={terminalPanelStyle}
    >
      {hasTerminalNote ? (
        <div className="terminal-note-shell">
          <textarea
            ref={noteRef}
            className="terminal-note-editor"
            aria-label="Terminal note"
            placeholder="Add a note for this terminal..."
            rows={1}
            value={props.params.terminalNote ?? ''}
            onChange={(event) => {
              props.params.onUpdateNote?.(event.currentTarget.value)
            }}
            onInput={() => {
              resizeNote()
            }}
            onPaste={() => {
              window.requestAnimationFrame(resizeNote)
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation()
            }}
          />
        </div>
      ) : null}
      {isSearchOpen ? (
        <search className="terminal-search" aria-label="Search terminal output">
          <input
            ref={searchInputRef}
            type="search"
            className="terminal-search-input"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onBlur={() =>
              runSearchAction((searchAddon) => {
                searchAddon.clearActiveDecoration()
              })
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeSearch()
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                if (event.shiftKey) {
                  goToPreviousResult()
                  return
                }

                goToNextResult()
              }
            }}
            placeholder="Find in terminal"
            aria-label="Find in terminal"
          />
          <span className="terminal-search-count" aria-live="polite">
            {searchSummary.count > 0 ? `${searchSummary.index}/${searchSummary.count}` : '0 results'}
          </span>
          <button type="button" className="terminal-search-button" onClick={goToPreviousResult} aria-label="Previous match">
            ↑
          </button>
          <button type="button" className="terminal-search-button" onClick={goToNextResult} aria-label="Next match">
            ↓
          </button>
          <button type="button" className="terminal-search-button" onClick={closeSearch} aria-label="Close search">
            ✕
          </button>
        </search>
      ) : null}
      <div className="terminal-panel-root" ref={xtermRootRef} />
    </div>
  )
}
