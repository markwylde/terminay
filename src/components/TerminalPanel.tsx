import { useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { buildTerminalOptions } from '../terminalSettings'
import { useTerminalSettings } from '../hooks/useTerminalSettings'
import type { TerminalPanelParams } from './TerminalTab'

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { settings } = useTerminalSettings()

  useEffect(() => {
    const root = containerRef.current
    if (!root) {
      return
    }

    const sessionId = props.params.sessionId

    root.innerHTML = ''

    const terminal = new Terminal(buildTerminalOptions(settings))

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(root)
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        // Match native terminal behavior: clear the current input line, then ask the shell
        // to clear and redraw the screen with a fresh prompt in the same session.
        window.termide.writeTerminal(sessionId, '\u0015\u000c')
        return false
      }

      return true
    })

    const fitAndResize = () => {
      fitAddon.fit()
      window.termide.resizeTerminal(sessionId, terminal.cols, terminal.rows)
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

    const dataDisposer = terminal.onData((data) => {
      window.termide.writeTerminal(sessionId, data)
    })

    const resizeDisposer = props.api.onDidDimensionsChange(() => {
      fitAndResize()
    })

    const activeDisposer = props.api.onDidActiveChange((event) => {
      if (event.isActive) {
        terminal.focus()
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAndResize()
    })

    resizeObserver.observe(root)
    terminal.focus()

    return () => {
      resizeObserver.disconnect()
      activeDisposer.dispose()
      resizeDisposer.dispose()
      dataDisposer.dispose()
      terminalExitDisposer()
      terminalDataDisposer()
      terminal.dispose()
    }
  }, [props.api, props.params.sessionId, settings])

  return <div className="terminal-panel" ref={containerRef} />
}
