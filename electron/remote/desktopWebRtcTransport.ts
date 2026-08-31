import type { ByteTransport, ProtocolId } from '@terminay/protocol'
import {
  HeadlessChannelTransport,
  type HeadlessDataChannel,
  type HeadlessChannelTransportOptions,
  type RemoteTrafficChannel,
} from '@terminay/server-core/remote'
import {
  createNodeDataChannelRuntimeAdapter,
  type NodeDataChannelRuntimeModule,
} from '../../apps/terminay-server/src/remote/nodeDataChannelRuntime'
import { createSecureWeriftCompatibilityModule } from '../../apps/terminay-server/src/remote/secureWeriftPeer'
import { loadSelectedSecureWeriftRuntime } from '../../apps/terminay-server/src/remote/secureWeriftRuntime'
import {
  createNodeDataChannelOpenChannels,
  type NodeDataChannelSignaling,
} from '../../apps/terminay-server/src/remote/nodeDataChannelPeer'
import type { DesktopArchiveAssetLane, DesktopAuthenticatedAssetLane } from '../../apps/terminay-desktop/src/main/serverBundleHost'

/**
 * Load the one selected WebRTC runtime and present it through the hardened
 * peer boundary. Verification of the artifact happens before any executable
 * code is imported; an unavailable runtime fails with an actionable error
 * rather than silently leaving Desktop unable to connect outward.
 */
