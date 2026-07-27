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
import type { ControlError, ControlOp } from './protocol'

// Wire response shape. We keep `result` as unknown here because the renderer
// produces the op-specific payload; the socket only needs to serialize it.
type ControlResponseWire =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: ControlError }
import {
  CONTROL_MAX_FRAME_BYTES,
  CONTROL_MAX_RESPONSE_BYTES,
  createControlMessageDecoder,
  encodeControlMessage,
  isControlRequest,
} from './protocol'

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
   * Resolve a valid terminal capability to its exact current scope. Request
   * body process ids are never an authority source.
   */
  resolveScope: (token: string) => ControlServerScope | null | Promise<ControlServerScope | null>
  /** Forward a validated request to the owning renderer and await its reply. */
  forward: (
    scope: ControlServerScope,
    op: ControlOp,
    params: unknown,
    context: { signal: AbortSignal },
  ) => Promise<ControlForwardResult>
  maxFrameBytes?: number
  maxInFlight?: number
  maxTotalInFlight?: number
  maxResponseBytes?: number
  requestTimeoutMs?: number
  /** Optional diagnostics sink. */
  onError?: (error: unknown) => void
}

export interface ControlServer {
  start(): Promise<void>
  stop(): Promise<void>
  readonly socketPath: string
  readonly listening: boolean
}

const INVALID_CAPABILITY_ERROR: ControlError = {
  code: 'invalid_token',
  message: 'The Terminay terminal capability is missing, invalid, stale, or no longer owns this scope.',
}

export function createControlServer(options: ControlServerOptions): ControlServer {
  const { socketPath, resolveScope, forward } = options
  const maxFrameBytes = options.maxFrameBytes ?? CONTROL_MAX_FRAME_BYTES
  const maxInFlight = options.maxInFlight ?? 8
  const maxTotalInFlight = options.maxTotalInFlight ?? 64
  const maxResponseBytes = options.maxResponseBytes ?? CONTROL_MAX_RESPONSE_BYTES
  const requestTimeoutMs = options.requestTimeoutMs ?? 120_000

  let server: Server | null = null
  let isListening = false
  const connections = new Set<Socket>()
  const inFlightBySocket = new Map<Socket, Map<string, AbortController>>()
  const allInFlight = new Set<AbortController>()

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
      let encoded = encodeControlMessage(response)
      if (Buffer.byteLength(encoded, 'utf8') > maxResponseBytes) {
        encoded = encodeControlMessage({
          id: response.id,
          ok: false,
          error: {
            code: 'limit_exceeded',
            message: `The control response exceeded the ${maxResponseBytes}-byte limit.`,
          },
        } satisfies ControlResponseWire)
      }
      if (socket.writableLength + Buffer.byteLength(encoded, 'utf8') > maxResponseBytes * 2) {
        socket.destroy(new Error('Control client is not reading bounded responses.'))
        return
      }
      socket.write(encoded)
    } catch (error) {
      reportError(error)
    }
  }

  async function handleRequest(socket: Socket, value: unknown): Promise<void> {
    const candidateId =
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { id?: unknown }).id === 'string'
        ? (value as { id: string }).id
        : null
    if (!isControlRequest(value)) {
      if (candidateId && candidateId.length <= 128) {
        writeResponse(socket, {
          id: candidateId,
          ok: false,
          error: { code: 'bad_request', message: 'Malformed control request envelope.' },
        })
      } else {
        socket.destroy()
      }
      return
    }
    const request = value
    const requests = inFlightBySocket.get(socket)
    if (!requests || !socket.writable) {
      return
    }
    if (requests.has(request.id)) {
      writeResponse(socket, {
        id: request.id,
        ok: false,
        error: { code: 'bad_request', message: 'A request with this id is already in flight.' },
      })
      return
    }
    if (requests.size >= maxInFlight) {
      writeResponse(socket, {
        id: request.id,
        ok: false,
        error: {
          code: 'limit_exceeded',
          message: `At most ${maxInFlight} control requests may be in flight on one connection.`,
        },
      })
      return
    }
    if (allInFlight.size >= maxTotalInFlight) {
      writeResponse(socket, {
        id: request.id,
        ok: false,
        error: {
          code: 'limit_exceeded',
          message: `At most ${maxTotalInFlight} control requests may be in flight in this server.`,
        },
      })
      return
    }

    const controller = new AbortController()
    requests.set(request.id, controller)
    allInFlight.add(controller)
    const timeout = setTimeout(() => controller.abort('timeout'), requestTimeoutMs)

    try {
      const operation = (async (): Promise<ControlForwardResult> => {
        const scope = await resolveScope(request.token)
        if (!scope) {
          return { ok: false, error: INVALID_CAPABILITY_ERROR }
        }
        if (controller.signal.aborted) {
          return {
            ok: false,
            error: { code: 'cancelled', message: 'The control request was cancelled.' },
          }
        }
        return forward(scope, request.op, request.params, { signal: controller.signal })
      })()
      const aborted = new Promise<ControlForwardResult>((resolve) => {
        controller.signal.addEventListener(
          'abort',
          () => {
            const timedOut = controller.signal.reason === 'timeout'
            resolve({
              ok: false,
              error: {
                code: timedOut ? 'timeout' : 'cancelled',
                message: timedOut
                  ? `The control request exceeded its ${requestTimeoutMs}ms deadline.`
                  : 'The control request was cancelled because its caller or scope closed.',
              },
            })
          },
          { once: true },
        )
      })
      const result = await Promise.race([operation, aborted])
      if (!socket.writable || controller.signal.reason === 'caller_closed') {
        return
      }
      if (result.ok) {
        writeResponse(socket, { id: request.id, ok: true, result: result.result })
      } else {
        writeResponse(socket, { id: request.id, ok: false, error: result.error })
      }
    } catch (error) {
      reportError(error)
      writeResponse(socket, {
        id: request.id,
        ok: false,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    } finally {
      clearTimeout(timeout)
      requests.delete(request.id)
      allInFlight.delete(controller)
    }
  }

  function handleConnection(socket: Socket): void {
    connections.add(socket)
    const requests = new Map<string, AbortController>()
    inFlightBySocket.set(socket, requests)
    socket.setEncoding('utf8')

    const decode = createControlMessageDecoder<unknown>((_line, error) => {
      reportError(error)
      socket.destroy()
    }, { maxFrameBytes })

    socket.on('data', (chunk: string) => {
      let decodedValues: unknown[]
      try {
        decodedValues = decode(chunk)
      } catch (error) {
        reportError(error)
        return
      }
      for (const value of decodedValues) {
        void handleRequest(socket, value).catch(reportError)
      }
    })

    socket.on('error', (error) => {
      reportError(error)
    })

    socket.on('close', () => {
      for (const controller of requests.values()) {
        controller.abort('caller_closed')
      }
      requests.clear()
      inFlightBySocket.delete(socket)
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
        for (const controller of inFlightBySocket.get(socket)?.values() ?? []) {
          controller.abort('caller_closed')
        }
        socket.destroy()
      }
      inFlightBySocket.clear()
      allInFlight.clear()
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
