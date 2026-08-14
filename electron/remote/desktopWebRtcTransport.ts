import type { ByteTransport, ProtocolId } from '@terminay/protocol'
import {
  HeadlessChannelTransport,
  type HeadlessDataChannel,
  type HeadlessChannelTransportOptions,
  type RemoteTrafficChannel,
} from '@terminay/server-core/remote'
import {
  createNodeDataChannelRuntimeAdapter,
  loadNodeDataChannelRuntimeModule,
  type NodeDataChannelRuntimeModule,
} from '../../apps/terminay-server/src/remote/nodeDataChannelRuntime'
import {
  createNodeDataChannelOpenChannels,
  type NodeDataChannelSignaling,
} from '../../apps/terminay-server/src/remote/nodeDataChannelPeer'
import type { DesktopAuthenticatedAssetLane } from '../../apps/terminay-desktop/src/main/serverBundleHost'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const ASSET_REQUEST_TIMEOUT_MS = 15_000
const MAX_ASSET_RESPONSE_BYTES = 16 * 1024 * 1024

const CHANNELS = Object.freeze([
  'control',
  'application',
  'terminal',
  'assets',
] satisfies readonly RemoteTrafficChannel[])

/**
 * Privileged Desktop client-side WebRTC runtime.
 *
 * The hosted bootstrap owns the authenticated signaling implementation; this
 * boundary owns only the optional native runtime and returns the canonical
 * framed application transport consumed by TerminayClient. All four isolated
 * channels must establish before the application lane is exposed.
 */
export async function createDesktopWebRtcTransport(options: Readonly<{
  readonly peerId: ProtocolId
  readonly deviceId: ProtocolId
  readonly serverId: ProtocolId
  readonly sessionOrigin: string
  readonly signaling: NodeDataChannelSignaling
  readonly iceServers?: readonly Record<string, unknown>[]
  readonly signal?: AbortSignal
  readonly loadModule?: () => Promise<NodeDataChannelRuntimeModule>
  readonly timeoutMs?: number
  /** Bounded framed-transport limits, primarily host policy and test seams. */
  readonly transportOptions?: HeadlessChannelTransportOptions
}>): Promise<ByteTransport> {
  return (await createDesktopWebRtcConnection(options)).transport
}

export interface DesktopWebRtcConnection {
  readonly transport: ByteTransport
  readonly assets: DesktopAuthenticatedAssetLane
  readonly serverId: ProtocolId
}

/** Return both authenticated application and immutable bundle lanes from the
 * same peer. This prevents a remote bundle from being fetched over an ambient
 * HTTP connection which is not bound to the authenticated server identity. */
export async function createDesktopWebRtcConnection(options: Readonly<{
  readonly peerId: ProtocolId
  readonly deviceId: ProtocolId
  readonly serverId: ProtocolId
  readonly sessionOrigin: string
  readonly signaling: NodeDataChannelSignaling
  readonly iceServers?: readonly Record<string, unknown>[]
  readonly signal?: AbortSignal
  readonly loadModule?: () => Promise<NodeDataChannelRuntimeModule>
  readonly timeoutMs?: number
  readonly transportOptions?: HeadlessChannelTransportOptions
}>): Promise<DesktopWebRtcConnection> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  const controller = new AbortController()
  const abort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })

  try {
    const runtime = createNodeDataChannelRuntimeAdapter({
      loadModule: options.loadModule ?? (() => loadNodeDataChannelRuntimeModule()),
      openChannels: createNodeDataChannelOpenChannels({
        signaling: options.signaling,
        role: 'offerer',
        ...(options.iceServers === undefined ? {} : { iceServers: options.iceServers }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      }),
    })
    const channels = await runtime.connect({
      channels: CHANNELS,
      maxBufferedBytes: 4 * 1024 * 1024,
      maxFrameBytes: 1024 * 1024,
      deviceId: options.deviceId,
      peerId: options.peerId,
      serverId: options.serverId,
      sessionOrigin: options.sessionOrigin,
      signal: controller.signal,
    })
    const application = channels.get('application')
    const assets = channels.get('assets')
    if (application === undefined || assets === undefined) {
      for (const channel of channels.values()) channel.close()
      throw new Error('Desktop WebRTC application channel is unavailable.')
    }
    const transport = new HeadlessChannelTransport(application, options.transportOptions)
		const assetLane = new DesktopWebRtcAssetLane(assets)
		const removeChannelStateListeners = [...channels.entries()].map(
			([label, channel]) => channel.onStateChange((state) => {
				if (label === 'application' || (state !== 'closing' && state !== 'closed')) return
				void transport.close({
					code: 'unavailable',
					message: 'Desktop WebRTC traffic channel closed.',
				}).catch(() => undefined)
			}),
		)
		const closeOnAbort = (): void => {
			void transport.close({
				code: 'cancelled',
				message: 'Desktop WebRTC connection was cancelled.',
			}).catch(() => undefined)
		}
		options.signal?.addEventListener('abort', closeOnAbort, { once: true })
    transport.onStateChange((state) => {
      if (state !== 'closed' && state !== 'failed') return
			for (const remove of removeChannelStateListeners.splice(0)) remove()
      for (const [label, channel] of channels) {
        if (label !== 'application') channel.close()
      }
      options.signal?.removeEventListener('abort', abort)
			options.signal?.removeEventListener('abort', closeOnAbort)
    })
    return Object.freeze({ transport, assets: assetLane, serverId: options.serverId })
  } catch (error) {
    options.signal?.removeEventListener('abort', abort)
    throw error
  }
}