async function loadSelectedWeriftModule(
  runtimeRoot: string | undefined,
): Promise<NodeDataChannelRuntimeModule> {
  if (runtimeRoot === undefined) {
    throw new Error(
      'The selected WebRTC runtime directory is unavailable, so Desktop cannot open a remote connection. Package the runtime, or set TERMINAY_WEBRTC_RUNTIME_ROOT in development.',
    )
  }
  return createSecureWeriftCompatibilityModule(
    await loadSelectedSecureWeriftRuntime(runtimeRoot),
  )
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })
const ASSET_REQUEST_TIMEOUT_MS = 15_000
const MAX_COMPRESSED_ARCHIVE_BYTES = 32 * 1024 * 1024
const MAX_ARCHIVE_CHUNKS = 2_048

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
  readonly webrtcRuntimeRoot?: string
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
  /** Packaged directory holding the selected WebRTC runtime and its manifest. */
  readonly webrtcRuntimeRoot?: string
  readonly timeoutMs?: number
  readonly transportOptions?: HeadlessChannelTransportOptions
}>): Promise<DesktopWebRtcConnection> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  const controller = new AbortController()
  const abort = (): void => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })

  try {
    const runtime = createNodeDataChannelRuntimeAdapter({
      // The selected, integrity-verified Secure-Werift artifact is the only
      // production WebRTC runtime. Defaulting to `node-datachannel` here meant
      // Desktop's outbound client tried to import a package this repository
      // does not depend on, so it could never establish a runtime at all.
      runtime: 'werift',
      loadModule: options.loadModule ?? (() => loadSelectedWeriftModule(options.webrtcRuntimeRoot)),
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

class DesktopWebRtcAssetLane implements DesktopArchiveAssetLane {
  private sequence = 0
  private pending: {
    readonly id: string
    readonly resolve: (value: Uint8Array) => void
    readonly reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
    chunks?: Array<Uint8Array | undefined>
    chunkBytes?: number
    compressedBytes?: number
  } | undefined

  constructor(private readonly channel: HeadlessDataChannel) {
    channel.onMessage((frame) => this.receive(frame))
    channel.onStateChange((state) => {
      if (state === 'closing' || state === 'closed') this.failAll(new Error('Desktop WebRTC asset lane closed.'))
    })
  }

  getBundle(): Promise<Uint8Array> {
    if (this.channel.readyState !== 'open') return Promise.reject(new Error('Desktop WebRTC asset lane is unavailable.'))
    if (this.pending !== undefined) return Promise.reject(new Error('Desktop WebRTC archive transfer is already active.'))
    const id = `desktop-bundle-${++this.sequence}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(id, new Error('Desktop WebRTC archive transfer timed out.')), ASSET_REQUEST_TIMEOUT_MS)
      this.pending = { id, resolve, reject, timer }
      try { this.send({ type: 'asset:get-bundle', id, archiveFormatVersion: 1 }) } catch (error) {
        this.finish(id, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private send(value: unknown): void {
    const frame = textEncoder.encode(JSON.stringify(value))
    if (frame.byteLength > 64 * 1024) throw new Error('Desktop WebRTC asset control frame is too large.')
    this.channel.send(frame)
  }

  private receive(frame: Uint8Array): void {
    if (isBundleChunk(frame)) { this.receiveChunk(frame); return }
    let message: Record<string, unknown>
    try {
      const value = JSON.parse(textDecoder.decode(frame)) as unknown
      if (!isRecord(value) || typeof value.id !== 'string') return
      message = value
    } catch { this.failAll(new Error('Desktop WebRTC asset response is malformed.')); return }
    const pending = this.pending
    if (pending === undefined || message.id !== pending.id) return
    if (message.type === 'asset:bundle-error') {
      this.finish(pending.id, new Error(typeof message.message === 'string' ? message.message : 'Desktop WebRTC archive transfer failed.')); return
    }
    if (message.type === 'asset:bundle-start') { this.receiveStart(message); return }
    if (message.type === 'asset:bundle-complete') {
      if (pending.chunks === undefined || pending.chunks.some((chunk) => chunk === undefined) || pending.compressedBytes === undefined) { this.finish(pending.id, new Error('Desktop WebRTC archive completed before all chunks arrived.')); return }
      const bytes = combineChunks(pending.chunks as Uint8Array[], pending.compressedBytes)
      this.finish(pending.id, bytes); return
    }
    this.cancel(pending.id, new Error('Desktop WebRTC archive response is invalid.'))
  }

  private receiveStart(message: Record<string, unknown>): void {
    const pending = this.pending; if (pending === undefined) return
    const chunkBytes = message.chunkBytes, chunks = message.chunks, compressedBytes = message.compressedBytes
    if (message.archiveFormatVersion !== 1 || typeof message.bundleId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/u.test(message.bundleId) || !Number.isSafeInteger(chunkBytes) || !Number.isSafeInteger(chunks) || !Number.isSafeInteger(compressedBytes)) { this.cancel(pending.id, new Error('Desktop WebRTC archive start is invalid.')); return }
    const boundedChunkBytes = chunkBytes as number, boundedChunks = chunks as number, boundedCompressedBytes = compressedBytes as number
    if (boundedChunkBytes < 1 || boundedChunkBytes > 1024 * 1024 || boundedChunks < 1 || boundedChunks > MAX_ARCHIVE_CHUNKS || boundedCompressedBytes < 1 || boundedCompressedBytes > MAX_COMPRESSED_ARCHIVE_BYTES || boundedChunks !== Math.ceil(boundedCompressedBytes / boundedChunkBytes)) { this.cancel(pending.id, new Error('Desktop WebRTC archive start is invalid.')); return }
    pending.chunks = Array<Uint8Array | undefined>(boundedChunks).fill(undefined)
    pending.chunkBytes = boundedChunkBytes; pending.compressedBytes = boundedCompressedBytes
    this.resetTimer(pending)
  }
  private receiveChunk(frame: Uint8Array): void {
    const pending = this.pending
    if (pending === undefined || pending.chunks === undefined || pending.chunkBytes === undefined) { if (pending !== undefined) this.cancel(pending.id, new Error('Desktop WebRTC archive chunk arrived before its start record.')); return }
    const index = new DataView(frame.buffer, frame.byteOffset, 8).getUint32(4, false)
    const body = frame.subarray(8)
    const expected = index === pending.chunks.length - 1 ? pending.compressedBytes! - pending.chunkBytes * index : pending.chunkBytes
    if (index >= pending.chunks.length || pending.chunks[index] !== undefined || body.byteLength !== expected) { this.cancel(pending.id, new Error('Desktop WebRTC archive chunk is invalid.')); return }
    pending.chunks[index] = Uint8Array.from(body)
    try { this.send({ type: 'asset:bundle-ack', id: pending.id, index }); this.resetTimer(pending) }
    catch (error) { this.finish(pending.id, error instanceof Error ? error : new Error(String(error))) }
  }
  private resetTimer(pending: NonNullable<DesktopWebRtcAssetLane['pending']>): void { clearTimeout(pending.timer); pending.timer = setTimeout(() => this.cancel(pending.id, new Error('Desktop WebRTC archive transfer timed out.')), ASSET_REQUEST_TIMEOUT_MS) }
  private cancel(id: string, error: Error): void { try { this.send({ type: 'asset:bundle-cancel', id }) } catch {} this.finish(id, error) }
  private finish(id: string, value: Uint8Array | Error): void {
    const pending = this.pending; if (pending === undefined || pending.id !== id) return
    clearTimeout(pending.timer); this.pending = undefined
    if (value instanceof Error) pending.reject(value); else pending.resolve(value)
  }
  private failAll(error: Error): void { if (this.pending !== undefined) this.finish(this.pending.id, error) }
}

function isBundleChunk(frame: Uint8Array): boolean { return frame.byteLength >= 8 && frame[0] === 0x54 && frame[1] === 0x42 && frame[2] === 0x01 && frame[3] === 0x01 }
function combineChunks(chunks: Uint8Array[], length: number): Uint8Array { const result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength } if (offset !== length) throw new Error('Desktop WebRTC archive length is invalid.'); return result }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
