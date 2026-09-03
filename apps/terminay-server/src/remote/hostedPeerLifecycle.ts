export type HostedIceServer = Readonly<{
	credential?: string;
	urls: string | readonly string[];
	username?: string;
}>;

export const DEFAULT_HOSTED_ICE_SERVERS: readonly HostedIceServer[] =
	Object.freeze([{ urls: 'stun:stun.l.google.com:19302' }]);

export const DEFAULT_ICE_RECOVERY_GRACE_MS = 5_000;

export const DEVICE_HOST_AVAILABILITY_MS = 25 * 60 * 1000;
export const DEVICE_REFRESH_LEAD_MS = 5 * 60 * 1000;

export function deviceHostRefreshDelayMs(
	expiresAt: number,
	now: number,
	leadMs = DEVICE_REFRESH_LEAD_MS,
): number {
	return Math.max(1_000, expiresAt - now - leadMs);
}

type PeerLike = Readonly<{
	connectionState?: string;
	iceConnectionState?: string;
}>;

export function resolveHostedIceServers(
	value?: readonly HostedIceServer[] | null,
): readonly HostedIceServer[] {
	if (value && value.length > 0) return Object.freeze([...value]);
	return DEFAULT_HOSTED_ICE_SERVERS;
}

/** Parse Desktop/CLI ICE server config. Empty input uses the default STUN server. */
export function parseHostedIceServers(
	value?: string | null,
): readonly HostedIceServer[] {
	const input = String(value ?? '').trim();
	if (!input) return DEFAULT_HOSTED_ICE_SERVERS;
	if (input.length > 32 * 1024) {
		throw new Error('WebRTC ICE server configuration exceeds 32 KiB.');
	}
	if (input.startsWith('[')) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(input);
		} catch {
			throw new Error('WebRTC ICE server JSON is invalid.');
		}
		if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8) {
			throw new Error(
				'WebRTC ICE server JSON must contain between 1 and 8 entries.',
			);
		}
		return Object.freeze(
			parsed.map((entry) => normalizeHostedIceServer(entry)),
		);
	}
	const urls = input
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (urls.length < 1 || urls.length > 16) {
		throw new Error(
			'WebRTC ICE server URL list must contain between 1 and 16 entries.',
		);
	}
	return Object.freeze(
		urls.map((url) => {
			assertHostedIceServerUrl(url);
			return { urls: url };
		}),
	);
}

function normalizeHostedIceServer(value: unknown): HostedIceServer {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Each WebRTC ICE server entry must be an object.');
	}
	const entry = value as Record<string, unknown>;
	const allowedKeys = new Set(['credential', 'urls', 'username']);
	if (Object.keys(entry).some((key) => !allowedKeys.has(key))) {
		throw new Error('WebRTC ICE server entries contain an unsupported field.');
	}
	const urls =
		typeof entry.urls === 'string'
			? [entry.urls]
			: Array.isArray(entry.urls) &&
					entry.urls.every((url) => typeof url === 'string')
				? entry.urls
				: null;
	if (!urls || urls.length < 1 || urls.length > 4) {
		throw new Error(
			'Each WebRTC ICE server entry requires between 1 and 4 URLs.',
		);
	}
	for (const url of urls) assertHostedIceServerUrl(url);
	const hasUsername = Reflect.has(entry, 'username');
	const hasCredential = Reflect.has(entry, 'credential');
	if (hasUsername !== hasCredential) {
		throw new Error('TURN username and credential must be supplied together.');
	}
	if (hasUsername) {
		if (
			typeof entry.username !== 'string' ||
			entry.username.length < 1 ||
			entry.username.length > 512 ||
			typeof entry.credential !== 'string' ||
			entry.credential.length < 1 ||
			entry.credential.length > 2048
		) {
			throw new Error('TURN username or credential has an invalid length.');
		}
		if (urls.some((url) => !/^turns?:/i.test(url))) {
			throw new Error('WebRTC ICE credentials apply only to TURN URLs.');
		}
	}
	return Object.freeze({
		...(hasCredential
			? {
					credential: entry.credential as string,
					username: entry.username as string,
				}
			: {}),
		urls: typeof entry.urls === 'string' ? urls[0]! : urls,
	});
}

