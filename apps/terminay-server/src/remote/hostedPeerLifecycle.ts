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

const REQUIRED_LANES = new Set([
	'application',
	'assets',
	'control',
	'terminal',
]);

export type HostedLaneDiagnostic = Readonly<{
	channel?: string | undefined;
	channelState?: string | undefined;
	stallClass?: string | undefined;
	firstInboundAgeMs?: number | null | undefined;
	firstOutboundAgeMs?: number | null | undefined;
}>;

export const APPLICATION_STALL_FAIL_GRACE_MS = 15_000;

/** Handshake inbound overlapping a short outbound pause is not a failed generation. */
export function shouldFailHostedStall(event: HostedLaneDiagnostic): boolean {
	if (event.stallClass === 'no-outbound') {
		return (event.firstInboundAgeMs ?? 0) >= APPLICATION_STALL_FAIL_GRACE_MS;
	}
	if (event.stallClass === 'outbound-stalled') {
		return (event.firstOutboundAgeMs ?? 0) >= APPLICATION_STALL_FAIL_GRACE_MS;
	}
	return false;
}

/** Fail a hydrated generation that can no longer deliver. ICE consent blips
 * do not belong here; required-lane loss and application-lane silence do. */
export function applyHostedLaneDiagnostic(
	lifecycle: HostedPeerLifecycle,
	event: HostedLaneDiagnostic,
): void {
	if (shouldFailHostedStall(event)) {
		lifecycle.fail(`WebRTC application lane ${event.stallClass}.`);
		return;
	}
	if (
		event.channel !== undefined &&
		REQUIRED_LANES.has(event.channel) &&
		(event.channelState === 'closed' ||
			event.channelState === 'closing' ||
			event.channelState === 'failed')
	) {
		lifecycle.fail(`WebRTC ${event.channel} lane ${event.channelState}.`);
	}
}

export type HostedTrackedGeneration = Readonly<{
	peer: { close(): void };
	connection?: { close(): Promise<void> | void };
}>;

/** Live remote generations only. Retired peers must leave this set or later
 * hydrates keep a painted checkpoint while PTY is sent into dead Werift sockets. */
export class HostedGenerationSet {
	private readonly generations: HostedTrackedGeneration[] = [];

	get size(): number {
		return this.generations.length;
	}

	add(generation: HostedTrackedGeneration): void {
		this.generations.push(generation);
	}

	drop(peer: HostedTrackedGeneration['peer']): HostedTrackedGeneration | undefined {
		const index = this.generations.findIndex((entry) => entry.peer === peer);
		if (index < 0) return undefined;
		return this.generations.splice(index, 1)[0];
	}

	closeAll(): void {
		const snapshot = this.generations.splice(0);
		for (const entry of snapshot) {
			try {
				entry.peer.close();
			} catch {
				/* Best effort while dropping a poisoned generation. */
			}
			void entry.connection?.close();
		}
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

export function hostedPeerConfiguration(
	connectHost: string | undefined,
	iceServers?: readonly HostedIceServer[],
): Record<string, unknown> {
	const loopback =
		connectHost === '127.0.0.1' ||
		connectHost === 'localhost' ||
		connectHost === '::1';
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
			: {}),
	};
}
