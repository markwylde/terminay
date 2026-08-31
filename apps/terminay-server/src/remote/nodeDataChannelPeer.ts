import type { RemoteTrafficChannel } from '@terminay/server-core/remote';
import type {
	HeadlessWebRtcRuntimeContext,
	NodeDataChannelLike,
	NodeDataChannelRuntimeModule,
} from './nodeDataChannelRuntime.js';

export type NodeDataChannelSignal =
	| { readonly type: 'offer' | 'answer'; readonly sdp: string }
	| { readonly type: 'ice'; readonly candidate: string; readonly mid: string };

export interface NodeDataChannelPeerLike {
	onLocalDescription(listener: (sdp: string, type: string) => void): void;
	onLocalCandidate(listener: (candidate: string, mid: string) => void): void;
	onStateChange(listener: (state: string) => void): void;
	onDataChannel(listener: (channel: NodeDataChannelLike) => void): void;
	createDataChannel?(label: string, options?: { readonly ordered?: boolean }): NodeDataChannelLike;
	setRemoteDescription(sdp: string, type: string): void;
	addRemoteCandidate(candidate: string, mid: string): void;
	close(): void;
}

/**
 * Signaling is deliberately injected by the authenticated relay boundary.
 * This adapter never receives a PIN, device key, long-lived credential, or
 * derived signaling secret. The relay admits each peer; this boundary only
 * validates the bounded message format and session binding it receives.
 */
export interface NodeDataChannelSignaling {
	send(message: unknown): void | Promise<void>;
	onMessage(listener: (message: unknown) => void): () => void;
	readonly encode: (message: NodeDataChannelSignal) => unknown | Promise<unknown>;
	readonly decode: (message: unknown) => NodeDataChannelSignal | null | Promise<NodeDataChannelSignal | null>;
}

export interface NodeDataChannelPeerConnectorOptions {
	readonly signaling: NodeDataChannelSignaling;
	readonly iceServers?: readonly Record<string, unknown>[];
	readonly bindAddress?: string;
	readonly role?: 'answerer' | 'offerer';
	readonly timeoutMs?: number;
	/** Bound relay-admitted messages waiting for asynchronous decoding. */
	readonly maxQueuedSignals?: number;
	/**
	 * Bound one relay-message decoding operation. The decoder is injected at the
	 * hosted boundary; a stalled decoder must not retain a peer queue indefinitely.
	 */
	readonly signalDecodingTimeoutMs?: number;
	/**
	 * Bound native-generated SDP/ICE callbacks awaiting encoding and relay send.
	 * Native callbacks are outside the server-owned protocol boundary and may
	 * otherwise create an unbounded number of asynchronous encoder operations.
	 */
	readonly maxQueuedOutboundSignals?: number;
	/**
	 * Bound one native-generated signal's encoding and relay delivery. A peer can
	 * remain established after setup, so the setup timeout alone cannot reclaim
	 * a native callback whose hosted signer or relay never settles.
	 */
	readonly outboundSignalTimeoutMs?: number;
	/** Bound relay-decoded SDP and ICE payload bytes before native peer delivery. */
	readonly maxSignalBytes?: number;
	/** Bound relay-admitted ICE candidates received before the remote SDP. */
	readonly maxPendingCandidates?: number;
	/**
	 * Bound every distinct relay-admitted remote ICE candidate for this peer,
	 * including candidates received after the SDP is accepted. This bounds the
	 * replay-detection set as well as native candidate processing.
	 */
	readonly maxRemoteCandidates?: number;
}

