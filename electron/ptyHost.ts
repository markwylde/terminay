import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'

const require = createRequire(import.meta.url)
const pty = require('node-pty') as typeof import('node-pty')

type CreateMessage = {
  type: 'create'
  shellPath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
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

function createTerminal(message: CreateMessage): void {
  if (ptyProcess) {
    return
  }

  try {
    ptyProcess = pty.spawn(message.shellPath, message.args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: message.cwd,
      env: message.env,
    })

    ptyProcess.onData((data: string) => {
      send({ type: 'data', data })
    })

    ptyProcess.onExit((exit: { exitCode: number; signal?: number }) => {
      send({
        type: 'exit',
        exitCode: exit.exitCode ?? 0,
      })
      process.exit(0)
    })

    send({ type: 'ready', pid: ptyProcess.pid })
  } catch (error) {
    reportError(error)
    process.exit(1)
  }
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
        break
      case 'resize':
        ptyProcess?.resize(message.cols, message.rows)
        break
      case 'waitForInactivity':
        waitForInactivity(message)
        break
      case 'kill':
        ptyProcess?.kill()
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
