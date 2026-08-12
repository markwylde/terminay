import type { ByteTransport, ProtocolId } from '@terminay/protocol'
import {
  HeadlessChannelTransport,
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
    if (application === undefined) {
      for (const channel of channels.values()) channel.close()
      throw new Error('Desktop WebRTC application channel is unavailable.')
    }
    const transport = new HeadlessChannelTransport(application, options.transportOptions)
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
    return transport
  } catch (error) {
    options.signal?.removeEventListener('abort', abort)
    throw error
  }
}