/** Create a relay-admitted channel opener for createNodeDataChannelRuntimeAdapter. */
export function createNodeDataChannelOpenChannels(
	options: NodeDataChannelPeerConnectorOptions,
): (
	module: NodeDataChannelRuntimeModule,
	context: HeadlessWebRtcRuntimeContext,
) => Promise<ReadonlyMap<RemoteTrafficChannel, NodeDataChannelLike>> {
	if (typeof options.signaling?.send !== 'function' || typeof options.signaling.onMessage !== 'function') {
		throw new TypeError('node-datachannel signaling transport is required');
	}
	if (typeof options.signaling.encode !== 'function' || typeof options.signaling.decode !== 'function') {
		throw new TypeError('node-datachannel signaling codec is required');
	}
	// This value crosses an injected runtime boundary. Do not let an unchecked
	// JavaScript caller silently fall through to the answerer behaviour: that
	// could make the peer accept a remote offer while its native binding was
	// configured for some other role. Validate it before constructing a peer or
	// subscribing to the authenticated relay.
	if (options.role !== undefined && options.role !== 'offerer' && options.role !== 'answerer') {
		throw new RangeError('node-datachannel peer role is invalid');
	}
	const timeoutMs = options.timeoutMs ?? 30_000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 5 * 60 * 1000) {
		throw new RangeError('node-datachannel peer timeout is invalid');
	}
	const maxQueuedSignals = options.maxQueuedSignals ?? 64;
	if (!Number.isSafeInteger(maxQueuedSignals) || maxQueuedSignals <= 0 || maxQueuedSignals > 1_024) {
		throw new RangeError('node-datachannel queued signaling limit is invalid');
	}
	const signalDecodingTimeoutMs = options.signalDecodingTimeoutMs ?? Math.min(timeoutMs, 10_000);
	if (
		!Number.isSafeInteger(signalDecodingTimeoutMs) ||
		signalDecodingTimeoutMs <= 0 ||
		signalDecodingTimeoutMs > timeoutMs
	) {
		throw new RangeError('node-datachannel signaling decoding timeout is invalid');
	}
	const maxQueuedOutboundSignals = options.maxQueuedOutboundSignals ?? 64;
	if (
		!Number.isSafeInteger(maxQueuedOutboundSignals) ||
		maxQueuedOutboundSignals <= 0 ||
		maxQueuedOutboundSignals > 1_024
	) {
		throw new RangeError('node-datachannel outbound signaling queue limit is invalid');
	}
	const outboundSignalTimeoutMs = options.outboundSignalTimeoutMs ?? Math.min(timeoutMs, 10_000);
	if (
		!Number.isSafeInteger(outboundSignalTimeoutMs) ||
		outboundSignalTimeoutMs <= 0 ||
		outboundSignalTimeoutMs > timeoutMs
	) {
		throw new RangeError('node-datachannel outbound signaling timeout is invalid');
	}
	const maxSignalBytes = options.maxSignalBytes ?? 64 * 1024;
	if (!Number.isSafeInteger(maxSignalBytes) || maxSignalBytes <= 0 || maxSignalBytes > 1024 * 1024) {
		throw new RangeError('node-datachannel signaling size limit is invalid');
	}
	const maxPendingCandidates = options.maxPendingCandidates ?? 64;
	if (!Number.isSafeInteger(maxPendingCandidates) || maxPendingCandidates <= 0 || maxPendingCandidates > 1_024) {
		throw new RangeError('node-datachannel pending candidate limit is invalid');
	}
	const maxRemoteCandidates = options.maxRemoteCandidates ?? 256;
	if (!Number.isSafeInteger(maxRemoteCandidates) || maxRemoteCandidates <= 0 || maxRemoteCandidates > 4_096) {
		throw new RangeError('node-datachannel remote candidate limit is invalid');
	}

	return async (module, context) => {
		if (context.channels.length === 0) throw new TypeError('node-datachannel channel contract is empty');
		const PeerConnection = module.PeerConnection as new (
			id: string,
			configuration: Record<string, unknown>,
		) => NodeDataChannelPeerLike;
		if (typeof PeerConnection !== 'function') throw new TypeError('node-datachannel PeerConnection is unavailable');
		const peer = new PeerConnection(`terminay-${context.peerId}`, {
			...(options.bindAddress === undefined ? {} : { bindAddress: options.bindAddress }),
			iceServers: [...(options.iceServers ?? [])],
		});
		const channels = new Map<string, NodeDataChannelLike>();
		const closedChannels = new Set<string>();
		let removeSignal = (): void => undefined;
		let removeAbort = (): void => undefined;
		let connected = false;
		let closed = false;
		let settled = false;
		let remoteDescriptionAccepted = false;
		const pendingCandidates: Array<Extract<NodeDataChannelSignal, { readonly type: 'ice' }>> = [];
		const seenRemoteCandidates = new Set<string>();
		let pendingSignals = 0;
		let signalQueue: Promise<void> = Promise.resolve();
		let pendingOutboundSignals = 0;
		let outboundSignalQueue: Promise<void> = Promise.resolve();
		let resolve!: (value: ReadonlyMap<RemoteTrafficChannel, NodeDataChannelLike>) => void;
		let reject!: (reason?: unknown) => void;
		const result = new Promise<ReadonlyMap<RemoteTrafficChannel, NodeDataChannelLike>>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		// Some native setup failures are synchronous (for example an offerer
		// returning a malformed channel) and are rethrown directly by this async
		// opener. `fail` must still reject the internal readiness promise for the
		// asynchronous path, but that promise otherwise has no consumer in the
		// synchronous-failure branch and would surface as an unhandled rejection.
		void result.catch(() => undefined);
		const fail = (error: unknown): void => {
			if (closed) return;
			closed = true;
			// Both cleanup hooks cross host/native boundaries. A faulty signaling
			// unsubscribe must not escape a native state callback or prevent the
			// rest of authenticated peer teardown from running.
			try {
				removeSignal();
			} catch {
				/* Continue fail-closed teardown after an untrusted cleanup failure. */
			}
			try {
				removeAbort();
			} catch {
				/* Abort listener cleanup cannot veto connection shutdown either. */
			}
			for (const channel of channels.values()) {
				try {
					channel.close();
				} catch {
					/* Native channel cleanup is best effort after a failed connection. */
				}
			}
			try {
				peer.close();
			} catch {
				/* Native cleanup is best effort after a failed connection. */
			}
			if (!settled) {
				settled = true;
				reject(error instanceof Error ? error : new Error('node-datachannel peer setup failed'));
			}
		};
		const completeIfReady = (): void => {
			if (
				closed ||
				connected ||
				!remoteDescriptionAccepted ||
				pendingSignals !== 0 ||
				channels.size !== context.channels.length
			) return;
			// This probe runs before the runtime adapter wraps the raw native
			// channels. Treat it as a native boundary too: a binding can throw while
			// reporting its state, and that must fail the authenticated setup rather
			// than escape a data-channel callback or leave its relay subscribed.
			try {
				if ([...channels.values()].some((channel) => channel.isOpen() !== true)) return;
			} catch {
				fail(new Error('node-datachannel channel state inspection failed during setup'));
				return;
			}
			connected = true;
			settled = true;
			resolve(new Map(context.channels.map((label) => [label, channels.get(label) as NodeDataChannelLike])));
		};
		const send = async (message: NodeDataChannelSignal): Promise<void> => {
			if (closed) return;
			// Native callbacks are outside the server-owned protocol boundary. Do
			// not encode or send a malformed/oversized local SDP or ICE payload just
			// because it originated from the optional native runtime; use the same
			// bounded shape gate as relay-admitted inbound signaling.
			validateSignal(message, maxSignalBytes);
			const encoded = await runWithBudget(
				() => options.signaling.encode(message),
				context.signal,
				outboundSignalTimeoutMs,
				'node-datachannel outbound signaling timed out',
			);
			// Encoding may be asynchronous. The connection can be revoked, aborted,
			// or otherwise fail while the signer is in flight; never publish a
			// now-stale relay signal after that lifecycle boundary.
			if (closed) return;
			if (encoded === undefined || encoded === null) throw new Error('node-datachannel signaling encoder rejected a message');
			await runWithBudget(
				() => options.signaling.send(encoded),
				context.signal,
				outboundSignalTimeoutMs,
				'node-datachannel outbound signaling timed out',
			);
		};
		const handleSignal = async (raw: unknown): Promise<void> => {
			if (closed) return;
			const message = await runWithBudget(
				() => options.signaling.decode(raw),
				context.signal,
				signalDecodingTimeoutMs,
				'node-datachannel signaling decoding timed out',
			);
			if (closed) return;
			if (message === null) throw new Error('node-datachannel signaling relay binding failed');
			validateSignal(message, maxSignalBytes);
			if (message.type === 'offer' || message.type === 'answer') {
				const expectedDescriptionType = options.role === 'offerer' ? 'answer' : 'offer';
				if (message.type !== expectedDescriptionType || remoteDescriptionAccepted) {
					throw new Error('node-datachannel signaling description is invalid or replayed');
				}
				remoteDescriptionAccepted = true;
				peer.setRemoteDescription(message.sdp, message.type);
				for (const candidate of pendingCandidates.splice(0)) {
					peer.addRemoteCandidate(candidate.candidate, candidate.mid);
				}
				return;
			}
			if (message.type !== 'ice') throw new Error('node-datachannel signaling message type is invalid');
			const candidateKey = JSON.stringify([message.candidate, message.mid]);
			if (seenRemoteCandidates.has(candidateKey)) {
				throw new Error('node-datachannel signaling candidate is replayed');
			}
			// The pre-SDP queue is bounded below, but this set also retains every
			// candidate after SDP acceptance to reject authenticated replay. Without
			// a separate lifetime bound, a connected peer could grow it indefinitely.
			if (seenRemoteCandidates.size >= maxRemoteCandidates) {
				throw new Error('node-datachannel remote candidate limit reached');
			}
			seenRemoteCandidates.add(candidateKey);
			if (!remoteDescriptionAccepted) {
				if (pendingCandidates.length >= maxPendingCandidates) {
					throw new Error('node-datachannel pending candidate limit reached');
				}
				pendingCandidates.push(message);
				return;
			}
			peer.addRemoteCandidate(message.candidate, message.mid);
		};
		const enqueueSignal = (raw: unknown): void => {
			if (closed) return;
			if (pendingSignals >= maxQueuedSignals) {
				fail(new Error('node-datachannel signaling queue limit reached'));
				return;
			}
			pendingSignals += 1;
			signalQueue = signalQueue
				.then(() => handleSignal(raw))
				.catch(fail)
				.finally(() => {
					pendingSignals -= 1;
					completeIfReady();
				});
		};
		const enqueueOutboundSignal = (message: NodeDataChannelSignal): void => {
			if (closed) return;
			// A native peer can emit candidates faster than an asynchronous encoder
			// or hosted relay accepts them. Serialize that work and cap it before
			// invoking either boundary so a compromised/faulty native binding cannot
			// retain unbounded relay signaling state.
			if (pendingOutboundSignals >= maxQueuedOutboundSignals) {
				fail(new Error('node-datachannel outbound signaling queue limit reached'));
				return;
			}
			pendingOutboundSignals += 1;
			outboundSignalQueue = outboundSignalQueue
				.then(() => send(message))
				.catch(fail)
				.finally(() => {
					pendingOutboundSignals -= 1;
				});
		};

		try {
			// The relay is an injected boundary. Treat its subscription handle as
			// untrusted at runtime even though the TypeScript contract says it is a
			// function: retaining a peer after a malformed handle would make its
			// authenticated relay impossible to release on revoke or shutdown.
			const unsubscribe = options.signaling.onMessage(enqueueSignal);
			if (typeof unsubscribe !== 'function') {
				throw new TypeError('node-datachannel signaling unsubscribe is invalid');
			}
			removeSignal = unsubscribe;
			peer.onLocalDescription((sdp, type) => {
				if (closed) return;
				// The native binding must not be allowed to change the negotiated
				// direction. An answerer emitting an offer (or an offerer emitting an
			// answer) could otherwise publish an invalid relay SDP that is
				// inconsistent with the server-owned role and remote-description gate.
				const expectedLocalDescriptionType = options.role === 'offerer' ? 'offer' : 'answer';
				if (type !== expectedLocalDescriptionType) {
					return fail(new Error('node-datachannel produced an SDP type inconsistent with its role'));
				}
				enqueueOutboundSignal({ type, sdp });
			});
			if (closed) throw new Error('node-datachannel peer closed during native listener registration');
			peer.onLocalCandidate((candidate, mid) => {
				if (closed) return;
				if (typeof candidate !== 'string' || typeof mid !== 'string' || mid.length === 0) return fail(new Error('node-datachannel produced an invalid ICE candidate'));
				enqueueOutboundSignal({ type: 'ice', candidate, mid });
			});
			if (closed) throw new Error('node-datachannel peer closed during native listener registration');
			peer.onStateChange((state) => {
				// State is supplied by the optional native binding.  Do not silently
				// ignore an unexpected value: a corrupt/changed binding could otherwise
				// leave an authenticated relay subscription alive while the peer is no
				// longer in a lifecycle state the host understands.
				if (
					typeof state !== 'string' ||
					!['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'].includes(state)
				) {
					fail(new Error('node-datachannel peer reported an invalid state'));
					return;
				}
				if (state === 'failed' || state === 'closed' || state === 'disconnected') fail(new Error(`node-datachannel peer is ${state}`));
			});
			// Some native bindings synchronously replay their current state while a
			// listener is being registered. Once that state has failed the peer, do
			// not keep registering later callbacks or allocate a data-channel lane:
			// the adapter no longer owns a live peer to which those callbacks belong.
			if (closed) throw new Error('node-datachannel peer closed during native listener registration');
			const watchChannel = (channel: NodeDataChannelLike): void => {
				const label = channel.getLabel();
				channel.onClosed(() => {
					closedChannels.add(label);
					if (!connected) fail(new Error(`node-datachannel channel ${label} closed during setup`));
					// The authenticated session requires every isolated traffic lane.
					// Retaining the peer after one lane has disappeared would leave the
					// server with a half-live control/application/terminal/assets contract.
					// Tear down the complete peer immediately; `fail` is idempotent for
					// the close callbacks raised while it closes the remaining channels.
					else fail(new Error(`node-datachannel channel ${label} closed after setup`));
				});
			};
			peer.onDataChannel((channel) => {
				if (closed) {
					closeUntrackedChannel(channel);
					return;
				}
				let tracked = false;
				try {
					const label = channel.getLabel();
					if (!context.channels.includes(label as RemoteTrafficChannel) || channels.has(label)) {
						closeUntrackedChannel(channel);
						fail(new Error('node-datachannel supplied an unexpected or duplicate channel'));
						return;
					}
					channels.set(label, channel);
					tracked = true;
					watchChannel(channel);
					completeIfReady();
				} catch (error) {
					// Native implementations can synchronously reject label inspection or
					// lifecycle listener registration from their data-channel callback.
					// Contain that failure here: it must close the peer and any untracked
					// callback channel rather than escaping into node-datachannel.
					if (!tracked) closeUntrackedChannel(channel);
					fail(error);
				}
			});
			if (closed) throw new Error('node-datachannel peer closed during native listener registration');
			if (options.role === 'offerer') {
				if (typeof peer.createDataChannel !== 'function') throw new Error('node-datachannel cannot create data channels');
					for (const label of context.channels) {
						let channel: NodeDataChannelLike | undefined;
						try {
							channel = peer.createDataChannel(label, { ordered: true });
							if (channel.getLabel() !== label) throw new Error('node-datachannel returned a channel with the wrong label');
							channels.set(label, channel);
							watchChannel(channel);
							// A native binding may synchronously report this newly-created
							// channel closed while its lifecycle listener is installed. That
							// fails the allocation; do not create later lanes after teardown
							// has started, because `fail` cannot own channels created later.
							if (closed) break;
						} catch (error) {
							// The factory owns a just-created native channel until it is
							// registered in the tracked allocation. A malformed label or
							// lifecycle-registration failure must close that untracked
							// channel too; `fail` only owns channels already in the map.
							if (channel !== undefined && !channels.has(label)) closeUntrackedChannel(channel);
							throw error;
						}
				}
				completeIfReady();
			}
			const readiness = setInterval(completeIfReady, 5);
			const timeout = setTimeout(() => fail(new Error('node-datachannel peer setup timed out')), timeoutMs);
				const abort = (): void => fail(context.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
				if (context.signal.aborted) abort();
				else {
					context.signal.addEventListener('abort', abort, { once: true });
					removeAbort = () => context.signal.removeEventListener('abort', abort);
				}
				try {
					return await result;
			} finally {
				clearInterval(readiness);
				clearTimeout(timeout);
				}
		} catch (error) {
			fail(error);
			throw error;
		}
	};
}