function assertHostedIceServerUrl(value: string): void {
	if (
		value.length < 1 ||
		value.length > 2048 ||
		!/^(stun|stuns|turn|turns):/i.test(value) ||
		value.includes('@') ||
		/\s/.test(value) ||
		Array.from(value).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint < 0x20 || codePoint === 0x7f;
		})
	) {
		throw new Error('WebRTC ICE server configuration contains an invalid URL.');
	}
}

export function resolveIceRecoveryGraceMs(value: number | undefined): number {
	const resolved = value ?? DEFAULT_ICE_RECOVERY_GRACE_MS;
	if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 60_000) {
		throw new RangeError(
			'WebRTC ICE recovery grace period must be between 1ms and 60 seconds.',
		);
	}
	return resolved;
}

export function isTerminalWebRtcState(
	state: string | undefined,
): state is 'closed' | 'failed' {
	return state === 'closed' || state === 'failed';
}

export function isRecoverableDisconnectState(
	state: string | undefined,
): boolean {
	return state === 'disconnected';
}

export function isHealthyIceState(state: string | undefined): boolean {
	return state === 'connected' || state === 'completed';
}

/** ICE `disconnected` while the peer is still `connected` is a consent blip. */
export function needsDisconnectGrace(
	peerState: string | undefined,
	iceState: string | undefined,
): boolean {
	if (isRecoverableDisconnectState(peerState)) return true;
	return isRecoverableDisconnectState(iceState) && peerState !== 'connected';
}

/**
 * The lanes a live session cannot deliver without. `api` and `asset` are
 * bootstrap lanes: they carry the host context and the UI archive, and closing
 * after that transfer is normal.
 */
export const REQUIRED_LANES: ReadonlySet<string> = Object.freeze(
	new Set(['control', 'application', 'terminal', 'assets']),
) as ReadonlySet<string>;

/**
 * A required lane leaving `open` is a generation failure — the peer can no
 * longer deliver, whatever ICE reports.
 *
 * A lane that has never opened is still negotiating. Handshake ordering is not
 * a delivery failure, and treating it as one was the false positive that made
 * earlier builds tear down healthy sessions mid-connect.
 */
export function requiredLaneClosed(
	channel: string | undefined,
	channelState: string | undefined,
	everOpened: boolean,
): boolean {
	if (channel === undefined || !REQUIRED_LANES.has(channel)) return false;
	if (!everOpened) return false;
	return channelState === 'closed' || channelState === 'closing' || channelState === 'failed';
}

export type HostedLivePeer = Readonly<{
	peer: { close(): void };
	connection?: { close(): Promise<void> | void };
	/** Reported to the host when this peer is retired, so a replaced connection
	 * leaves the live list without depending on a native close event firing. */
	connectionId?: string;
}>;

/**
 * At most one live peer per device.
 *
 * A reconnect must retire the connection it replaces at join time. Letting a
 * superseded peer linger until its own transport finally gives up is what
 * produced two live server connections for one device, and the later of the
 * two teardowns then stopped the live session's stream.
 */
export class HostedLivePeerRegistry {
	private readonly peers = new Map<string, HostedLivePeer>();

	get size(): number {
		return this.peers.size;
	}

	get(deviceId: string): HostedLivePeer | undefined {
		return this.peers.get(deviceId);
	}

	set(deviceId: string, live: HostedLivePeer): void {
		this.peers.set(deviceId, live);
	}

	/** Drop the entry only when it still describes this exact peer, so a late
	 * teardown from a superseded generation cannot evict its replacement. */
	drop(deviceId: string, peer: HostedLivePeer['peer']): HostedLivePeer | undefined {
		const existing = this.peers.get(deviceId);
		if (existing === undefined || existing.peer !== peer) return undefined;
		this.peers.delete(deviceId);
		return existing;
	}

