import { constants, createHash, verify as verifySignature } from 'node:crypto'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import type { App } from 'electron'
import QRCode from 'qrcode'
import { WebSocketServer } from 'ws'
import WebSocket from 'ws'
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
import { ConnectionStore, webSocketPeer, type RemoteConnectionPeer } from './connectionStore'
import { DeviceStore } from './deviceStore'
import { PairingManager } from './pairing'
import { assertPairingPin } from './pinGuard'
import { readJsonBody } from './jsonBody'
import { ReconnectGrantStore, resolveReconnectGrantLifetime, type ReconnectGrantRecord } from './reconnectGrantStore'
import { ensureTlsMaterial } from './tls'
import { WebRtcPairingManager } from './webrtc'

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

type RemoteSizeOverride =
  | { active: false }
  | {
      active: true
      cols: number
      rows: number
    }

type RemoteAccessServiceOptions = {
  app: App
  createWebRtcHostWindow: (ownerId: number) => {
    close: () => void
    closeTerminal: (channelId: string, reason?: string) => void
    sendConfig: (config: WebRtcHostConfig) => void
    sendSignalMessage: (message: unknown) => void
    sendTerminalMessage: (channelId: string, message: string) => void
    webContentsId: number
  }
  getControllableSession: (
    sessionId: string,
  ) => { close: () => void; resize: (cols: number, rows: number) => void; write: (data: string) => void } | null
  getRemoteAccessSettings: () => RemoteAccessSettings
  notifyTerminalRemoteSizeOverride: (sessionId: string, override: RemoteSizeOverride) => void
  onStatusChanged: (status: RemoteAccessStatus) => void
  publicDir: string
  rendererDistDir: string
  saveGeneratedTlsPaths: (paths: { certPath: string; keyPath: string }) => Promise<void> | void
}

type JsonResponse = Record<string, unknown>

type WebRtcHostConfig = {
  appOrigin: string
  expiresAt: string
  iceServers: Array<{ urls: string | string[] }>
  relayJoinTokenHash: string
  reconnect?: {
    attemptId: string
    protocolVersion: 'v1'
    reconnectHandle: string
    savedSessionExpiresAt: string
    sessionId: string
  }
  roomId: string
  sessionId: string
  signalingAuthToken: string
  signalingUrl: string
}

type WebRtcTerminalPeer = RemoteConnectionPeer & {
  channelId: string
  webContentsId: number
}

type WebRtcHostRuntime = {
  hostWindow: ReturnType<RemoteAccessServiceOptions['createWebRtcHostWindow']>
  ownsSignalSocket: boolean
  ready: boolean
  signalSocket: WebSocket | null
}

type PendingWebRtcReconnect = {
  appOrigin: string
  clientNonce: string
  handle: string
  iceServers: Array<{ urls: string | string[] }>
  origin: string
  sessionId: string
  signalingUrl: string
  socket: WebSocket
  webContentsId: number | null
}

type WebRtcReconnectAvailabilityRuntime = {
  appOrigin: string
  iceServers: Array<{ urls: string | string[] }>
  sessionId: string
  signalingUrl: string
  socket: WebSocket
}

const MAX_BUFFER_LENGTH = 200_000
const MAX_SESSION_SNAPSHOT_BUFFER_LENGTH = 50_000

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

function parseWebRtcIceServers(value: string): Array<{ urls: string | string[] }> {
  const urls = String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => /^(stun|stuns|turn|turns):/i.test(entry))
  return urls.length > 0 ? urls.map((url) => ({ urls: url })) : [{ urls: 'stun:stun.l.google.com:19302' }]
}

function jsonResponse(body: JsonResponse, status = 200): { body: Buffer; contentType: string; status: number } {
  return {
    body: Buffer.from(JSON.stringify(body)),
    contentType: 'application/json; charset=utf-8',
    status,
  }
}

function isAddressInUseError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EADDRINUSE'
}

function isRemoteAppAssetEntry(entry: string): boolean {
  return entry === 'remote.html' || entry === 'remote.webmanifest' || entry === 'terminay.svg' || entry.startsWith('assets/')
}

