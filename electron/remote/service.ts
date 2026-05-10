import { constants, verify as verifySignature } from 'node:crypto'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type { App } from 'electron'
import QRCode from 'qrcode'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import type { RemoteAccessStatus } from '../../src/types/terminay'
import type { RemoteAccessSettings } from '../../src/types/settings'
import {
  parseRemoteClientMessage,
  type RemoteClientMessage,
  type RemoteServerMessage,
  type RemoteSessionSnapshot,
  type RemoteSessionSummary,
} from '../../src/remote/protocol'
import { ChallengeStore, serializeDeviceChallenge } from './challengeStore'
import { AuditStore } from './auditStore'
import {
  resolveRemoteAccessConfig,
  readRemoteAccessConfig,
  type ResolvedRemoteAccessConfig,
} from './config'
import { ConnectionStore } from './connectionStore'
import { DeviceStore } from './deviceStore'
import { PairingManager } from './pairing'
import { ensureTlsMaterial } from './tls'

type TerminalRemoteMetadata = {
  color: string
  emoji: string
  inheritsProjectColor?: boolean
  title: string
  viewportHeight?: number
  viewportWidth?: number
  projectId?: string
  projectTitle?: string
  projectEmoji?: string
  projectColor?: string
}

type SessionRecord = {
  buffer: string
  cols: number
  exitCode: number | null
  metadata: TerminalRemoteMetadata
  rows: number
}

type RemoteAccessServiceOptions = {
  app: App
  getControllableSession: (
    sessionId: string,
  ) => { close: () => void; resize: (cols: number, rows: number) => void; write: (data: string) => void } | null
  getRemoteAccessSettings: () => RemoteAccessSettings
  onStatusChanged: (status: RemoteAccessStatus) => void
  publicDir: string
  rendererDistDir: string
  saveGeneratedTlsPaths: (paths: { certPath: string; keyPath: string }) => Promise<void> | void
}

type JsonResponse = Record<string, unknown>

const MAX_BUFFER_LENGTH = 200_000

function appendToBuffer(current: string, chunk: string): string {
  const next = current + chunk
  if (next.length <= MAX_BUFFER_LENGTH) {
    return next
  }

  return next.slice(next.length - MAX_BUFFER_LENGTH)
}

function normalizePem(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function jsonResponse(body: JsonResponse, status = 200): { body: Buffer; contentType: string; status: number } {
  return {
    body: Buffer.from(JSON.stringify(body)),
    contentType: 'application/json; charset=utf-8',
    status,
  }
}

function getContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  switch (extension) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'application/octet-stream'
  }
}

