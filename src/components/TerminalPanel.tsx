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
import { enablePreferredXtermRenderer } from '../xtermRenderer'
import type { TerminalPanelParams } from './TerminalTab'
import type { TerminalSettings } from '../types/settings'

const OPEN_TERMINAL_SWITCHER_EVENT = 'termide-open-terminal-switcher'
const DROP_FILE_EXPLORER_PATH_EVENT = 'termide-drop-file-explorer-path'
const CLEAR_TERMINAL_EVENT = 'termide-clear-terminal'
const BRACKETED_PASTE_NEWLINE = '\x1b[200~\n\x1b[201~'

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

function escapePathForShell(path: string): string {
  if (path.length === 0) {
    return "''"
  }

  return `'${path.replace(/'/g, `'\\''`)}'`
}

function getDroppedFileText(dataTransfer: DataTransfer): string | null {
  const customPath = dataTransfer.getData('termide/path')
  if (customPath) {
    return escapePathForShell(customPath)
  }

  const textData = dataTransfer.getData('text/plain')
  if (textData && (textData.startsWith('/') || textData.startsWith('~/') || textData.includes('\\'))) {
    return escapePathForShell(textData)
  }

  if (dataTransfer.files.length > 0) {
    const paths = Array.from(dataTransfer.files)
      .map((file) => window.termide.getPathForFile(file))
      .filter((path): path is string => typeof path === 'string' && path.length > 0)

    if (paths.length > 0) {
      return paths.map(escapePathForShell).join(' ')
    }
  }

  return null
}

function shouldInterceptTerminalDrop(dataTransfer: DataTransfer): boolean {
  if (dataTransfer.types.includes('termide/path') || dataTransfer.types.includes('Files')) {
    return true
  }

  return getDroppedFileText(dataTransfer) !== null
}

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const tabColorRef = useRef(props.params.color)
  const { settings } = useTerminalSettings()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSummary, setSearchSummary] = useState<{ index: number; count: number }>({
    index: 0,
    count: 0,
  })

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
      new CustomEvent('termide-terminal-focused', {
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
      ...buildTerminalOptions(settings),
      theme: buildTerminalTheme(settings, tabColorRef.current),
      allowProposedApi: true,
    })
    terminalRef.current = terminal

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11Addon = new Unicode11Addon()
    searchAddonRef.current = searchAddon
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(unicode11Addon)

    const isMac = navigator.platform.toLowerCase().includes('mac')

    const linkHandler = (event: MouseEvent, uri: string) => {
      const modifierKey = isMac ? event.metaKey : event.ctrlKey
      if (modifierKey) {
        event.preventDefault()
        window.termide.openExternal(uri)
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
    void enablePreferredXtermRenderer(terminal)

    terminal.attachCustomKeyEventHandler((event) => {
      const isPasteShortcut =
        (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'v') ||
        (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'v')

      if (isPasteShortcut) {
        event.preventDefault()
        event.stopPropagation()
        if (event.type !== 'keydown') {
          return false
        }

        void window.termide.smartPasteClipboard().then((pasted) => {
          if (pasted.length === 0) {
            return
          }

          window.termide.writeTerminal(sessionId, pasted)
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
        window.termide.writeTerminal(sessionId, BRACKETED_PASTE_NEWLINE)
        return false
      }

      return true
    })

    const fitAndResize = () => {
      fitAddon.fit()
      window.termide.resizeTerminal(sessionId, terminal.cols, terminal.rows)
      window.termide.updateTerminalRemoteMetadata(sessionId, {
        viewportHeight: Math.max(0, Math.round(root.clientHeight)),
        viewportWidth: Math.max(0, Math.round(root.clientWidth)),
      })
    }

    fitAndResize()

    const terminalDataDisposer = window.termide.onTerminalData((message) => {
      if (message.id !== sessionId) {
        return
      }

      terminal.write(message.data)
    })

    const terminalExitDisposer = window.termide.onTerminalExit((message) => {
      if (message.id !== sessionId) {
        return
      }

      if (settings.autoCloseTerminalOnExitZero && message.exitCode === 0) {
        return
      }

      terminal.write(`\r\n\x1b[31m[process exited with code ${message.exitCode}]\x1b[0m\r\n`)
    })

    const zoomDisposer = window.termide.onTerminalZoomChanged((message) => {
      const baseFontSize = settings.fontSize ?? 13
      const newFontSize = baseFontSize + message.zoomLevel
      terminal.options.fontSize = Math.max(6, newFontSize)
      fitAddon.fit()
      window.termide.resizeTerminal(sessionId, terminal.cols, terminal.rows)
    })

    void window.termide.getTerminalZoom().then((zoomLevel) => {
      if (terminalRef.current !== terminal) {
        return
      }

      terminal.options.fontSize = Math.max(6, (settings.fontSize ?? 13) + zoomLevel)
      fitAndResize()
    })

    const dataDisposer = terminal.onData((data) => {
      window.dispatchEvent(
        new CustomEvent('termide-terminal-user-input', {
          detail: { sessionId },
        }),
      )
      window.termide.writeTerminal(sessionId, data)
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

    const handleExplorerPathDrop = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string; sessionId?: string }>
      if (customEvent.detail?.sessionId !== sessionId || !customEvent.detail.path) {
        return
      }

      window.termide.writeTerminal(sessionId, `${escapePathForShell(customEvent.detail.path)} `)
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

      window.termide.writeTerminal(sessionId, `${droppedText} `)
      terminal.focus()
      announceTerminalFocus()
    }

    const dragListenerOptions = { capture: true } as const

    resizeObserver.observe(root)
    container.addEventListener('dragenter', handleDragEnter, dragListenerOptions)
    container.addEventListener('dragover', handleDragOver, dragListenerOptions)
    container.addEventListener('drop', handleDrop, dragListenerOptions)
    root.addEventListener('dragenter', handleDragEnter, dragListenerOptions)
    root.addEventListener('dragover', handleDragOver, dragListenerOptions)
    root.addEventListener('drop', handleDrop, dragListenerOptions)
    root.addEventListener('pointerdown', announceTerminalFocus)
    window.addEventListener('termide-focus-terminal', focusTerminal)
    window.addEventListener(CLEAR_TERMINAL_EVENT, clearTerminal)
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
      root.removeEventListener('pointerdown', announceTerminalFocus)
      window.removeEventListener('termide-focus-terminal', focusTerminal)
      window.removeEventListener(CLEAR_TERMINAL_EVENT, clearTerminal)
      window.removeEventListener(DROP_FILE_EXPLORER_PATH_EVENT, handleExplorerPathDrop)
      activeDisposer.dispose()
      if (activeFocusFrame !== null) {
        window.cancelAnimationFrame(activeFocusFrame)
      }
      resizeDisposer.dispose()
      dataDisposer.dispose()
      terminalExitDisposer()
      terminalDataDisposer()
      zoomDisposer()
      searchAddonRef.current = null
      terminalRef.current = null
      terminal.dispose()
    }
  }, [announceTerminalFocus, props.api, props.params.sessionId, settings])

  useEffect(() => {
    if (!terminalRef.current) {
      return
    }

    terminalRef.current.options.theme = buildTerminalTheme(settings, props.params.color)
  }, [props.params.color, settings])

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
  } as CSSProperties

  return (
    <div
      className="terminal-panel"
      data-termide-terminal-session-id={props.params.sessionId}
      ref={containerRef}
      style={terminalPanelStyle}
    >
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
