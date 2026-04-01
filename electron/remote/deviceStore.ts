import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type StoredDevice = {
  addedAt: string
  id: string
  lastSeenAt: string | null
  name: string
  origin: string
  publicKeyPem: string
  revokedAt: string | null
}

export type CreateDeviceInput = {
  name: string
  origin: string
  publicKeyPem: string
}

export class DeviceStore {
  private devices = new Map<string, StoredDevice>()

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as StoredDevice[]
      this.devices = new Map(parsed.map((device) => [device.id, device]))
    } catch {
      this.devices = new Map()
    }
  }

  listActive(): StoredDevice[] {
    return Array.from(this.devices.values()).filter((device) => device.revokedAt === null)
  }

  get(deviceId: string): StoredDevice | null {
    const device = this.devices.get(deviceId)
    return device && device.revokedAt === null ? device : null
  }

  async create(input: CreateDeviceInput): Promise<StoredDevice> {
    const device: StoredDevice = {
      addedAt: new Date().toISOString(),
      id: randomUUID(),
      lastSeenAt: null,
      name: input.name.trim() || 'Paired Device',
      origin: input.origin,
      publicKeyPem: input.publicKeyPem,
      revokedAt: null,
    }

    this.devices.set(device.id, device)
    await this.persist()
    return device
  }

  async updateAuthentication(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId)
    if (!device) {
      return
    }

    device.lastSeenAt = new Date().toISOString()
    await this.persist()
  }

  async revoke(deviceId: string): Promise<void> {
    const device = this.devices.get(deviceId)
    if (!device || device.revokedAt) {
      return
    }

    device.revokedAt = new Date().toISOString()
    await this.persist()
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(Array.from(this.devices.values()), null, 2), 'utf8')
  }
}