function isPathInside(candidate: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
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

export class RemoteAccessService {
  private readonly app: App
  private readonly auditStore: AuditStore
  private readonly challengeStore = new ChallengeStore()
  private readonly connectionStore = new ConnectionStore()
  private readonly createWebRtcHostWindow: RemoteAccessServiceOptions['createWebRtcHostWindow']
  private readonly deviceStore: DeviceStore
  private readonly getControllableSession: RemoteAccessServiceOptions['getControllableSession']
  private readonly getRemoteAccessSettings: RemoteAccessServiceOptions['getRemoteAccessSettings']
  private readonly notifyTerminalRemoteSizeOverride: RemoteAccessServiceOptions['notifyTerminalRemoteSizeOverride']
  private readonly onStatusChanged: RemoteAccessServiceOptions['onStatusChanged']
  private readonly pairingManager = new PairingManager()
  private readonly publicDir: string
  private readonly reconnectGrantStore: ReconnectGrantStore
  private readonly remoteDir: string
  private readonly rendererDistDir: string
  private readonly saveGeneratedTlsPaths: RemoteAccessServiceOptions['saveGeneratedTlsPaths']
  private readonly remoteSizeOverrideOwners = new Map<string, { cols: number; connectionId: string; rows: number }>()
  private readonly sessions = new Map<string, SessionRecord>()
  private config: ResolvedRemoteAccessConfig | null = null
  private errorMessage: string | null = null
  private httpsServer: https.Server | null = null
  private pairingQrCodeDataUrl: string | null = null
  private pairingQrCodePath: string | null = null
  private pairingUrl: string | null = null
  private rotatePairingTimer: NodeJS.Timeout | null = null
  private selectedPairingAddress: string | null = null
  private readonly webRtcPairingManager = new WebRtcPairingManager()
  private webRtcPairingExpiresAt: string | null = null
  private webRtcPairingQrCodeDataUrl: string | null = null
  private webRtcPairingUrl: string | null = null
  private webRtcRoomId: string | null = null
  private webRtcSessionId: string | null = null
  private webRtcActivePairingWebContentsId: number | null = null
  private webRtcHostConfigByWebContentsId = new Map<number, WebRtcHostConfig>()
  private readonly webRtcHostRuntimesByWebContentsId = new Map<number, WebRtcHostRuntime>()
  private readonly webRtcReconnectAvailabilityBySessionId = new Map<string, WebRtcReconnectAvailabilityRuntime>()
  private readonly webRtcReconnectAttemptsById = new Map<string, PendingWebRtcReconnect>()
  private readonly webRtcTerminalConnectionsByChannelId = new Map<string, string>()
  private webRtcStatusMessage: string | null = null
  private readonly wsServer = new WebSocketServer({ noServer: true })

  constructor(options: RemoteAccessServiceOptions) {
    this.app = options.app
    this.createWebRtcHostWindow = options.createWebRtcHostWindow
    this.getControllableSession = options.getControllableSession
    this.getRemoteAccessSettings = options.getRemoteAccessSettings
    this.notifyTerminalRemoteSizeOverride = options.notifyTerminalRemoteSizeOverride
    this.onStatusChanged = options.onStatusChanged
    this.publicDir = options.publicDir
    this.rendererDistDir = options.rendererDistDir
    this.saveGeneratedTlsPaths = options.saveGeneratedTlsPaths
    this.remoteDir = path.join(this.app.getPath('userData'), 'remote-access')
    this.auditStore = new AuditStore(path.join(this.remoteDir, 'audit-log.json'))
    this.deviceStore = new DeviceStore(path.join(this.remoteDir, 'devices.json'))
    this.reconnectGrantStore = new ReconnectGrantStore(path.join(this.remoteDir, 'reconnect-grants.json'))
  }

  getStatus(): RemoteAccessStatus {
    const availableAddresses = this.httpsServer ? this.getAvailableAddresses() : []
    const settings = this.getRemoteAccessSettings()
    const pairingMode = settings.pairingMode === 'webrtc' ? 'webrtc' : 'lan'
    const lanPairingExpiresAt =
      this.pairingManager.getExpiresAt() === null
        ? null
        : new Date(this.pairingManager.getExpiresAt() ?? 0).toISOString()
    const activePairing =
      pairingMode === 'webrtc'
        ? {
            expiresAt: this.webRtcPairingExpiresAt,
            qrCodeDataUrl: this.webRtcPairingQrCodeDataUrl,
            qrCodePath: null,
            url: this.webRtcPairingUrl,
          }
        : {
            expiresAt: lanPairingExpiresAt,
            qrCodeDataUrl: this.pairingQrCodeDataUrl,
            qrCodePath: this.pairingQrCodePath,
            url: this.pairingUrl,
          }

    const webRtcHostReady = this.isActiveWebRtcHostReady()

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
      isRunning: this.isRunning(),
      lanPairingExpiresAt,
      lanPairingQrCodeDataUrl: this.pairingQrCodeDataUrl,
      lanPairingQrCodePath: this.pairingQrCodePath,
      lanPairingUrl: this.pairingUrl,
      origin: this.config?.origin ?? null,
      pairedDeviceCount: this.deviceStore.listActive().length,
      pairedDevices: this.deviceStore.listActive().map((device) => {
        const grant = this.reconnectGrantStore.getSummaryForDevice(device.id)
        return {
          addedAt: device.addedAt,
          deviceId: device.id,
          lastSeenAt: device.lastSeenAt,
          name: device.name,
          origin: device.origin,
          reconnectGrantExpiresAt: grant.expiresAt,
          reconnectGrantLastUsedAt: grant.lastUsedAt,
          reconnectGrantStatus: grant.status,
        }
      }),
      pairingMode,
      pairingExpiresAt: activePairing.expiresAt,
      pairingQrCodeDataUrl: activePairing.qrCodeDataUrl,
      pairingQrCodePath: activePairing.qrCodePath,
      pairingUrl: activePairing.url,
      webRtcPairingExpiresAt: this.webRtcPairingExpiresAt,
      webRtcPairingQrCodeDataUrl: this.webRtcPairingQrCodeDataUrl,
      webRtcPairingUrl: this.webRtcPairingUrl,
      webRtcRoomId: this.webRtcRoomId,
      webRtcStatus: webRtcHostReady ? 'pairing-ready' : this.webRtcPairingUrl ? 'peer-handler-unavailable' : 'not-configured',
      webRtcStatusMessage:
        this.webRtcStatusMessage ??
        (this.webRtcPairingUrl
          ? 'WebRTC relay pairing is scaffolded; host peer connection handling is not active yet.'
          : null),
    }
  }

  notifyStatusChanged(): void {
    this.emitStatus()
  }

  async toggle(): Promise<RemoteAccessStatus> {
    if (this.isRunning()) {
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
    await this.reconnectGrantStore.revokeForDevice(deviceId)
    this.syncWebRtcReconnectAvailability()
    for (const connection of this.connectionStore.list()) {
      if (connection.deviceId === deviceId) {
        this.clearRemoteSizeOverridesForConnection(connection.connectionId)
      }
    }
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
      this.clearRemoteSizeOverridesForConnection(connectionId)
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
    this.clearRemoteSizeOverride(id)
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
      const settings = this.getRemoteAccessSettings()
      await this.deviceStore.load()
      await this.reconnectGrantStore.load()
      await this.auditStore.load()

      const tlsMaterial = await ensureTlsMaterial(this.config, this.remoteDir)
      if (tlsMaterial.isSelfSigned) {
        await this.saveGeneratedTlsPaths({
          certPath: tlsMaterial.certPath,
          keyPath: tlsMaterial.keyPath,
        })
        this.config = resolveRemoteAccessConfig(readRemoteAccessConfig(this.getRemoteAccessSettings()))
      }

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

      try {
        await new Promise<void>((resolve, reject) => {
          this.httpsServer?.once('error', reject)
          this.httpsServer?.listen(this.config?.port, this.config?.bindAddress, () => {
            this.httpsServer?.off('error', reject)
            resolve()
          })
        })
        await this.rotatePairingCode()
      } catch (error) {
        if (settings.pairingMode !== 'webrtc' || !isAddressInUseError(error)) {
          throw error
        }

        const failedServer = this.httpsServer
        this.httpsServer = null
        failedServer?.close()
        this.pairingQrCodeDataUrl = null
        this.pairingQrCodePath = null
        this.pairingUrl = null
        this.errorMessage = `Local Network server could not start because port ${this.config.port} is already in use. WebRTC relay pairing is still available.`
        await this.rotateWebRtcPairingCode()
      }

      this.syncWebRtcReconnectAvailability()
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
    this.clearAllRemoteSizeOverrides()

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
    this.webRtcPairingExpiresAt = null
    this.webRtcPairingQrCodeDataUrl = null
    this.webRtcPairingUrl = null
    this.webRtcRoomId = null
    this.webRtcActivePairingWebContentsId = null
    this.closeWebRtcPairingHost()
    this.closeWebRtcReconnectAvailability()
    this.webRtcStatusMessage = null
    this.emitStatus()
  }

  private emitStatus(): void {
    this.onStatusChanged(this.getStatus())
  }

  private isActiveWebRtcHostReady(): boolean {
    return this.webRtcActivePairingWebContentsId !== null
      ? this.webRtcHostRuntimesByWebContentsId.get(this.webRtcActivePairingWebContentsId)?.ready === true
      : false
  }

  private isRunning(): boolean {
    return this.httpsServer !== null || this.webRtcHostRuntimesByWebContentsId.size > 0
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
    await this.rotateWebRtcPairingCode()

    if (this.rotatePairingTimer) {
      clearTimeout(this.rotatePairingTimer)
    }

    const delay = Math.max(5_000, new Date(payload.pairingExpiresAt).getTime() - Date.now())
    this.rotatePairingTimer = setTimeout(() => {
      void this.rotatePairingCode().then(() => this.emitStatus())
    }, delay)
  }

  private async rotateWebRtcPairingCode(): Promise<void> {
    const settings = this.getRemoteAccessSettings()

    try {
      if (!settings.pairingPinHash.trim()) {
        throw new Error('Set a Remote Access PIN before generating a WebRTC QR code.')
      }
      const payload = this.webRtcPairingManager.create({
        hostedDomain: settings.webRtcHostedDomain,
        sessionId: this.webRtcSessionId ?? undefined,
      })
      this.webRtcSessionId = payload.sessionId
      this.webRtcPairingExpiresAt = payload.expiresAt
      this.webRtcPairingUrl = payload.pairingUrl
      this.webRtcRoomId = payload.roomId
      this.pairingManager.adoptSession({
        expiresAt: payload.pairing.expiresAt,
        origin: this.createWebRtcPairingOrigin(payload.appOrigin),
        pairingSessionId: payload.pairing.sessionId,
        pairingToken: payload.pairing.token,
      })
      this.webRtcPairingQrCodeDataUrl = await QRCode.toDataURL(payload.pairingUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        width: 720,
      })
      this.openWebRtcPairingHost({
        appOrigin: payload.appOrigin,
        expiresAt: payload.expiresAt,
        iceServers: parseWebRtcIceServers(settings.webRtcIceServers),
        relayJoinTokenHash: payload.relayJoinTokenHash,
        roomId: payload.roomId,
        sessionId: payload.sessionId,
        signalingAuthToken: payload.signalingAuthToken,
        signalingUrl: payload.signalingUrl,
      })
      this.webRtcStatusMessage = 'WebRTC relay room is registering. Keep Terminay open while the browser connects.'
    } catch (error) {
      this.webRtcPairingExpiresAt = null
      this.webRtcPairingUrl = null
      this.webRtcRoomId = null
      this.webRtcActivePairingWebContentsId = null
      this.webRtcPairingQrCodeDataUrl = null
      this.webRtcStatusMessage = error instanceof Error ? error.message : 'Unable to generate WebRTC pairing QR.'
    }
  }

  private createWebRtcPairingOrigin(appOrigin: string): string {
    return `${appOrigin}#transport=webrtc:${appOrigin}`
  }

  private createWebRtcSessionId(appOrigin: string): string {
    try {
      return new URL(appOrigin).hostname.split('.')[0] || appOrigin
    } catch {
      return appOrigin
    }
  }

  private closeWebRtcPairingHost(): void {
    for (const webContentsId of Array.from(this.webRtcHostRuntimesByWebContentsId.keys())) {
      this.closeWebRtcHostRuntime(webContentsId, 'Pairing stopped')
    }
    this.webRtcActivePairingWebContentsId = null
  }

  private closeWebRtcSignalSocket(runtime: WebRtcHostRuntime, reason = 'Pairing rotated'): void {
    const socket = runtime.signalSocket
    runtime.signalSocket = null
    if (!runtime.ownsSignalSocket) {
      return
    }
    if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
      socket.close(1000, reason)
    }
  }

  private getWebRtcHostRuntime(webContentsId: number): WebRtcHostRuntime | null {
    return this.webRtcHostRuntimesByWebContentsId.get(webContentsId) ?? null
  }

  private isReconnectRelayMessage(message: unknown): message is Record<string, unknown> {
    return Boolean(
      message &&
      typeof message === 'object' &&
      'type' in message &&
      typeof (message as { type?: unknown }).type === 'string' &&
      (message as { type: string }).type.startsWith('reconnect-'),
    )
  }

  private async handleWebRtcReconnectRelayMessage(config: WebRtcHostConfig, socket: WebSocket, message: Record<string, unknown>): Promise<void> {
    if (message.type === 'reconnect-host-registered' || message.type === 'reconnect-intent-accepted') {
      return
    }

    if (message.type === 'reconnect-intent') {
      const sessionId = String(message.sessionId ?? '')
      const reconnectHandle = String(message.reconnectHandle ?? '')
      const clientNonce = String(message.clientNonce ?? '')
      const origin = this.createWebRtcPairingOrigin(config.appOrigin)
      const challenge = await this.reconnectGrantStore.createChallenge({
        clientNonce,
        handle: reconnectHandle,
        origin,
        sessionId,
      })
      this.webRtcReconnectAttemptsById.set(challenge.payload.attemptId, {
        appOrigin: config.appOrigin,
        clientNonce,
        handle: reconnectHandle,
        iceServers: config.iceServers,
        origin,
        sessionId,
        signalingUrl: config.signalingUrl,
        socket,
        webContentsId: null,
      })
      socket.send(JSON.stringify({
        ...challenge.payload,
        reconnectHandle: challenge.payload.handle,
        signingInput: challenge.signingInput,
        type: 'reconnect-challenge',
      }))
      return
    }

    if (message.type === 'reconnect-proof') {
      const attemptId = String(message.attemptId ?? '')
      const attempt = this.webRtcReconnectAttemptsById.get(attemptId)
      if (!attempt) {
        throw new Error('This reconnect challenge is no longer valid.')
      }
      const grant = await this.reconnectGrantStore.verifyProof({
        attemptId,
        clientNonce: String(message.clientNonce ?? ''),
        handle: attempt.handle,
        lifetime: resolveReconnectGrantLifetime(this.getRemoteAccessSettings().reconnectGrantLifetime),
        origin: attempt.origin,
        proof: String(message.proof ?? ''),
      })
      socket.send(JSON.stringify({
        iceServers: attempt.iceServers,
        signalingAuthToken: String(message.proof ?? ''),
        type: 'reconnect-accepted',
      }))
      attempt.webContentsId = this.openWebRtcReconnectHost({
        appOrigin: attempt.appOrigin,
        attemptId,
        iceServers: attempt.iceServers,
        reconnectHandle: attempt.handle,
        savedSessionExpiresAt: grant.expiresAt ?? '',
        sessionId: grant.sessionId,
        signalingAuthToken: String(message.proof ?? ''),
        signalingSocket: socket,
        signalingUrl: attempt.signalingUrl,
      })
      return
    }

    if (message.type === 'reconnect-answer' || message.type === 'reconnect-ice') {
      const attempt = this.webRtcReconnectAttemptsById.get(String(message.attemptId ?? ''))
      const webContentsId = attempt?.webContentsId
      if (!webContentsId) return
      this.getWebRtcHostRuntime(webContentsId)?.hostWindow.sendSignalMessage(message)
    }
  }

  private getWebRtcGrantAppOrigin(grant: ReconnectGrantRecord): string {
    return new URL(grant.origin).origin
  }

  private createWebRtcSignalingUrl(appOrigin: string): string {
    const url = new URL(appOrigin)
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    if (url.hostname.endsWith('.localhost')) {
      url.hostname = 'localhost'
    }
    url.pathname = '/signal'
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  private closeWebRtcReconnectAvailability(sessionId?: string): void {
    const entries = sessionId
      ? [[sessionId, this.webRtcReconnectAvailabilityBySessionId.get(sessionId)] as const]
      : Array.from(this.webRtcReconnectAvailabilityBySessionId.entries())

    for (const [entrySessionId, runtime] of entries) {
      if (!runtime) continue
      this.webRtcReconnectAvailabilityBySessionId.delete(entrySessionId)
      if (runtime.socket.readyState !== WebSocket.CLOSING && runtime.socket.readyState !== WebSocket.CLOSED) {
        runtime.socket.close(1000, 'Reconnect availability stopped')
      }
    }
  }

  private syncWebRtcReconnectAvailability(): void {
    const settings = this.getRemoteAccessSettings()
    const grantsBySessionId = new Map<string, ReconnectGrantRecord>()

    for (const grant of this.reconnectGrantStore.listActive()) {
      if (!grantsBySessionId.has(grant.sessionId)) {
        grantsBySessionId.set(grant.sessionId, grant)
      }
    }

    for (const sessionId of Array.from(this.webRtcReconnectAvailabilityBySessionId.keys())) {
      if (!grantsBySessionId.has(sessionId)) {
        this.closeWebRtcReconnectAvailability(sessionId)
      }
    }

    for (const [sessionId, grant] of grantsBySessionId) {
      const existing = this.webRtcReconnectAvailabilityBySessionId.get(sessionId)
      if (existing && existing.socket.readyState !== WebSocket.CLOSED && existing.socket.readyState !== WebSocket.CLOSING) {
        continue
      }

      const appOrigin = this.getWebRtcGrantAppOrigin(grant)
      const signalingUrl = this.createWebRtcSignalingUrl(appOrigin)
      const socket = new WebSocket(signalingUrl)
      const runtime: WebRtcReconnectAvailabilityRuntime = {
        appOrigin,
        iceServers: parseWebRtcIceServers(settings.webRtcIceServers),
        sessionId,
        signalingUrl,
        socket,
      }
      this.webRtcReconnectAvailabilityBySessionId.set(sessionId, runtime)

      socket.on('open', () => {
        if (this.webRtcReconnectAvailabilityBySessionId.get(sessionId)?.socket !== socket) return
        socket.send(JSON.stringify({
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          sessionIds: [sessionId],
          type: 'reconnect-host-ready',
        }))
      })

      socket.on('message', (raw) => {
        if (this.webRtcReconnectAvailabilityBySessionId.get(sessionId)?.socket !== socket) return
        let message: unknown
        try {
          message = JSON.parse(raw.toString())
        } catch {
          return
        }
        if (!this.isReconnectRelayMessage(message)) {
          return
        }

        const config: WebRtcHostConfig = {
          appOrigin: runtime.appOrigin,
          expiresAt: '',
          iceServers: runtime.iceServers,
          relayJoinTokenHash: '',
          roomId: runtime.sessionId,
          sessionId: runtime.sessionId,
          signalingAuthToken: '',
          signalingUrl: runtime.signalingUrl,
        }
        void this.handleWebRtcReconnectRelayMessage(config, socket, message)
          .catch((error) => {
            this.webRtcStatusMessage = error instanceof Error ? error.message : 'Saved-session reconnect failed.'
            this.emitStatus()
          })
      })

      socket.on('close', () => {
        if (this.webRtcReconnectAvailabilityBySessionId.get(sessionId)?.socket === socket) {
          this.webRtcReconnectAvailabilityBySessionId.delete(sessionId)
        }
      })

      socket.on('error', () => {
        if (this.webRtcReconnectAvailabilityBySessionId.get(sessionId)?.socket !== socket) return
        this.webRtcStatusMessage = 'Could not advertise saved-session reconnect availability.'
        this.emitStatus()
      })
    }
  }

  private openWebRtcPairingHost(options: {
    appOrigin: string
    expiresAt: string
    iceServers: Array<{ urls: string | string[] }>
    relayJoinTokenHash: string
    roomId: string
    sessionId: string
    signalingAuthToken: string
    signalingUrl: string
  }): void {
    const hostWindow = this.createWebRtcHostWindow(0)
    const hostConfig = {
      appOrigin: options.appOrigin,
      expiresAt: options.expiresAt,
      iceServers: options.iceServers,
      relayJoinTokenHash: options.relayJoinTokenHash,
      roomId: options.roomId,
      sessionId: options.sessionId,
      signalingAuthToken: options.signalingAuthToken,
      signalingUrl: options.signalingUrl,
    }
    this.webRtcHostConfigByWebContentsId.set(hostWindow.webContentsId, hostConfig)
    this.webRtcHostRuntimesByWebContentsId.set(hostWindow.webContentsId, {
      hostWindow,
      ownsSignalSocket: true,
      ready: false,
      signalSocket: null,
    })
    this.webRtcActivePairingWebContentsId = hostWindow.webContentsId
    hostWindow.sendConfig(hostConfig)
  }

  private openWebRtcReconnectHost(options: {
    appOrigin: string
    attemptId: string
    iceServers: Array<{ urls: string | string[] }>
    reconnectHandle: string
    savedSessionExpiresAt: string
    sessionId: string
    signalingAuthToken: string
    signalingSocket: WebSocket
    signalingUrl: string
  }): number {
    const hostWindow = this.createWebRtcHostWindow(0)
    const hostConfig: WebRtcHostConfig = {
      appOrigin: options.appOrigin,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      iceServers: options.iceServers,
      reconnect: {
        attemptId: options.attemptId,
        protocolVersion: 'v1',
        reconnectHandle: options.reconnectHandle,
        savedSessionExpiresAt: options.savedSessionExpiresAt,
        sessionId: options.sessionId,
      },
      relayJoinTokenHash: '',
      roomId: options.sessionId,
      sessionId: options.sessionId,
      signalingAuthToken: options.signalingAuthToken,
      signalingUrl: options.signalingUrl,
    }
    this.webRtcHostConfigByWebContentsId.set(hostWindow.webContentsId, hostConfig)
    this.webRtcHostRuntimesByWebContentsId.set(hostWindow.webContentsId, {
      hostWindow,
      ownsSignalSocket: false,
      ready: false,
      signalSocket: options.signalingSocket,
    })
    hostWindow.sendConfig(hostConfig)
    return hostWindow.webContentsId
  }

  handleWebRtcHostSignalReady(webContentsId: number): void {
    const config = this.webRtcHostConfigByWebContentsId.get(webContentsId)
    const runtime = this.getWebRtcHostRuntime(webContentsId)
    if (!config || !runtime) return

    if (config.reconnect) {
      runtime.ready = true
      runtime.hostWindow.sendSignalMessage({ roomId: config.roomId, type: 'client-join' })
      return
    }

    this.closeWebRtcSignalSocket(runtime)
    const socket = new WebSocket(config.signalingUrl)
    runtime.signalSocket = socket

    socket.on('open', () => {
      if (runtime.signalSocket !== socket) return
      socket.send(JSON.stringify({
        expiresAt: config.expiresAt,
        relayJoinTokenHash: config.relayJoinTokenHash,
        roomId: config.roomId,
        type: 'host-ready',
      }))
    })

    socket.on('message', (raw) => {
      if (runtime.signalSocket !== socket) return
      let message: unknown
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }

      if (this.isReconnectRelayMessage(message)) {
        void this.handleWebRtcReconnectRelayMessage(config, socket, message)
          .catch((error) => {
            this.handleWebRtcHostStatus(webContentsId, {
              detail: error instanceof Error ? error.message : 'Saved-session reconnect failed.',
              type: 'error',
            })
          })
        return
      }

      if (message && typeof message === 'object' && 'type' in message) {
        this.handleWebRtcHostStatus(webContentsId, {
          detail: 'message' in message && typeof message.message === 'string' ? message.message : undefined,
          type: typeof message.type === 'string' ? message.type : undefined,
        })
      }
      runtime.hostWindow.sendSignalMessage(message)
    })

    socket.on('error', () => {
      if (runtime.signalSocket !== socket) return
      this.handleWebRtcHostStatus(webContentsId, {
        detail: 'Could not reach the WebRTC signaling relay.',
        type: 'error',
      })
    })

    socket.on('close', () => {
      if (runtime.signalSocket !== socket) return
      runtime.signalSocket = null
      this.handleWebRtcHostStatus(webContentsId, { type: 'closed' })
    })
  }

  handleWebRtcHostSignalMessage(webContentsId: number, message: unknown): void {
    if (!this.webRtcHostConfigByWebContentsId.has(webContentsId)) return
    const socket = this.getWebRtcHostRuntime(webContentsId)?.signalSocket ?? null
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.handleWebRtcHostStatus(webContentsId, {
        detail: 'The WebRTC signaling relay is not connected.',
        type: 'error',
      })
      return
    }
    socket.send(JSON.stringify(message))
  }

  handleWebRtcHostStatus(webContentsId: number, message: { detail?: string; type?: string }): void {
    const runtime = this.getWebRtcHostRuntime(webContentsId)
    if (!runtime) return

    if (message.type === 'host-registered') {
      runtime.ready = true
      if (this.webRtcActivePairingWebContentsId === webContentsId) {
        this.webRtcStatusMessage = 'WebRTC relay room is ready. Scan the QR code to continue.'
        this.emitStatus()
      }
      return
    }

    if (message.type === 'client-join') {
      if (this.webRtcActivePairingWebContentsId === webContentsId) {
        this.webRtcStatusMessage = 'Browser joined the relay room. Establishing the secure WebRTC channel.'
        this.emitStatus()
      }
      return
    }

    if (message.type === 'error') {
      runtime.ready = false
      const config = this.webRtcHostConfigByWebContentsId.get(webContentsId)
      if (this.webRtcActivePairingWebContentsId === webContentsId || config?.reconnect) {
        this.webRtcStatusMessage = message.detail || 'The WebRTC relay rejected the pairing room.'
        this.emitStatus()
      }
      return
    }

    if (message.type === 'closed') {
      runtime.ready = false
      if (this.webRtcActivePairingWebContentsId === webContentsId) {
        this.emitStatus()
      }
    }
  }

  private closeWebRtcHostRuntime(webContentsId: number, reason = 'Pairing rotated'): void {
    const runtime = this.webRtcHostRuntimesByWebContentsId.get(webContentsId)
    if (!runtime) return

    this.closeWebRtcSignalSocket(runtime, reason)
    this.webRtcHostRuntimesByWebContentsId.delete(webContentsId)
    this.webRtcHostConfigByWebContentsId.delete(webContentsId)
    if (this.webRtcActivePairingWebContentsId === webContentsId) {
      this.webRtcActivePairingWebContentsId = null
    }
    runtime.hostWindow.close()
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
          pairingPin?: string
          pairingSessionId: string
          pairingToken: string
          publicKeyPem: string
        }>(request)
        assertPairingPin(this.getRemoteAccessSettings(), body.pairingPin)

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

  getWebRtcHostConfig(webContentsId: number): WebRtcHostConfig | null {
    return this.webRtcHostConfigByWebContentsId.get(webContentsId) ?? null
  }

  async getWebRtcAssetManifest(): Promise<{ assets: Array<{ contentType: string; hash: string; path: string; size: number }>; bundleId: string; entryPath: string; protocolVersion: string }> {
    const assetEntries = await this.collectRemoteAppAssetEntries()
    const assetRecords = await Promise.all(assetEntries.map(async (entry) => {
      const body = await fs.readFile(path.resolve(this.rendererDistDir, entry))
      return {
        contentType: getContentType(path.resolve(this.rendererDistDir, entry)),
        entry,
        hash: createHash('sha256').update(body).digest('base64url'),
        size: body.byteLength,
      }
    }))
    const bundleId = createHash('sha256')
      .update(assetRecords.map((record) => `${record.entry}:${record.hash}`).sort().join('\n'))
      .digest('base64url')
      .slice(0, 32)

    return {
      assets: assetRecords.map((record) => ({
        contentType: record.contentType,
        hash: record.hash,
        path: `/remote-app/${bundleId}/${record.entry}`,
        size: record.size,
      })),
      bundleId,
      entryPath: `/remote-app/${bundleId}/remote.html`,
      protocolVersion: '2',
    }
  }

  async getWebRtcAsset(assetPath: string): Promise<{ bodyBase64: string; contentType: string; hash: string; path: string }> {
    const body = await this.readRemoteAppAssetBody(assetPath)
    return {
      bodyBase64: body.toString('base64'),
      contentType: getContentType(this.remoteAppAssetPathToFilePath(assetPath)),
      hash: createHash('sha256').update(body).digest('base64url'),
      path: assetPath,
    }
  }

  async handleWebRtcApiRequest(pathname: string, body: Record<string, unknown>, appOrigin: string): Promise<unknown> {
    const origin = this.createWebRtcPairingOrigin(appOrigin)

    if (pathname === '/api/pairing/start') {
      assertPairingPin(this.getRemoteAccessSettings(), String(body.pairingPin ?? ''), { requireConfigured: true })
      return this.pairingManager.startRegistration({
        deviceName: String(body.deviceName ?? ''),
        origin,
        pairingSessionId: String(body.pairingSessionId ?? ''),
        pairingToken: String(body.pairingToken ?? ''),
        publicKeyPem: normalizePem(String(body.publicKeyPem ?? '')),
      })
    }

    if (pathname === '/api/pairing/complete') {
      const pending = this.pairingManager.consumeRegistration({
        origin,
        provisionalDeviceId: String(body.provisionalDeviceId ?? ''),
      })
      const device = await this.deviceStore.create({
        name: pending.deviceName,
        origin: pending.origin,
        publicKeyPem: pending.publicKeyPem,
      })
      const reconnectGrant = await this.reconnectGrantStore.issueGrant({
        deviceId: device.id,
        label: device.name,
        lifetime: resolveReconnectGrantLifetime(this.getRemoteAccessSettings().reconnectGrantLifetime),
        origin: pending.origin,
        sessionId: this.createWebRtcSessionId(appOrigin),
      })
      this.pairingManager.invalidateSession(pending.pairingSessionId)
      await this.auditStore.append({
        action: 'pairing-completed',
        connectionId: null,
        deviceId: device.id,
        deviceName: device.name,
      })
      await this.rotateWebRtcPairingCode()
      this.syncWebRtcReconnectAvailability()
      this.emitStatus()
      return { deviceId: device.id, deviceName: device.name, reconnectGrant }
    }

    if (pathname === '/api/auth/options') {
      const device = this.deviceStore.get(String(body.deviceId ?? ''))
      if (!device) throw new Error('This device is not paired with this host.')
      if (device.origin !== origin) throw new Error('This device is paired with a different origin.')
      const challenge = await this.challengeStore.create({ deviceId: device.id, origin: device.origin })
      return {
        deviceChallenge: challenge.payload,
        signingInput: challenge.signingInput,
      }
    }

    if (pathname === '/api/auth/verify') {
      const device = this.deviceStore.get(String(body.deviceId ?? ''))
      if (!device) throw new Error('This device is no longer trusted.')
      if (device.origin !== origin) throw new Error('This device is paired with a different origin.')
      const challenge = this.challengeStore.consume(String(body.challengeId ?? ''), device.id, origin)
      const verifiedDeviceSignature = verifySignature(
        'sha256',
        Buffer.from(serializeDeviceChallenge(challenge.payload)),
        {
          key: normalizePem(device.publicKeyPem),
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        Buffer.from(String(body.deviceSignature ?? ''), 'base64url'),
      )
      if (!verifiedDeviceSignature) throw new Error('The paired device key signature was invalid.')
      await this.deviceStore.updateAuthentication(device.id)
      await this.auditStore.append({
        action: 'auth-verified',
        connectionId: null,
        deviceId: device.id,
        deviceName: device.name,
      })
      const ticket = this.connectionStore.issueTicket(device.id)
      this.emitStatus()
      return { ticket }
    }

    throw new Error('Not found')
  }

  async attachWebRtcTerminal(webContentsId: number, channelId: string, ticket: string): Promise<void> {
    const ticketInfo = this.connectionStore.consumeTicket(ticket)
    const device = this.deviceStore.get(ticketInfo.deviceId)
    if (!device) throw new Error('This device is no longer trusted.')
    const runtime = this.getWebRtcHostRuntime(webContentsId)
    if (!runtime) throw new Error('The WebRTC host connection is no longer available.')
    const peer: WebRtcTerminalPeer = {
      channelId,
      webContentsId,
      close: (_code?: number, reason?: string) => {
        const closeReason = reason || 'Remote connection closed by Terminay.'
        this.getWebRtcHostRuntime(webContentsId)?.hostWindow.closeTerminal(channelId, closeReason)
        this.closeWebRtcTerminal(channelId, closeReason)
      },
      getReadyState: () => WebSocket.OPEN,
      send: (message) => {
        this.getWebRtcHostRuntime(webContentsId)?.hostWindow.sendTerminalMessage(channelId, message)
      },
    }
    const connection = this.connectionStore.register(peer, ticketInfo.connectionId, ticketInfo.deviceId)
    this.webRtcTerminalConnectionsByChannelId.set(channelId, connection.connectionId)
    await this.auditStore.append({
      action: 'connection-opened',
      connectionId: connection.connectionId,
      deviceId: connection.deviceId,
      deviceName: this.deviceStore.get(connection.deviceId)?.name ?? null,
    })
    this.webRtcStatusMessage = 'Browser connected over WebRTC.'
    this.sendSessionList(connection.socket, connection.connectionId)
    this.emitStatus()
  }

  handleWebRtcTerminalMessage(channelId: string, raw: string): void {
    const connectionId = this.webRtcTerminalConnectionsByChannelId.get(channelId)
    if (!connectionId) return
    const parsed = parseRemoteClientMessage(raw)
    if (!parsed) {
      const connection = this.connectionStore.get(connectionId)
      if (connection) this.send(connection.socket, { message: 'Invalid remote message.', type: 'error' })
      return
    }
    this.handleClientMessage(connectionId, parsed)
  }

  closeWebRtcTerminal(channelId: string, reason = 'WebRTC terminal channel closed.'): void {
    const connectionId = this.webRtcTerminalConnectionsByChannelId.get(channelId)
    if (!connectionId) return
    const connection = this.connectionStore.get(connectionId)
    this.webRtcTerminalConnectionsByChannelId.delete(channelId)
    this.clearRemoteSizeOverridesForConnection(connectionId)
    this.connectionStore.unregister(connectionId)
    void this.auditStore.append({
      action: 'connection-closed',
      connectionId,
      deviceId: connection?.deviceId ?? null,
      deviceName: connection ? (this.deviceStore.get(connection.deviceId)?.name ?? null) : null,
      reason,
    }).then(() => this.emitStatus())
    this.emitStatus()
  }

  private async collectRemoteAppAssetEntries(): Promise<string[]> {
    const files = await fs.readdir(this.rendererDistDir, { recursive: true })
    return files
      .filter((entry) => typeof entry === 'string' && !entry.endsWith('.map'))
      .filter(isRemoteAppAssetEntry)
  }

  private remoteAppAssetPathToFilePath(assetPath: string): string {
    const match = assetPath.match(/^\/remote-app\/(?:current|[a-zA-Z0-9_-]{8,128})\/(.+)$/)
    if (!match || assetPath.includes('..') || !isRemoteAppAssetEntry(match[1])) {
      throw new Error('Remote app asset path is invalid.')
    }
    return path.resolve(this.rendererDistDir, match[1])
  }

  private async readRemoteAppAssetBody(assetPath: string): Promise<Buffer> {
    const filePath = this.remoteAppAssetPathToFilePath(assetPath)
    if (!isPathInside(filePath, this.rendererDistDir)) {
      throw new Error('Remote app asset path is invalid.')
    }
    return fs.readFile(filePath)
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
        const connection = this.connectionStore.register(webSocketPeer(websocket), ticketInfo.connectionId, ticketInfo.deviceId)
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
        this.send(webSocketPeer(socket), { message: 'Invalid remote message.', type: 'error' })
        return
      }

      this.handleClientMessage(connectionId, parsed)
    })

    socket.on('close', () => {
      const connection = this.connectionStore.get(connectionId)
      this.clearRemoteSizeOverridesForConnection(connectionId)
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

        if (this.remoteSizeOverrideOwners.get(message.sessionId)?.connectionId !== connection.connectionId) {
          this.clearRemoteSizeOverridesForConnection(connection.connectionId)
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
        this.clearRemoteSizeOverride(message.sessionId, connection.connectionId)
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

        const controllableSession = this.getControllableSession(message.sessionId)
        if (!controllableSession) {
          this.send(connection.socket, { message: 'That terminal session is no longer controllable.', type: 'error' })
          return
        }

        const cols = Math.max(2, Math.floor(message.cols))
        const rows = Math.max(1, Math.floor(message.rows))
        controllableSession.resize(cols, rows)
        this.updateSessionSize(message.sessionId, cols, rows)
        this.setRemoteSizeOverrideOwner(message.sessionId, connection.connectionId, cols, rows)
        return
      }
      case 'ping':
        this.send(connection.socket, { seq: message.seq, type: 'pong' })
        return
    }
  }

  private sendSessionList(socket: RemoteConnectionPeer, connectionId: string): void {
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
    const buffer = session.buffer.length > MAX_SESSION_SNAPSHOT_BUFFER_LENGTH
      ? session.buffer.slice(-MAX_SESSION_SNAPSHOT_BUFFER_LENGTH)
      : session.buffer

    return {
      ...this.toSessionSummary(id, session),
      buffer,
    }
  }

  private setRemoteSizeOverrideOwner(sessionId: string, connectionId: string, cols: number, rows: number): void {
    this.remoteSizeOverrideOwners.set(sessionId, { cols, connectionId, rows })
    this.notifyTerminalRemoteSizeOverride(sessionId, {
      active: true,
      cols,
      rows,
    })
  }

  private clearRemoteSizeOverride(sessionId: string, connectionId?: string): void {
    const owner = this.remoteSizeOverrideOwners.get(sessionId)
    if (!owner || (connectionId && owner.connectionId !== connectionId)) {
      return
    }

    this.remoteSizeOverrideOwners.delete(sessionId)
    this.notifyTerminalRemoteSizeOverride(sessionId, { active: false })
  }

  private clearRemoteSizeOverridesForConnection(connectionId: string): void {
    for (const [sessionId, owner] of Array.from(this.remoteSizeOverrideOwners.entries())) {
      if (owner.connectionId === connectionId) {
        this.clearRemoteSizeOverride(sessionId, connectionId)
      }
    }
  }

  private clearAllRemoteSizeOverrides(): void {
    const sessionIds = Array.from(this.remoteSizeOverrideOwners.keys())
    this.remoteSizeOverrideOwners.clear()
    for (const sessionId of sessionIds) {
      this.notifyTerminalRemoteSizeOverride(sessionId, { active: false })
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

  private send(socket: RemoteConnectionPeer, message: RemoteServerMessage): void {
    if (socket.getReadyState() !== WebSocket.OPEN) {
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
