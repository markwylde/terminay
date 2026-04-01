import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { buildTerminalOptions } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalPanelParams } from './TerminalTab'

const OPEN_TERMINAL_SWITCHER_EVENT = 'termide-open-terminal-switcher'

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

function escapePathForShell(path: string): string {
  if (path.length === 0) {
    return "''"
  }

  return `'${path.replace(/'/g, `'\\''`)}'`
}

function getDroppedFileText(dataTransfer: DataTransfer): string | null {
  if (dataTransfer.files.length === 0) {
    return null
  }

  const paths = Array.from(dataTransfer.files)
    .map((file) => window.termide.getPathForFile(file))
    .filter((path): path is string => typeof path === 'string' && path.length > 0)

  if (paths.length === 0) {
    return null
  }

  return paths.map(escapePathForShell).join(' ')
}

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const xtermRootRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const { settings } = useTerminalSettings()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchSummary, setSearchSummary] = useState<{ index: number; count: number }>({
    index: 0,
    count: 0,
  })

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
    const root = xtermRootRef.current
    if (!root) {
      return
    }

    const sessionId = props.params.sessionId

    root.innerHTML = ''

    const terminal = new Terminal({
      ...buildTerminalOptions(settings),
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

    terminal.attachCustomKeyEventHandler((event) => {
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

      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        // Let the PTY remain the source of truth so every connected client
        // converges on the same screen state.
        window.termide.writeTerminal(sessionId, '\u000c')
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
      if (!event.dataTransfer || event.dataTransfer.files.length === 0) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    const handleDragOver = (event: DragEvent) => {
      if (!event.dataTransfer || event.dataTransfer.files.length === 0) {
        return
      }

      event.preventDefault()
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

      event.preventDefault()
      event.stopPropagation()
      window.termide.writeTerminal(sessionId, droppedText)
      terminal.focus()
      announceTerminalFocus()
    }

    resizeObserver.observe(root)
    root.addEventListener('dragenter', handleDragEnter)
    root.addEventListener('dragover', handleDragOver)
    root.addEventListener('drop', handleDrop)
    root.addEventListener('pointerdown', announceTerminalFocus)
    window.addEventListener('termide-focus-terminal', focusTerminal)
    terminal.focus()
    announceTerminalFocus()

    return () => {
      searchResultsDisposer.dispose()
      resizeObserver.disconnect()
      root.removeEventListener('dragenter', handleDragEnter)
      root.removeEventListener('dragover', handleDragOver)
      root.removeEventListener('drop', handleDrop)
      root.removeEventListener('pointerdown', announceTerminalFocus)
      window.removeEventListener('termide-focus-terminal', focusTerminal)
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

  return (
    <div className="terminal-panel" ref={containerRef}>
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
