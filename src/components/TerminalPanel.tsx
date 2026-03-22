import { useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import type { TerminalPanelParams } from './TerminalTab'

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = containerRef.current
    if (!root) {
      return
    }

    const sessionId = props.params.sessionId

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      allowTransparency: false,
      theme: {
        background: '#111316',
        foreground: '#dce2f0',
        cursor: '#6ac1ff',
      },
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    terminal.open(root)

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
  }, [props.api, props.params.sessionId])

  return <div className="terminal-panel" ref={containerRef} />
}
