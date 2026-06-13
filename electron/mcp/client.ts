import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import {
  createControlMessageDecoder,
  encodeControlMessage,
} from '../control/protocol'
import type {
  ControlOp,
  ControlParamsByOp,
  ControlResponse,
  ControlResultByOp,
} from '../control/protocol'

export interface ControlClient {
  request<Op extends ControlOp>(op: Op, params: ControlParamsByOp[Op]): Promise<ControlResultByOp[Op]>
  close(): void
}

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

const LOST_CONNECTION_MESSAGE = 'Lost connection to Terminay'

export function createControlClient(opts: { socketPath: string; token?: string }): ControlClient {
  const pending = new Map<string, PendingRequest>()
  let socket: Socket | null = null
  let closed = false

  const decode = createControlMessageDecoder<ControlResponse>()

  const rejectAll = (message: string, code?: string): void => {
    const error = new Error(message)
    if (code) {
      ;(error as Error & { code?: string }).code = code
    }
    for (const entry of pending.values()) {
      entry.reject(error)
    }
    pending.clear()
  }

  const handleResponse = (response: ControlResponse): void => {
    const entry = pending.get(response.id)
    if (!entry) {
      return
    }
    pending.delete(response.id)
    if (response.ok) {
      entry.resolve(response.result)
      return
    }
    const error = new Error(response.error.message)
    ;(error as Error & { code?: string }).code = response.error.code
    ;(error as Error & { candidates?: string[] }).candidates = response.error.candidates
    entry.reject(error)
  }

  const ensureSocket = (): Socket => {
    if (socket) {
      return socket
    }
    const next = connect(opts.socketPath)
    next.setEncoding('utf8')
    next.on('data', (chunk: string) => {
      for (const response of decode(chunk)) {
        handleResponse(response)
      }
    })
    next.on('error', (error: NodeJS.ErrnoException) => {
      socket = null
      if (!closed) {
        // ENOENT / ECONNREFUSED mean Terminay is not listening on the socket.
        const notConnected = error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED'
        rejectAll(LOST_CONNECTION_MESSAGE, notConnected ? 'not_connected' : error?.code)
      }
    })
    next.on('close', () => {
      if (!closed) {
        rejectAll(LOST_CONNECTION_MESSAGE)
      }
    })
    socket = next
    return next
  }

  return {
    request<Op extends ControlOp>(op: Op, params: ControlParamsByOp[Op]): Promise<ControlResultByOp[Op]> {
      if (closed) {
        return Promise.reject(new Error(LOST_CONNECTION_MESSAGE))
      }
      const id = randomUUID()
      return new Promise<ControlResultByOp[Op]>((resolve, reject) => {
        pending.set(id, {
          resolve: resolve as (result: unknown) => void,
          reject,
        })
        try {
          const active = ensureSocket()
          active.write(encodeControlMessage({ id, token: opts.token, pid: process.pid, op, params }))
        } catch (error) {
          pending.delete(id)
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    close(): void {
      if (closed) {
        return
      }
      closed = true
      rejectAll(LOST_CONNECTION_MESSAGE)
      socket?.destroy()
      socket = null
    },
  }
}
