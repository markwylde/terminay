import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'

export type RemoteConnectionPeer = {
  close(code?: number, reason?: string): void
  getReadyState(): number
  send(message: string): void
}

type PendingTicket = {
  deviceId: string
  expiresAt: number
}

export type ActiveConnection = {
  attachedSessionIds: Set<string>
  connectionId: string
  deviceId: string
  highestSeq: number
  socket: RemoteConnectionPeer
}

const TICKET_TTL_MS = 30 * 1000

export class ConnectionStore {
  private readonly activeConnections = new Map<string, ActiveConnection>()
  private readonly tickets = new Map<string, PendingTicket>()

  issueTicket(deviceId: string): string {
    const ticket = randomUUID()
    this.tickets.set(ticket, {
      deviceId,
      expiresAt: Date.now() + TICKET_TTL_MS,
    })
    return ticket
  }

  consumeTicket(ticket: string): { connectionId: string; deviceId: string } {
    const pending = this.tickets.get(ticket)
    if (!pending || pending.expiresAt < Date.now()) {
      this.tickets.delete(ticket)
      throw new Error('This WebSocket ticket has expired.')
    }

    this.tickets.delete(ticket)
    return {
      connectionId: randomUUID(),
      deviceId: pending.deviceId,
    }
  }

  register(socket: RemoteConnectionPeer, connectionId: string, deviceId: string): ActiveConnection {
    const connection: ActiveConnection = {
      attachedSessionIds: new Set(),
      connectionId,
      deviceId,
      highestSeq: 0,
      socket,
    }

    this.activeConnections.set(connectionId, connection)
    return connection
  }

  unregister(connectionId: string): void {
    this.activeConnections.delete(connectionId)
  }

  get(connectionId: string): ActiveConnection | null {
    return this.activeConnections.get(connectionId) ?? null
  }

  list(): ActiveConnection[] {
    return Array.from(this.activeConnections.values())
  }

  count(): number {
    return this.activeConnections.size
  }

  closeConnectionsForDevice(deviceId: string): void {
    for (const connection of this.activeConnections.values()) {
      if (connection.deviceId === deviceId) {
        connection.socket.close(4001, 'Device revoked')
      }
    }
  }

  closeConnection(connectionId: string, code: number, reason: string): boolean {
    const connection = this.activeConnections.get(connectionId)
    if (!connection) {
      return false
    }

    connection.socket.close(code, reason)
    return true
  }
}

export function webSocketPeer(socket: WebSocket): RemoteConnectionPeer {
  return {
    close: (code?: number, reason?: string) => socket.close(code, reason),
    getReadyState: () => socket.readyState,
    send: (message: string) => socket.send(message),
  }
}