class DesktopWebRtcAssetLane implements DesktopAuthenticatedAssetLane {
  private sequence = 0
  private readonly pending = new Map<string, {
    readonly resolve: (value: unknown) => void
    readonly reject: (error: Error) => void
    readonly timer: ReturnType<typeof setTimeout>
    chunks?: Array<string | undefined>
    metadata?: Record<string, unknown>
  }>()

  constructor(private readonly channel: HeadlessDataChannel) {
    channel.onMessage((frame) => this.receive(frame))
    channel.onStateChange((state) => {
      if (state === 'closing' || state === 'closed') this.failAll(new Error('Desktop WebRTC asset lane closed.'))
    })
  }

  manifest(): Promise<unknown> { return this.request({ type: 'asset:get-manifest' }) }

  async read(assetPath: string): Promise<Uint8Array> {
    if (!assetPath.startsWith('/remote-app/') || assetPath.includes('..')) throw new TypeError('Remote bundle asset path is invalid.')
    const response = await this.request({ type: 'asset:get', path: assetPath })
    if (!isRecord(response) || typeof response.bodyBase64 !== 'string' || response.path !== assetPath) {
      throw new Error('Remote bundle asset response is invalid.')
    }
    const bytes = Buffer.from(response.bodyBase64, 'base64')
    if (bytes.byteLength > MAX_ASSET_RESPONSE_BYTES) throw new Error('Remote bundle asset exceeds the Desktop limit.')
    return new Uint8Array(bytes)
  }

  private request(payload: Record<string, unknown>): Promise<unknown> {
    if (this.channel.readyState !== 'open') return Promise.reject(new Error('Desktop WebRTC asset lane is unavailable.'))
    if (this.pending.size >= 4) return Promise.reject(new Error('Desktop WebRTC asset request limit reached.'))
    const id = `desktop-asset-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.send({ type: 'asset:cancel', id })
        reject(new Error('Desktop WebRTC asset request timed out.'))
      }, ASSET_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ ...payload, id }) } catch (error) {
        clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private send(value: unknown): void {
    const frame = textEncoder.encode(JSON.stringify(value))
    if (frame.byteLength > 64 * 1024) throw new Error('Desktop WebRTC asset control frame is too large.')
    this.channel.send(frame)
  }

  private receive(frame: Uint8Array): void {
    let message: Record<string, unknown>
    try {
      const value = JSON.parse(textDecoder.decode(frame)) as unknown
      if (!isRecord(value) || typeof value.id !== 'string') return
      message = value
    } catch { this.failAll(new Error('Desktop WebRTC asset response is malformed.')); return }
    const pending = this.pending.get(message.id as string)
    if (!pending) return
    if (typeof message.error === 'string') { this.finish(message.id as string, new Error(message.error)); return }
    if (message.type === 'asset:chunk') {
      const index = Number(message.index), total = Number(message.total)
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 0 || total < 1 || total > 128 || index >= total || typeof message.bodyBase64Chunk !== 'string') {
        this.finish(message.id as string, new Error('Remote bundle asset chunk is invalid.')); return
      }
      pending.chunks ??= Array<string | undefined>(total).fill(undefined)
      if (pending.chunks.length !== total || pending.chunks[index] !== undefined) { this.finish(message.id as string, new Error('Remote bundle asset chunks are inconsistent.')); return }
      pending.metadata ??= Object.fromEntries(Object.entries(message).filter(([key]) => !['bodyBase64Chunk', 'index', 'total', 'type'].includes(key)))
      pending.chunks[index] = message.bodyBase64Chunk
      this.send({ type: 'asset:ack', id: message.id, index })
      if (pending.chunks.every((chunk) => chunk !== undefined)) this.finish(message.id as string, { ...pending.metadata, bodyBase64: pending.chunks.join('') })
      return
    }
    const { id: _id, ...response } = message
    this.finish(message.id as string, response)
  }

  private finish(id: string, value: unknown): void {
    const pending = this.pending.get(id); if (!pending) return
    clearTimeout(pending.timer); this.pending.delete(id)
    if (value instanceof Error) pending.reject(value); else pending.resolve(value)
  }
  private failAll(error: Error): void { for (const id of [...this.pending.keys()]) this.finish(id, error) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