async function readJsonBody<T>(request: import('node:http').IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

export class RemoteAccessService {
  private readonly app: App
  private readonly auditStore: AuditStore
  private readonly challengeStore = new ChallengeStore()
  private readonly connectionStore = new ConnectionStore()
  private readonly deviceStore: DeviceStore
  private readonly getControllableSession: RemoteAccessServiceOptions['getControllableSession']
  private readonly getRemoteAccessSettings: RemoteAccessServiceOptions['getRemoteAccessSettings']
  private readonly onStatusChanged: RemoteAccessServiceOptions['onStatusChanged']
  private readonly pairingManager = new PairingManager()
  private readonly publicDir: string
  private readonly remoteDir: string
  private readonly rendererDistDir: string
  private readonly saveGeneratedTlsPaths: RemoteAccessServiceOptions['saveGeneratedTlsPaths']
  private readonly sessions = new Map<string, SessionRecord>()
  private config: ResolvedRemoteAccessConfig | null = null
  private errorMessage: string | null = null
  private httpsServer: https.Server | null = null
  private pairingQrCodeDataUrl: string | null = null
  private pairingQrCodePath: string | null = null
  private pairingUrl: string | null = null
  private rotatePairingTimer: NodeJS.Timeout | null = null
  private selectedPairingAddress: string | null = null
  private readonly wsServer = new WebSocketServer({ noServer: true })

  constructor(options: RemoteAccessServiceOptions) {
    this.app = options.app
    this.getControllableSession = options.getControllableSession
    this.getRemoteAccessSettings = options.getRemoteAccessSettings
    this.onStatusChanged = options.onStatusChanged
    this.publicDir = options.publicDir
    this.rendererDistDir = options.rendererDistDir
    this.saveGeneratedTlsPaths = options.saveGeneratedTlsPaths
    this.remoteDir = path.join(this.app.getPath('userData'), 'remote-access')
    this.auditStore = new AuditStore(path.join(this.remoteDir, 'audit-log.json'))
    this.deviceStore = new DeviceStore(path.join(this.remoteDir, 'devices.json'))
  }

  getStatus(): RemoteAccessStatus {
    const availableAddresses = this.httpsServer ? this.getAvailableAddresses() : []

    return {
      activeConnectionCount: this.connectionStore.count(),
      auditEvents: this.auditStore.listRecent(),
      availableAddresses,
      connections: this.connectionStore.list().map((connection) => {
        const device = this.deviceStore.get(connection.deviceId)
        return {
          attachedSessionCount: connection.attachedSessionIds.size,
          connectionId: connection.connectionId,
          deviceId: connection.deviceId,
          deviceName: device?.name ?? 'Unknown Device',
        }
      }),
      configurationIssue: this.getConfigurationIssue(),
      configurationPath: 'File > Settings > Remote Access',
      errorMessage: this.errorMessage,
      isRunning: this.httpsServer !== null,
      origin: this.config?.origin ?? null,
      pairedDeviceCount: this.deviceStore.listActive().length,
      pairedDevices: this.deviceStore.listActive().map((device) => ({
        addedAt: device.addedAt,
        deviceId: device.id,
        lastSeenAt: device.lastSeenAt,
        name: device.name,
        origin: device.origin,
      })),
      pairingExpiresAt:
        this.pairingManager.getExpiresAt() === null
          ? null
          : new Date(this.pairingManager.getExpiresAt() ?? 0).toISOString(),
      pairingQrCodeDataUrl: this.pairingQrCodeDataUrl,
      pairingQrCodePath: this.pairingQrCodePath,
      pairingUrl: this.pairingUrl,
    }
  }

  notifyStatusChanged(): void {
    this.emitStatus()
  }

  async toggle(): Promise<RemoteAccessStatus> {
    if (this.httpsServer) {
      await this.stop()
      return this.getStatus()
    }

    try {
      await this.start()
    } catch {
      // `start()` records the configuration/runtime error into service state.
      // The renderer should receive status, not a thrown IPC exception.
    }
    return this.getStatus()
  }

  async revokeDevice(deviceId: string): Promise<RemoteAccessStatus> {
    const device = this.deviceStore.get(deviceId)
    await this.deviceStore.revoke(deviceId)
    this.connectionStore.closeConnectionsForDevice(deviceId)
    await this.auditStore.append({
      action: 'device-revoked',
      connectionId: null,
      deviceId,
      deviceName: device?.name ?? null,
    })
    this.emitStatus()
    return this.getStatus()
  }

  async closeConnection(connectionId: string): Promise<RemoteAccessStatus> {
    const connection = this.connectionStore.get(connectionId)
    if (connection) {
      const device = this.deviceStore.get(connection.deviceId)
      await this.auditStore.append({
        action: 'connection-revoked',
        connectionId,
        deviceId: connection.deviceId,
        deviceName: device?.name ?? null,
      })
      this.connectionStore.closeConnection(connectionId, 4002, 'Connection closed by host')
    }

    this.emitStatus()
    return this.getStatus()
  }

  async setPairingAddress(address: string): Promise<RemoteAccessStatus> {
    this.selectedPairingAddress = address
    await this.rotatePairingCode()
    this.emitStatus()
    return this.getStatus()
  }

  ensureSession(id: string): void {
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        buffer: '',
        cols: 80,
        exitCode: null,
        metadata: {
          color: '#4db5ff',
          emoji: '',
          title: 'Terminal',
          viewportHeight: 0,
          viewportWidth: 0,
        },
        rows: 24,
      })
    }

    this.broadcast({
      session: this.toSessionSummary(id, this.sessions.get(id)!),
      type: 'session-updated',
    })
  }

  appendSessionData(id: string, data: string): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }

    session.buffer = appendToBuffer(session.buffer, data)
    for (const connection of this.connectionStore.list()) {
      if (connection.attachedSessionIds.has(id)) {
        this.send(connection.socket, {
          payload: data,
          sessionId: id,
          type: 'output',
        })
      }
    }
  }

  markSessionExit(id: string, exitCode: number): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }

    session.exitCode = exitCode
    this.broadcast({
      exitCode,
      sessionId: id,
      type: 'exit',
    })
    this.broadcast({
      session: this.toSessionSummary(id, session),
      type: 'session-updated',
    })
  }

  removeSession(id: string): void {
    this.sessions.delete(id)
    for (const connection of this.connectionStore.list()) {
      connection.attachedSessionIds.delete(id)
    }
    this.broadcast({ id, type: 'session-closed' })
  }

  updateSessionMetadata(id: string, metadata: Partial<TerminalRemoteMetadata>): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }

    session.metadata = { ...session.metadata, ...metadata }
    this.broadcast({
      session: this.toSessionSummary(id, session),
      type: 'session-updated',
    })
  }

  updateSessionSize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session) {
      return
    }

    const nextCols = Math.max(2, Math.floor(cols))
    const nextRows = Math.max(1, Math.floor(rows))
    if (session.cols === nextCols && session.rows === nextRows) {
      return
    }

    session.cols = nextCols
    session.rows = nextRows
    this.broadcast({
      session: this.toSessionSummary(id, session),
      type: 'session-updated',
    })
  }

  private getConfigurationIssue(): string | null {
    try {
      resolveRemoteAccessConfig(readRemoteAccessConfig(this.getRemoteAccessSettings()))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'Remote access configuration is invalid.'
    }
  }

  private getAvailableAddresses(): string[] {
    try {
      const config = this.config ?? resolveRemoteAccessConfig(readRemoteAccessConfig(this.getRemoteAccessSettings()))
      const urls = new Set<string>()
      const defaultPort = config.port === 443
      const portSegment = defaultPort ? '' : `:${config.port}`

      const addresses: string[] = []

      // Always allow explicit host from config if it's not a localhost address
      if (config.host !== 'localhost' && config.host !== '127.0.0.1') {
        addresses.push(config.host)
      }

      if (config.bindAddress === '0.0.0.0' || config.bindAddress === '::') {
        for (const [, netInterface] of Object.entries(os.networkInterfaces())) {
          for (const addr of netInterface ?? []) {
            if (addr.internal || addr.family !== 'IPv4') {
              continue
            }
            addresses.push(addr.address)
          }
        }
      } else if (!config.bindAddress.includes(':')) {
        addresses.push(config.bindAddress)
      }

      // De-duplicate addresses
      const uniqueAddresses = Array.from(new Set(addresses))

      // Sort unique addresses: 192.* > 10.* > others
      uniqueAddresses.sort((a, b) => {
        const a192 = a.startsWith('192.')
        const b192 = b.startsWith('192.')
        if (a192 && !b192) return -1
        if (!a192 && b192) return 1

        const a10 = a.startsWith('10.')
        const b10 = b.startsWith('10.')
        if (a10 && !b10) return -1
        if (!a10 && b10) return 1

        return a.localeCompare(b, undefined, { numeric: true })
      })

      for (const host of uniqueAddresses) {
        urls.add(`https://${host}${portSegment}`)
      }

      // If no external addresses were found, then we'll allow localhost as a fallback
      if (urls.size === 0) {
        urls.add(`https://localhost${portSegment}`)
      }

      return Array.from(urls)
    } catch {
      return []
    }
  }

  private async start(): Promise<void> {
    this.errorMessage = null

    try {
      this.config = resolveRemoteAccessConfig(readRemoteAccessConfig(this.getRemoteAccessSettings()))
      await this.deviceStore.load()
      await this.auditStore.load()

      const tlsMaterial = await ensureTlsMaterial(this.config, this.remoteDir)
      if (tlsMaterial.isSelfSigned) {
        await this.saveGeneratedTlsPaths({
          certPath: tlsMaterial.certPath,
          keyPath: tlsMaterial.keyPath,
        })
        this.config = resolveRemoteAccessConfig(readRemoteAccessConfig(this.getRemoteAccessSettings()))
      }

      await this.rotatePairingCode()

      this.httpsServer = https.createServer(
        {
          cert: tlsMaterial.cert,
          key: tlsMaterial.key,
        },
        (request, response) => {
          void this.handleRequest(request, response)
        },
      )

      this.httpsServer.on('upgrade', (request, socket, head) => {
        void this.handleUpgrade(request, socket, head)
      })

      await new Promise<void>((resolve, reject) => {
        this.httpsServer?.once('error', reject)
        this.httpsServer?.listen(this.config?.port, this.config?.bindAddress, () => {
          this.httpsServer?.off('error', reject)
          resolve()
        })
      })

      this.emitStatus()
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Unable to start remote access.'
      await this.stop()
      throw error
    }
  }

  private async stop(): Promise<void> {
    if (this.rotatePairingTimer) {
      clearTimeout(this.rotatePairingTimer)
      this.rotatePairingTimer = null
    }

    for (const connection of this.connectionStore.list()) {
      connection.socket.close(1001, 'Remote access stopped')
    }

    await new Promise<void>((resolve) => {
      this.wsServer.close(() => resolve())
    })

    if (this.httpsServer) {
      await new Promise<void>((resolve) => {
        this.httpsServer?.close(() => resolve())
      })
    }

    this.httpsServer = null
    this.config = null
    this.pairingQrCodeDataUrl = null
    this.pairingQrCodePath = null
    this.pairingUrl = null
    this.emitStatus()
  }

  private emitStatus(): void {
    this.onStatusChanged(this.getStatus())
  }

  private async rotatePairingCode(): Promise<void> {
    if (!this.config) {
      return
    }

    const available = this.getAvailableAddresses()
    const currentOrigin =
      this.selectedPairingAddress && available.includes(this.selectedPairingAddress)
        ? this.selectedPairingAddress
        : available[0] || this.config.origin

    const payload = this.pairingManager.create(currentOrigin)
    this.pairingUrl = payload.pairingUrl
    this.pairingQrCodePath = path.join(this.remoteDir, 'pairing-qr.png')
    await fs.mkdir(this.remoteDir, { recursive: true })
    await QRCode.toFile(this.pairingQrCodePath, payload.pairingUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 720,
    })
    this.pairingQrCodeDataUrl = await QRCode.toDataURL(payload.pairingUrl, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 720,
    })

    if (this.rotatePairingTimer) {
      clearTimeout(this.rotatePairingTimer)
    }

    const delay = Math.max(5_000, new Date(payload.pairingExpiresAt).getTime() - Date.now())
    this.rotatePairingTimer = setTimeout(() => {
      void this.rotatePairingCode().then(() => this.emitStatus())
    }, delay)
  }

  private async handleRequest(
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    try {
      const config = this.config
      if (!config) {
        throw new Error('Remote access is not running.')
      }

      const requestBaseOrigin = this.getRequestBaseOrigin(request, config.origin)
      const requestUrl = new URL(request.url ?? '/', requestBaseOrigin)

      if (request.method === 'GET') {
        const staticResponse = await this.handleStaticRequest(requestUrl.pathname)
        if (staticResponse) {
          response.writeHead(staticResponse.status, {
            'cache-control': requestUrl.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
            'content-security-policy':
              "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            'content-type': staticResponse.contentType,
            'x-content-type-options': 'nosniff',
          })
          response.end(staticResponse.body)
          return
        }
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/pairing/start') {
        const requestOrigin = this.assertOrigin(request, requestUrl.origin)
        const body = await readJsonBody<{
          deviceName: string
          pairingSessionId: string
          pairingToken: string
          publicKeyPem: string
        }>(request)

        const result = await this.pairingManager.startRegistration({
          deviceName: body.deviceName,
          origin: requestOrigin,
          pairingSessionId: body.pairingSessionId,
          pairingToken: body.pairingToken,
          publicKeyPem: normalizePem(body.publicKeyPem),
        })

        this.writeResponse(
          response,
          jsonResponse({
            provisionalDeviceId: result.provisionalDeviceId,
          }),
        )
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/pairing/complete') {
        const requestOrigin = this.assertOrigin(request, requestUrl.origin)
        const body = await readJsonBody<{
          provisionalDeviceId: string
        }>(request)

        const pending = this.pairingManager.consumeRegistration({
          origin: requestOrigin,
          provisionalDeviceId: body.provisionalDeviceId,
        })
        const device = await this.deviceStore.create({
          name: pending.deviceName,
          origin: pending.origin,
          publicKeyPem: pending.publicKeyPem,
        })

        this.pairingManager.invalidateSession(pending.pairingSessionId)
        await this.auditStore.append({
          action: 'pairing-completed',
          connectionId: null,
          deviceId: device.id,
          deviceName: device.name,
        })
        await this.rotatePairingCode()
        this.emitStatus()

        this.writeResponse(
          response,
          jsonResponse({
            deviceId: device.id,
            deviceName: device.name,
          }),
        )
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/options') {
        const requestOrigin = this.assertOrigin(request, requestUrl.origin)
        const body = await readJsonBody<{ deviceId: string }>(request)
        const device = this.deviceStore.get(body.deviceId)
        if (!device) {
          throw new Error('This device is not paired with this host.')
        }
        if (device.origin !== requestOrigin) {
          throw new Error('This device is paired with a different origin.')
        }

        const challenge = await this.challengeStore.create({
          deviceId: device.id,
          origin: device.origin,
        })

        this.writeResponse(
          response,
          jsonResponse({
            deviceChallenge: challenge.payload,
            signingInput: challenge.signingInput,
          }),
        )
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/verify') {
        const requestOrigin = this.assertOrigin(request, requestUrl.origin)
        const body = await readJsonBody<{
          challengeId: string
          deviceId: string
          deviceSignature: string
        }>(request)

        const device = this.deviceStore.get(body.deviceId)
        if (!device) {
          throw new Error('This device is no longer trusted.')
        }
        if (device.origin !== requestOrigin) {
          throw new Error('This device is paired with a different origin.')
        }

        const challenge = this.challengeStore.consume(body.challengeId, body.deviceId, requestOrigin)
        const verifiedDeviceSignature = verifySignature(
          'sha256',
          Buffer.from(serializeDeviceChallenge(challenge.payload)),
          {
            key: normalizePem(device.publicKeyPem),
            padding: constants.RSA_PKCS1_PSS_PADDING,
            saltLength: 32,
          },
          Buffer.from(body.deviceSignature, 'base64url'),
        )

        if (!verifiedDeviceSignature) {
          throw new Error('The paired device key signature was invalid.')
        }

        await this.deviceStore.updateAuthentication(device.id)
        await this.auditStore.append({
          action: 'auth-verified',
          connectionId: null,
          deviceId: device.id,
          deviceName: device.name,
        })

        const ticket = this.connectionStore.issueTicket(device.id)
        this.emitStatus()

        this.writeResponse(
          response,
          jsonResponse({
            ticket,
            websocketUrl: `${requestOrigin.replace(/^https:/, 'wss:')}/ws?ticket=${encodeURIComponent(ticket)}`,
          }),
        )
        return
      }

      this.writeResponse(response, jsonResponse({ error: 'Not found' }, 404))
    } catch (error) {
      this.writeResponse(
        response,
        jsonResponse(
          {
            error: error instanceof Error ? error.message : 'Unexpected remote access error.',
          },
          400,
        ),
      )
    }
  }

  private async handleStaticRequest(
    pathname: string,
  ): Promise<{ body: Buffer; contentType: string; status: number } | null> {
    const cleanedPath = pathname === '/' ? '/remote.html' : pathname
    const safeRelative = cleanedPath.replace(/^\/+/, '')
    const candidateDist = path.resolve(this.rendererDistDir, safeRelative)
    const candidatePublic = path.resolve(this.publicDir, safeRelative)

    if (candidateDist.startsWith(path.resolve(this.rendererDistDir))) {
      try {
        const body = await fs.readFile(candidateDist)
        return {
          body,
          contentType: getContentType(candidateDist),
          status: 200,
        }
      } catch {
        // Fall through.
      }
    }

    if (candidatePublic.startsWith(path.resolve(this.publicDir))) {
      try {
        const body = await fs.readFile(candidatePublic)
        return {
          body,
          contentType: getContentType(candidatePublic),
          status: 200,
        }
      } catch {
        // Fall through.
      }
    }

    return null
  }

  private async handleUpgrade(
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      const config = this.config
      if (!config) {
        throw new Error('Remote access is not running.')
      }

      const requestBaseOrigin = this.getRequestBaseOrigin(request, config.origin)
      const requestUrl = new URL(request.url ?? '/', requestBaseOrigin)
      if (requestUrl.pathname !== '/ws') {
        throw new Error('Unknown WebSocket endpoint.')
      }

      const ticket = requestUrl.searchParams.get('ticket')
      if (!ticket) {
        throw new Error('Missing WebSocket ticket.')
      }

      const ticketInfo = this.connectionStore.consumeTicket(ticket)
      const device = this.deviceStore.get(ticketInfo.deviceId)
      if (!device) {
        throw new Error('This device is no longer trusted.')
      }
      this.assertOrigin(request, device.origin)

      this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
        const connection = this.connectionStore.register(websocket, ticketInfo.connectionId, ticketInfo.deviceId)
        void this.auditStore
          .append({
            action: 'connection-opened',
            connectionId: connection.connectionId,
            deviceId: connection.deviceId,
            deviceName: this.deviceStore.get(connection.deviceId)?.name ?? null,
          })
          .then(() => this.emitStatus())
        this.attachWebSocket(websocket, connection.connectionId)
        this.sendSessionList(connection.socket, connection.connectionId)
        this.emitStatus()
      })
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
    }
  }

  private attachWebSocket(socket: WebSocket, connectionId: string): void {
    socket.on('message', (message) => {
      const connection = this.connectionStore.get(connectionId)
      if (!connection) {
        return
      }

      const parsed = parseRemoteClientMessage(message.toString())
      if (!parsed) {
        this.send(socket, { message: 'Invalid remote message.', type: 'error' })
        return
      }

      this.handleClientMessage(connectionId, parsed)
    })

    socket.on('close', () => {
      const connection = this.connectionStore.get(connectionId)
      this.connectionStore.unregister(connectionId)
      void this.auditStore
        .append({
          action: 'connection-closed',
          connectionId,
          deviceId: connection?.deviceId ?? null,
          deviceName: connection ? (this.deviceStore.get(connection.deviceId)?.name ?? null) : null,
        })
        .then(() => this.emitStatus())
      this.emitStatus()
    })
  }

  private handleClientMessage(connectionId: string, message: RemoteClientMessage): void {
    const connection = this.connectionStore.get(connectionId)
    if (!connection) {
      return
    }

    if (message.connectionId !== connection.connectionId) {
      this.send(connection.socket, { message: 'Connection identity mismatch.', type: 'error' })
      return
    }

    if (message.seq <= connection.highestSeq) {
      this.send(connection.socket, { message: 'Stale or replayed message rejected.', type: 'error' })
      return
    }

    connection.highestSeq = message.seq

    switch (message.type) {
      case 'list-sessions':
        this.sendSessionList(connection.socket, connection.connectionId)
        return
      case 'attach-session': {
        const session = this.sessions.get(message.sessionId)
        if (!session) {
          this.send(connection.socket, { message: 'That terminal session no longer exists.', type: 'error' })
          return
        }

        connection.attachedSessionIds.add(message.sessionId)
        this.send(connection.socket, {
          session: this.toSessionSnapshot(message.sessionId, session),
          type: 'session-opened',
        })
        return
      }
      case 'detach-session':
        connection.attachedSessionIds.delete(message.sessionId)
        return
      case 'write': {
        if (!connection.attachedSessionIds.has(message.sessionId)) {
          this.send(connection.socket, { message: 'Attach to a session before sending input.', type: 'error' })
          return
        }

        this.getControllableSession(message.sessionId)?.write(message.payload)
        return
      }
      case 'resize': {
        if (!connection.attachedSessionIds.has(message.sessionId)) {
          this.send(connection.socket, { message: 'Attach to a session before resizing it.', type: 'error' })
          return
        }

        this.getControllableSession(message.sessionId)?.resize(
          Math.max(2, Math.floor(message.cols)),
          Math.max(1, Math.floor(message.rows)),
        )
        return
      }
      case 'ping':
        this.send(connection.socket, { seq: message.seq, type: 'pong' })
        return
    }
  }

  private sendSessionList(socket: WebSocket, connectionId: string): void {
    this.send(socket, {
      connectionCount: this.connectionStore.count(),
      connectionId,
      sessions: Array.from(this.sessions.entries()).map(([id, session]) => this.toSessionSummary(id, session)),
      type: 'session-list',
    })
  }

  private toSessionSummary(id: string, session: SessionRecord): RemoteSessionSummary {
    return {
      color: session.metadata.color,
      cols: session.cols,
      emoji: session.metadata.emoji,
      exitCode: session.exitCode,
      id,
      rows: session.rows,
      title: session.metadata.title,
      viewportHeight: session.metadata.viewportHeight,
      viewportWidth: session.metadata.viewportWidth,
      projectId: session.metadata.projectId,
      projectTitle: session.metadata.projectTitle,
      projectEmoji: session.metadata.projectEmoji,
      projectColor: session.metadata.projectColor,
    }
  }

  private toSessionSnapshot(id: string, session: SessionRecord): RemoteSessionSnapshot {
    return {
      ...this.toSessionSummary(id, session),
      buffer: session.buffer,
    }
  }

  private broadcast(message: RemoteServerMessage): void {
    for (const connection of this.connectionStore.list()) {
      if (message.type === 'output' && !connection.attachedSessionIds.has(message.sessionId)) {
        continue
      }

      this.send(connection.socket, message)
    }
  }

  private send(socket: WebSocket, message: RemoteServerMessage): void {
    if (socket.readyState !== socket.OPEN) {
      return
    }

    socket.send(JSON.stringify(message))
  }

  private getRequestBaseOrigin(request: import('node:http').IncomingMessage, fallbackOrigin: string): string {
    const host = request.headers.host?.trim()
    if (!host) {
      return fallbackOrigin
    }

    return `https://${host}`
  }

  private assertOrigin(request: import('node:http').IncomingMessage, expectedOrigin: string): string {
    const origin = request.headers.origin
    if (origin !== expectedOrigin) {
      throw new Error('Origin check failed.')
    }

    return origin
  }

  private writeResponse(
    response: import('node:http').ServerResponse,
    payload: { body: Buffer; contentType: string; status: number },
  ): void {
    response.writeHead(payload.status, {
      'cache-control': 'no-store',
      'content-type': payload.contentType,
      'x-content-type-options': 'nosniff',
    })
    response.end(payload.body)
  }
}
