import { promises as fs } from 'node:fs'
import path from 'node:path'

export type RemoteAuditEvent = {
  action:
    | 'pairing-completed'
    | 'auth-verified'
    | 'device-revoked'
    | 'connection-opened'
    | 'connection-closed'
    | 'connection-revoked'
  connectionId: string | null
  deviceId: string | null
  deviceName: string | null
  occurredAt: string
  reason?: string
}

const MAX_EVENTS = 200

export class AuditStore {
  private events: RemoteAuditEvent[] = []

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as RemoteAuditEvent[]
      this.events = Array.isArray(parsed) ? parsed : []
    } catch {
      this.events = []
    }
  }

  listRecent(limit = 20): RemoteAuditEvent[] {
    return this.events.slice(-limit).reverse()
  }

  async append(event: Omit<RemoteAuditEvent, 'occurredAt'>): Promise<void> {
    this.events.push({
      ...event,
      occurredAt: new Date().toISOString(),
    })

    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_EVENTS)
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(this.events, null, 2), 'utf8')
  }
}