function closeUntrackedChannel(channel: unknown): void {
	if (typeof channel !== 'object' || channel === null) return;
	const close = (channel as { readonly close?: unknown }).close;
	if (typeof close !== 'function') return;
	try {
		close.call(channel);
	} catch {
		/* Native callback cleanup is best effort after rejected admission. */
	}
}

function validateSignal(message: NodeDataChannelSignal, maxSignalBytes: number): void {
	if (message.type === 'offer' || message.type === 'answer') {
		// An empty (or whitespace-only) SDP is not a valid WebRTC description.
		// Treat it as malformed at this boundary rather than allowing a native
		// implementation to interpret it, or encoding and relaying it when it was
		// produced by an optional native binding.
		if (
			typeof message.sdp !== 'string' ||
			message.sdp.trim().length === 0 ||
			byteLength(message.sdp) > maxSignalBytes
		) {
			throw new Error('node-datachannel signaling description is invalid or too large');
		}
		return;
	}
	if (
		message.type !== 'ice' ||
		typeof message.candidate !== 'string' ||
		message.candidate.trim().length === 0 ||
		typeof message.mid !== 'string' ||
		message.mid.trim().length === 0 ||
		byteLength(message.candidate) + byteLength(message.mid) > maxSignalBytes
	) {
		throw new Error('node-datachannel signaling candidate is invalid or too large');
	}
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

async function runWithBudget<T>(
	operation: () => T | Promise<T>,
	signal: AbortSignal,
	timeoutMs: number,
	timeoutMessage: string,
): Promise<T> {
	if (signal.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
	return await new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener('abort', abort);
			callback();
		};
		const abort = (): void => finish(() => reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError')));
		const timeout = setTimeout(
			() => finish(() => reject(new Error(timeoutMessage))),
			timeoutMs,
		);
		signal.addEventListener('abort', abort, { once: true });
		Promise.resolve()
			.then(operation)
			.then(
				(value) => finish(() => resolve(value)),
				(error) => finish(() => reject(error)),
			);
	});
}
