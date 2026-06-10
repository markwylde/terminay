import type { IDisposable, Terminal } from '@xterm/headless'
import type { CommandPhase, ProgressState, ProtocolSignal } from '../src/types/terminalSignals'

/**
 * Registers OSC / bell handlers on a headless xterm terminal and translates the
 * raw escape sequences into typed {@link ProtocolSignal}s. The parser is purely
 * descriptive — it knows nothing about tabs, sessions, or what the sequences
 * mean for any particular app. All handlers return `false` so xterm's default
 * handling is left untouched; the headless instance exists only to observe.
 *
 * Returns a dispose function that tears down every handler.
 */
export function attachSignalParser(
  terminal: Terminal,
  emit: (signal: ProtocolSignal) => void,
): () => void {
  const disposers: IDisposable[] = []

  // OSC 9 — either ConEmu progress (`9;4;<state>[;<pct>]`) or an iTerm2-style
  // notification (`9;<message>`). Progress always wins so a notification can
  // never be misread as progress and vice versa.
  disposers.push(
    terminal.parser.registerOscHandler(9, (data) => {
      const progress = parseProgressPayload(data)
      if (progress) {
        emit(progress)
      } else {
        emit({ kind: 'notification', body: data })
      }
      return false
    }),
  )

  // OSC 133 (FinalTerm) and OSC 633 (VS Code) — command lifecycle markers.
  for (const ident of [133, 633] as const) {
    disposers.push(
      terminal.parser.registerOscHandler(ident, (data) => {
        const command = parseCommandPayload(data)
        if (command) {
          emit(command)
        }
        return false
      }),
    )
  }

  // OSC 777 — urxvt-style `notify;title;body` desktop notification.
  disposers.push(
    terminal.parser.registerOscHandler(777, (data) => {
      const parts = data.split(';')
      if (parts[0] === 'notify') {
        emit({ kind: 'notification', title: parts[1], body: parts[2] })
      }
      return false
    }),
  )

  disposers.push(
    terminal.onBell(() => {
      emit({ kind: 'bell' })
    }),
  )

  return () => {
    for (const disposable of disposers.splice(0)) {
      try {
        disposable.dispose()
      } catch {
        // best-effort teardown
      }
    }
  }
}

function parseProgressPayload(data: string): ProtocolSignal | null {
  const parts = data.split(';')
  if (parts[0] !== '4') {
    return null
  }

  const state = Number(parts[1])
  if (!Number.isInteger(state) || state < 0 || state > 4) {
    return null
  }

  const signal: ProtocolSignal = { kind: 'progress', state: state as ProgressState }
  if (parts.length > 2 && parts[2] !== '') {
    const progress = Number(parts[2])
    if (Number.isFinite(progress)) {
      signal.progress = progress
    }
  }

  return signal
}

const COMMAND_PHASE_BY_MARKER: Record<string, CommandPhase> = {
  A: 'prompt',
  B: 'input',
  C: 'executing',
  D: 'finished',
}

function parseCommandPayload(data: string): ProtocolSignal | null {
  const parts = data.split(';')
  const marker = parts[0]
  const phase = COMMAND_PHASE_BY_MARKER[marker]
  if (!phase) {
    // OSC 633 also carries E/P (command line / properties) subcommands and
    // arbitrary key=value pairs; those are not command lifecycle markers.
    return null
  }

  if (phase !== 'finished') {
    return { kind: 'command', phase }
  }

  const signal: ProtocolSignal = { kind: 'command', phase: 'finished' }
  if (parts.length > 1 && parts[1] !== '') {
    const exitCode = Number(parts[1])
    if (Number.isInteger(exitCode)) {
      signal.exitCode = exitCode
    }
  }

  return signal
}
