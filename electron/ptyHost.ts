import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { Terminal } from '@xterm/headless'
import type { IPty } from 'node-pty'
import type { SemanticActivity } from '../src/types/terminalSignals'
import { createInterpreterRuntime, type InterpreterRuntime } from './signalInterpreters'
import { attachSignalParser } from './terminalSignalParser'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')

const FOREGROUND_POLL_ACTIVE_MS = 1500
const FOREGROUND_POLL_CLAIMED_MS = 4000

type CreateMessage = {
  type: 'create'
  shellPath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  progressStaleMs?: number
}

type WriteMessage = {
  type: 'write'
  data: string
}

type ResizeMessage = {
  type: 'resize'
  cols: number
  rows: number
}

type WaitForInactivityMessage = {
  type: 'waitForInactivity'
  requestId: string
  durationMs: number
}

type HostMessage =
  | CreateMessage
  | WriteMessage
  | ResizeMessage
  | WaitForInactivityMessage
  | { type: 'kill' }

let ptyProcess: IPty | null = null

// Signal-detection state. A headless terminal parses every byte of pty output
// into protocol signals, which the interpreter runtime turns into semantic
// activity forwarded to the renderer.
let signalTerminal: Terminal | null = null
let disposeSignalParser: (() => void) | null = null
let interpreterRuntime: InterpreterRuntime | null = null
let foregroundPollTimer: ReturnType<typeof setInterval> | null = null
let lastForegroundProcess: string | null = null
let cachedShellProcess: string | null = null
let sessionClaimed = false

function send(message: unknown): void {
  if (process.send) {
    process.send(message)
  }
}

function reportError(error: unknown): void {
  send({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  })
}

function setupSignalDetection(message: CreateMessage): void {
  const shellProcess = basename(message.shellPath)

  signalTerminal = new Terminal({
    cols: 80,
    rows: 24,
    scrollback: 0,
    allowProposedApi: true,
  })

  interpreterRuntime = createInterpreterRuntime({
    shellProcess,
    staleMs: message.progressStaleMs,
    onActivity: (activity: SemanticActivity) => {
      sessionClaimed = activity.claimed
      send({ type: 'activity', activity })
    },
  })

  disposeSignalParser = attachSignalParser(signalTerminal, (signal) => {
    interpreterRuntime?.push(signal)
  })
}

function pollForeground(): void {
  if (!ptyProcess || !interpreterRuntime) {
    return
  }

  const processName = readForegroundProcess()
  if (processName === null || processName === lastForegroundProcess) {
    return
  }

  lastForegroundProcess = processName
  interpreterRuntime.push({
    kind: 'foreground',
    busy: cachedShellProcess !== null && processName !== cachedShellProcess,
    processName,
  })
}

function scheduleForegroundPolling(): void {
  if (foregroundPollTimer !== null) {
    clearInterval(foregroundPollTimer)
  }
  // Slow the cadence once a profile has claimed the session via explicit
  // sequences; re-arm whenever the claimed state flips.
  let interval = sessionClaimed ? FOREGROUND_POLL_CLAIMED_MS : FOREGROUND_POLL_ACTIVE_MS
  foregroundPollTimer = setInterval(() => {
    pollForeground()
    const nextInterval = sessionClaimed ? FOREGROUND_POLL_CLAIMED_MS : FOREGROUND_POLL_ACTIVE_MS
    if (nextInterval !== interval) {
      interval = nextInterval
      scheduleForegroundPolling()
    }
  }, interval)
}

function readForegroundProcess(): string | null {
  if (!ptyProcess) {
    return null
  }
  try {
    const name = ptyProcess.process
    return typeof name === 'string' && name.length > 0 ? name : null
  } catch {
    return null
  }
}

function createTerminal(message: CreateMessage): void {
  if (ptyProcess) {
    return
  }

  try {
    cachedShellProcess = basename(message.shellPath)
    setupSignalDetection(message)

    ptyProcess = pty.spawn(message.shellPath, message.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: message.cwd,
      env: message.env,
    })

    ptyProcess.onData((data: string) => {
      send({ type: 'data', data })
      signalTerminal?.write(data)
    })

    ptyProcess.onExit((exit: { exitCode: number; signal?: number }) => {
      send({
        type: 'exit',
        exitCode: exit.exitCode ?? 0,
      })
      teardownSignalDetection()
      process.exit(0)
    })

    scheduleForegroundPolling()
    send({ type: 'ready', pid: ptyProcess.pid })
  } catch (error) {
    reportError(error)
    process.exit(1)
  }
}

function teardownSignalDetection(): void {
  if (foregroundPollTimer !== null) {
    clearInterval(foregroundPollTimer)
    foregroundPollTimer = null
  }
  disposeSignalParser?.()
  disposeSignalParser = null
  interpreterRuntime?.dispose()
  interpreterRuntime = null
  try {
    signalTerminal?.dispose()
  } catch {
    // best-effort teardown
  }
  signalTerminal = null
}

function waitForInactivity(message: WaitForInactivityMessage): void {
  if (!ptyProcess) {
    send({ type: 'inactive', requestId: message.requestId })
    return
  }

  let timeout = setTimeout(() => {
    dataListener.dispose()
    send({ type: 'inactive', requestId: message.requestId })
  }, message.durationMs)

  const dataListener = ptyProcess.onData(() => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      dataListener.dispose()
      send({ type: 'inactive', requestId: message.requestId })
    }, message.durationMs)
  })
}

process.on('message', (message: HostMessage) => {
  try {
    switch (message.type) {
      case 'create':
        createTerminal(message)
        break
      case 'write':
        ptyProcess?.write(message.data)
        // A write is user input; let interpreters re-arm (e.g. codex next turn).
        interpreterRuntime?.push({ kind: 'userInput' })
        break
      case 'resize':
        ptyProcess?.resize(message.cols, message.rows)
        signalTerminal?.resize(message.cols, message.rows)
        break
      case 'waitForInactivity':
        waitForInactivity(message)
        break
      case 'kill':
        ptyProcess?.kill()
        teardownSignalDetection()
        process.exit(0)
        break
    }
  } catch (error) {
    reportError(error)
  }
})

process.once('disconnect', () => {
  try {
    ptyProcess?.kill()
  } catch {
    // The parent process is gone; best-effort cleanup only.
  }

  process.exit(0)
})