	/** Close and forget one device's live peer, awaiting its server-side
	 * connection cleanup so the replacement never overlaps with it. */
	async close(deviceId: string): Promise<HostedLivePeer | undefined> {
		const existing = this.peers.get(deviceId);
		if (existing === undefined) return undefined;
		this.peers.delete(deviceId);
		await closeLivePeer(existing);
		return existing;
	}

	async closeAll(): Promise<void> {
		const snapshot = [...this.peers.values()];
		this.peers.clear();
		for (const entry of snapshot) await closeLivePeer(entry);
	}
}

async function closeLivePeer(entry: HostedLivePeer): Promise<void> {
	// Release the server-owned connection first: its cleanup is what frees the
	// device's attachments and leases, and it must complete before a
	// replacement peer for the same device is accepted.
	try {
		await entry.connection?.close();
	} catch {
		/* A connection that already failed needs no further teardown. */
	}
	try {
		entry.peer.close();
	} catch {
		/* Best effort while dropping a retired generation. */
	}
}

export type HostedPeerLifecycleHooks = Readonly<{
	onGrace?: (
		phase: 'started' | 'cleared' | 'expired',
		peerState: string | undefined,
		iceState: string | undefined,
	) => void;
}>;

/** One connection-scoped ICE/peer authority. Grace is shared across peer and ICE. */
export class HostedPeerLifecycle {
	private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
	private stopped = false;
	private terminal = false;
	private readonly peer: PeerLike;
	private readonly recoveryGraceMs: number;
	private readonly closeSession: (reason: string) => void;
	private readonly hooks: HostedPeerLifecycleHooks | undefined;

	constructor(
		peer: PeerLike,
		recoveryGraceMs: number,
		closeSession: (reason: string) => void,
		hooks?: HostedPeerLifecycleHooks,
	) {
		this.peer = peer;
		this.recoveryGraceMs = recoveryGraceMs;
		this.closeSession = closeSession;
		this.hooks = hooks;
	}

	observe(source: 'peer' | 'ice'): void {
		if (this.stopped || this.terminal) return;
		const peerState = this.peer.connectionState;
		const iceState = this.peer.iceConnectionState;
		if (isTerminalWebRtcState(peerState) || isTerminalWebRtcState(iceState)) {
			const reason =
				source === 'peer' && isTerminalWebRtcState(peerState)
					? `WebRTC peer connection ${peerState}.`
					: source === 'ice' && isTerminalWebRtcState(iceState)
						? `WebRTC ICE connection ${iceState}.`
						: `WebRTC connection failed (peer: ${peerState}, ICE: ${iceState}).`;
			this.fail(reason);
			return;
		}
		if (needsDisconnectGrace(peerState, iceState)) {
			const started = this.recoveryTimer === undefined;
			this.recoveryTimer ??= setTimeout(() => {
				this.recoveryTimer = undefined;
				if (this.stopped || this.terminal) return;
				const currentPeerState = this.peer.connectionState;
				const currentIceState = this.peer.iceConnectionState;
				if (needsDisconnectGrace(currentPeerState, currentIceState)) {
					this.hooks?.onGrace?.('expired', currentPeerState, currentIceState);
					this.fail(
						`WebRTC recovery grace period expired (peer: ${currentPeerState}, ICE: ${currentIceState}).`,
					);
				} else {
					this.cancelRecovery('cleared');
				}
			}, this.recoveryGraceMs);
			this.recoveryTimer.unref?.();
			if (started) this.hooks?.onGrace?.('started', peerState, iceState);
			return;
		}
		this.cancelRecovery('cleared');
	}

	stop(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.cancelRecovery();
	}

	fail(reason: string): void {
		if (this.terminal || this.stopped) return;
		this.terminal = true;
		this.cancelRecovery();
		this.closeSession(reason);
	}

