// ControlServer: bridges the MCP server's local Unix socket to the renderer.
//
// Runs in the Electron main process. The `terminay mcp` subcommand connects to
// a local Unix domain socket and sends newline-delimited JSON ControlRequests.
// We validate the per-terminal capability token, resolve the calling terminal's
// scope, forward the operation to the owning renderer, and write back a
// ControlResponse. Correlation is by request id, so requests on a single
// connection are handled concurrently and may complete out of order.

import { createServer, type Server, type Socket } from 'node:net'
import { chmod, unlink } from 'node:fs/promises'
import type { ControlError, ControlOp, ControlRequest } from './protocol'

// Wire response shape. We keep `result` as unknown here because the renderer
// produces the op-specific payload; the socket only needs to serialize it.
type ControlResponseWire =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: ControlError }
import { createControlMessageDecoder, encodeControlMessage } from './protocol'

export interface ControlServerScope {
  sessionId: string
  webContentsId: number
}

export type ControlForwardResult =
  | { ok: true; result: unknown }
  | { ok: false; error: ControlError }

export interface ControlServerOptions {
  socketPath: string
  /**
   * Resolve a request to its terminal scope, using the capability token when
   * present and otherwise the client pid's process ancestry. Returns null when
   * the caller cannot be matched to a terminal in this instance.
   */
  resolveScope: (
    token: string | undefined,
    pid: number | undefined,
  ) => ControlServerScope | null | Promise<ControlServerScope | null>
  /** Forward a validated request to the owning renderer and await its reply. */
  forward: (scope: ControlServerScope, op: ControlOp, params: unknown) => Promise<ControlForwardResult>
  /** Optional diagnostics sink. */
  onError?: (error: unknown) => void
}

export interface ControlServer {
  start(): Promise<void>
  stop(): Promise<void>
  readonly socketPath: string
  readonly listening: boolean
}

const UNRESOLVED_SCOPE_ERROR: ControlError = {
  code: 'not_in_terminay',
  message: 'Could not determine which Terminay terminal this request came from.',
}

export function createControlServer(options: ControlServerOptions): ControlServer {
  const { socketPath, resolveScope, forward } = options

  let server: Server | null = null
  let isListening = false
  const connections = new Set<Socket>()

  function reportError(error: unknown): void {
    options.onError?.(error)
  }

  async function unlinkSocketFile(): Promise<void> {
    try {
      await unlink(socketPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        reportError(error)
      }
    }
  }

  function writeResponse(socket: Socket, response: ControlResponseWire): void {
    if (!socket.writable) {
      return
    }
    try {
      socket.write(encodeControlMessage(response))
    } catch (error) {
      reportError(error)
    }
  }

  async function handleRequest(socket: Socket, request: ControlRequest): Promise<void> {
    const id = request?.id
    if (typeof id !== 'string') {
      // Cannot correlate a reply without an id; drop silently.
      return
    }

    const scope = await resolveScope(request.token, request.pid)
    if (!scope) {
      writeResponse(socket, { id, ok: false, error: UNRESOLVED_SCOPE_ERROR })
      return
    }

    try {
      const result = await forward(scope, request.op, request.params)
      if (result.ok) {
        writeResponse(socket, { id, ok: true, result: result.result })
      } else {
        writeResponse(socket, { id, ok: false, error: result.error })
      }
    } catch (error) {
      reportError(error)
      writeResponse(socket, {
        id,
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  function handleConnection(socket: Socket): void {
    connections.add(socket)
    socket.setEncoding('utf8')

    const decode = createControlMessageDecoder<ControlRequest>((_line, error) => {
      reportError(error)
    })

    socket.on('data', (chunk: string) => {
      let requests: ControlRequest[]
      try {
        requests = decode(chunk)
      } catch (error) {
        reportError(error)
        return
      }
      for (const request of requests) {
        void handleRequest(socket, request).catch(reportError)
      }
    })

    socket.on('error', (error) => {
      reportError(error)
    })

    socket.on('close', () => {
      connections.delete(socket)
    })
  }

  async function start(): Promise<void> {
    if (isListening) {
      return
    }

    await unlinkSocketFile()

    await new Promise<void>((resolve, reject) => {
      const nextServer = createServer((socket) => {
        try {
          handleConnection(socket)
        } catch (error) {
          reportError(error)
          socket.destroy()
        }
      })

      const onListening = (): void => {
        nextServer.off('error', onError)
        server = nextServer
        isListening = true
        resolve()
      }

      const onError = (error: unknown): void => {
        nextServer.off('listening', onListening)
        reject(error)
      }

      nextServer.once('listening', onListening)
      nextServer.once('error', onError)
      nextServer.on('error', (error) => {
        reportError(error)
      })

      nextServer.listen(socketPath)
    })

    try {
      await chmod(socketPath, 0o600)
    } catch (error) {
      reportError(error)
    }
  }

  async function stop(): Promise<void> {
    if (!isListening || !server) {
      return
    }

    const closing = server
    server = null
    isListening = false

    await new Promise<void>((resolve) => {
      closing.close(() => {
        resolve()
      })
      for (const socket of connections) {
        socket.destroy()
      }
      connections.clear()
    })

    await unlinkSocketFile()
  }

  return {
    start,
    stop,
    get socketPath() {
      return socketPath
    },
    get listening() {
      return isListening
    },
  }
}
