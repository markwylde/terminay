import type { NodeDataChannelPeerLike } from './nodeDataChannelPeer.js';
import type {
	NodeDataChannelLike,
	NodeDataChannelRuntimeModule,
} from './nodeDataChannelRuntime.js';
import type { SecureWeriftRuntimeModule } from './secureWeriftRuntime.js';

type Listener = (event: Readonly<Record<string, unknown>>) => void;
type WeriftDataChannel = {
	readonly label: string;
	readonly readyState: string;
	readonly bufferedAmount: number;
	send(frame: Uint8Array): void;
	close(): void;
	addEventListener(type: string, listener: Listener): void;
};
type WeriftPeer = {
	readonly connectionState?: string;
	createDataChannel(
		label: string,
		options?: { readonly ordered?: boolean },
	): WeriftDataChannel;
	createOffer(): Promise<Readonly<{ type: string; sdp?: string }>>;
	createAnswer(): Promise<Readonly<{ type: string; sdp?: string }>>;
	setLocalDescription(
		description: Readonly<{ type: string; sdp?: string }>,
	): Promise<void>;
	setRemoteDescription(
		description: Readonly<{ type: string; sdp: string }>,
	): Promise<void>;
	addIceCandidate(
		candidate: Readonly<{
			candidate: string;
			sdpMid: string;
		}>,
	): Promise<void>;
	close(): void;
	addEventListener(type: string, listener: Listener): void;
};

/**
 * Present the selected W3C-shaped Werift peer through the already-hardened
 * authenticated signaling/channel boundary. This is an explicit compatibility
 * surface, not a runtime fallback: callers still register the adapter as
 * `werift`, and the blocked node-datachannel package is never loaded.
 */
export function createSecureWeriftCompatibilityModule(
	runtime: SecureWeriftRuntimeModule,
): NodeDataChannelRuntimeModule {
	if (typeof runtime.RTCPeerConnection !== 'function') {
		throw new TypeError('Secure-Werift RTCPeerConnection is unavailable');
	}
	const RuntimePeer = runtime.RTCPeerConnection;
	return {
		PeerConnection: class SecureWeriftCompatibilityPeer
			implements NodeDataChannelPeerLike
		{
			readonly #peer: WeriftPeer;
			#descriptionListener: ((sdp: string, type: string) => void) | undefined;
			#candidateListener:
				| ((candidate: string, mid: string) => void)
				| undefined;
			#stateListener: ((state: string) => void) | undefined;
			#dataChannelListener:
				| ((channel: NodeDataChannelLike) => void)
				| undefined;
			#negotiationStarted = false;

			constructor(
				_id: string,
				configuration: Readonly<{
					iceServers?: readonly Record<string, unknown>[];
				}> = {},
			) {
				this.#peer = new RuntimePeer({
					iceServers: configuration.iceServers ?? [],
					maxMessageSize: 1024 * 1024,
				}) as WeriftPeer;
				this.#peer.addEventListener('icecandidate', (event) => {
					const rawCandidate = event.candidate as
						| { toJSON?(): Record<string, unknown> }
						| null
						| undefined;
					if (rawCandidate === null || rawCandidate === undefined) return;
					const normalized = JSON.parse(
						JSON.stringify(rawCandidate.toJSON?.() ?? rawCandidate),
					) as { candidate?: unknown; sdpMid?: unknown };
					if (
						typeof normalized.candidate === 'string' &&
						typeof normalized.sdpMid === 'string'
					) {
						this.#candidateListener?.(normalized.candidate, normalized.sdpMid);
					}
				});
				this.#peer.addEventListener('connectionstatechange', () => {
					this.#stateListener?.(this.#peer.connectionState ?? 'unknown');
				});
				this.#peer.addEventListener('datachannel', (event) => {
					const channel = event.channel as WeriftDataChannel | undefined;
					if (channel !== undefined) {
						this.#dataChannelListener?.(wrapWeriftDataChannel(channel));
					}
				});
			}

			onLocalDescription(listener: (sdp: string, type: string) => void): void {
				this.#descriptionListener = listener;
			}

			onLocalCandidate(
				listener: (candidate: string, mid: string) => void,
			): void {
				this.#candidateListener = listener;
			}

			onStateChange(listener: (state: string) => void): void {
				this.#stateListener = listener;
			}

			onDataChannel(listener: (channel: NodeDataChannelLike) => void): void {
				this.#dataChannelListener = listener;
			}

			createDataChannel(
				label: string,
				options?: { readonly ordered?: boolean },
			): NodeDataChannelLike {
				const channel = wrapWeriftDataChannel(
					this.#peer.createDataChannel(label, options),
				);
				if (!this.#negotiationStarted) {
					this.#negotiationStarted = true;
					void this.#publishOffer();
				}
				return channel;
			}

			setRemoteDescription(sdp: string, type: string): void {
				void (async () => {
					await this.#peer.setRemoteDescription({ sdp, type });
					if (type !== 'offer') return;
					const answer = await this.#peer.createAnswer();
					await this.#peer.setLocalDescription(answer);
					this.#publishDescription(answer);
				})().catch(() => this.#stateListener?.('failed'));
			}

			addRemoteCandidate(candidate: string, mid: string): void {
				void this.#peer
					.addIceCandidate({ candidate, sdpMid: mid })
					.catch(() => this.#stateListener?.('failed'));
			}

			close(): void {
				this.#peer.close();
			}

			async #publishOffer(): Promise<void> {
				try {
					const offer = await this.#peer.createOffer();
					await this.#peer.setLocalDescription(offer);
					this.#publishDescription(offer);
				} catch {
					this.#stateListener?.('failed');
				}
			}

			#publishDescription(
				description: Readonly<{
					type: string;
					sdp?: string;
				}>,
			): void {
				if (
					typeof description.sdp !== 'string' ||
					description.sdp.length === 0
				) {
					this.#stateListener?.('failed');
					return;
				}
				this.#descriptionListener?.(description.sdp, description.type);
			}
		},
	};
}

function wrapWeriftDataChannel(
	channel: WeriftDataChannel,
): NodeDataChannelLike {
	const closeListeners = new Set<() => void>();
	let messageListener: ((message: unknown) => void) | undefined;
	channel.addEventListener('message', (event) => {
		const data = event.data;
		if (data instanceof Uint8Array) messageListener?.(data);
		else if (data instanceof ArrayBuffer)
			messageListener?.(new Uint8Array(data));
		else if (ArrayBuffer.isView(data)) {
			messageListener?.(
				new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
			);
		}
	});
	channel.addEventListener('close', () => {
		for (const listener of closeListeners) listener();
	});
	return {
		getLabel: () => channel.label,
		isOpen: () => channel.readyState === 'open',
		bufferedAmount: () => channel.bufferedAmount,
		sendMessageBinary(frame) {
			if (channel.readyState !== 'open') return false;
			channel.send(frame);
			return true;
		},
		onMessage(listener) {
			messageListener = listener;
		},
		onClosed(listener) {
			closeListeners.add(listener);
		},
		close: () => channel.close(),
	};
}