	private cancelRecovery(phase?: 'cleared'): void {
		if (this.recoveryTimer === undefined) return;
		clearTimeout(this.recoveryTimer);
		this.recoveryTimer = undefined;
		if (phase === 'cleared' && !this.stopped && !this.terminal) {
			this.hooks?.onGrace?.(
				'cleared',
				this.peer.connectionState,
				this.peer.iceConnectionState,
			);
		}
	}
}

/**
 * Ordering for one device's takeover, and nothing else.
 *
 * A replacement peer must not attach before the peer it replaces has been
 * retired and cleaned up. That ordering only matters between two peers for the
 * same device, so it gets its own chain per device: sharing the handshake join
 * queue made an authenticated peer's `application-auth` reply wait behind
 * `addIceCandidate` for unrelated handshakes, which starved it past the
 * client's timeout.
 */
export function createDeviceReplacementChain(): {
	run<T>(deviceId: string, task: () => Promise<T>): Promise<T>;
	readonly size: number;
} {
	const chains = new Map<string, Promise<unknown>>();
	return {
		get size() {
			return chains.size;
		},
		run(deviceId, task) {
			const previous = chains.get(deviceId) ?? Promise.resolve();
			const run = previous.then(task, task);
			const settled = run.then(
				() => undefined,
				() => undefined,
			);
			chains.set(deviceId, settled);
			// Drop the entry once it drains so a long-lived host does not retain
			// one promise per device id it has ever seen.
			void settled.then(() => {
				if (chains.get(deviceId) === settled) chains.delete(deviceId);
			});
			return run;
		},
	};
}

export function createHandshakeJoinQueue(): {
	enqueue(start: () => Promise<void>): Promise<void>;
} {
	let chain = Promise.resolve();
	return {
		enqueue(start) {
			const run = chain.then(start, start);
			chain = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
	};
}

export type HostIceAddressFamily = 'IPv4' | 'IPv6' | 4 | 6;

export type HostIceNetworkAddress = Readonly<{
	address: string;
	family: HostIceAddressFamily | string;
	internal?: boolean;
}>;

export function isUsableHostIceAddress(address: string): boolean {
	const value = address.trim().toLowerCase();
	if (!value) return false;
	if (value.startsWith('169.254.')) return false;
	if (value === '::' || value.startsWith('fe80:')) return false;
	return true;
}

export function collectHostIceAddresses(
	nics: Readonly<Record<string, readonly HostIceNetworkAddress[] | undefined>> = {},
): readonly string[] {
	const addresses = new Set<string>();
	for (const entries of Object.values(nics)) {
		for (const entry of entries ?? []) {
			const family = entry.family;
			if (family !== 'IPv4' && family !== 'IPv6' && family !== 4 && family !== 6) {
				continue;
			}
			if (!isUsableHostIceAddress(entry.address)) continue;
			addresses.add(entry.address);
		}
	}
	return Object.freeze([...addresses]);
}

export function hostedPeerConfiguration(
	connectHost: string | undefined,
	iceServers?: readonly HostedIceServer[],
	hostAddresses?: readonly string[],
): Record<string, unknown> {
	const loopback =
		connectHost === '127.0.0.1' ||
		connectHost === 'localhost' ||
		connectHost === '::1';
	const additional = [
		...new Set(
			(hostAddresses ?? []).filter((address) => isUsableHostIceAddress(address)),
		),
	];
	return {
		iceServers: [...resolveHostedIceServers(iceServers)],
		maxMessageSize: 1024 * 1024,
		...(loopback
			? {
					iceAdditionalHostAddresses: ['127.0.0.1'],
					iceInterfaceAddresses: { udp4: '127.0.0.1' },
					iceUseIpv4: false,
					iceUseIpv6: false,
				}
			: {
					iceUseIpv4: true,
					iceUseIpv6: true,
					...(additional.length === 0
						? {}
						: { iceAdditionalHostAddresses: additional }),
				}),
	};
}
