import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AuthScope, JsonValue, ProtocolId } from '@terminay/protocol';

export const REMOTE_MCP_BRIDGE_VERSION = 1 as const;
export const REMOTE_MCP_MAX_FRAME_BYTES = 64 * 1024;
export const REMOTE_MCP_MAX_RESPONSE_BYTES = 256 * 1024;

export interface RemoteMcpBridgeScope {
	readonly terminalSessionId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly projectEnvironmentId: string;
	readonly environmentRevision: number;
	readonly scope: AuthScope;
}

export interface RemoteMcpBridgeCapability extends RemoteMcpBridgeScope {
	readonly bridgeId: string;
	readonly serverInstanceId: string;
	/** One-time bootstrap secret delivered only inside the authenticated SSH channel. */
	readonly bootstrapSecret: string;
	readonly issuedAt: number;
	readonly expiresAt: number;
}

export interface RemoteMcpRequestFrame {
	readonly version: typeof REMOTE_MCP_BRIDGE_VERSION;
	readonly bridgeId: string;
	readonly sequence: number;
	readonly deadline: number;
	readonly requestId: string;
	readonly op: string;
	readonly params: JsonValue;
	readonly mac: string;
}

export interface RemoteMcpResponseFrame {
	readonly version: typeof REMOTE_MCP_BRIDGE_VERSION;
	readonly bridgeId: string;
	readonly sequence: number;
	readonly requestId: string;
	readonly ok: boolean;
	readonly payload: JsonValue;
	readonly mac: string;
}

export interface RemoteMcpBridgeOptions {
	readonly now?: () => number;
	readonly ttlMs?: number;
	readonly maxDeadlineMs?: number;
	readonly maxFrameBytes?: number;
	readonly maxResponseBytes?: number;
	readonly maxInFlight?: number;
	readonly serverInstanceId?: string;
	readonly dispatch: (scope: Readonly<RemoteMcpBridgeScope>, op: string, params: JsonValue, context: { readonly signal: AbortSignal }) => Promise<JsonValue>;
}

interface Entry extends RemoteMcpBridgeScope {
	readonly bridgeId: string;
	readonly issuedAt: number;
	readonly expiresAt: number;
	readonly requestKey: Buffer;
	readonly responseKey: Buffer;
	lastSequence: number;
	inFlight: number;
	revoked: boolean;
	readonly controllers: Set<AbortController>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OP = /^[a-z][a-z0-9_]{0,63}$/u;

export class RemoteMcpBridgeError extends Error {
	constructor(readonly code: 'invalid-capability' | 'scope-mismatch' | 'replay' | 'expired' | 'deadline' | 'limit-exceeded' | 'bad-frame' | 'revoked', message: string) {
		super(message); this.name = 'RemoteMcpBridgeError';
	}
}

/** Server-owned authority for an SSH target helper. The helper receives no
 * local control socket or local terminal token: it gets one expiring bridge
 * secret whose signed frames remain bound to one immutable session/project/
 * environment tuple. */
export class RemoteMcpBridgeAuthority {
	private readonly entries = new Map<string, Entry>();
	private readonly now: () => number;
	private readonly ttlMs: number;
	private readonly maxDeadlineMs: number;
	private readonly maxFrameBytes: number;
	private readonly maxResponseBytes: number;
	private readonly maxInFlight: number;
	private readonly serverInstanceId: string;

	constructor(private readonly options: RemoteMcpBridgeOptions) {
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? 5 * 60_000;
		this.maxDeadlineMs = options.maxDeadlineMs ?? 30_000;
		this.maxFrameBytes = options.maxFrameBytes ?? REMOTE_MCP_MAX_FRAME_BYTES;
		this.maxResponseBytes = options.maxResponseBytes ?? REMOTE_MCP_MAX_RESPONSE_BYTES;
		this.maxInFlight = options.maxInFlight ?? 8;
		this.serverInstanceId = options.serverInstanceId ?? randomUUID();
		for (const value of [this.ttlMs, this.maxDeadlineMs, this.maxFrameBytes, this.maxResponseBytes, this.maxInFlight]) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('remote MCP bridge limits must be positive integers');
	}

	open(scope: RemoteMcpBridgeScope): RemoteMcpBridgeCapability {
		assertScope(scope);
		this.revokeSession(scope.terminalSessionId);
		const bridgeId = randomUUID();
		const bootstrapSecret = randomBytes(32).toString('base64url');
		const issuedAt = this.now();
		const base = Buffer.from(bootstrapSecret, 'base64url');
		const entry: Entry = { ...scope, bridgeId, issuedAt, expiresAt: issuedAt + this.ttlMs, requestKey: derive(base, this.serverInstanceId, bridgeId, 'target-to-server'), responseKey: derive(base, this.serverInstanceId, bridgeId, 'server-to-target'), lastSequence: 0, inFlight: 0, revoked: false, controllers: new Set() };
		this.entries.set(bridgeId, entry);
		return Object.freeze({ ...scope, bridgeId, serverInstanceId: this.serverInstanceId, bootstrapSecret, issuedAt, expiresAt: entry.expiresAt });
	}

	rotate(bridgeId: string): RemoteMcpBridgeCapability {
		const entry = this.entry(bridgeId);
		const scope: RemoteMcpBridgeScope = { terminalSessionId: entry.terminalSessionId, projectId: entry.projectId, projectEnvironmentId: entry.projectEnvironmentId, environmentRevision: entry.environmentRevision, scope: entry.scope };
		this.revoke(bridgeId);
		return this.open(scope);
	}

	async exchange(frame: RemoteMcpRequestFrame, expected: RemoteMcpBridgeScope): Promise<RemoteMcpResponseFrame> {
		const entry = this.entry(frame.bridgeId);
		assertExpected(entry, expected);
		validateRequest(frame, this.maxFrameBytes);
		const now = this.now();
		if (entry.expiresAt <= now) { this.revoke(entry.bridgeId); throw new RemoteMcpBridgeError('expired', 'Remote MCP capability expired.'); }
		if (frame.deadline <= now || frame.deadline > now + this.maxDeadlineMs) throw new RemoteMcpBridgeError('deadline', 'Remote MCP request deadline is invalid.');
		if (frame.sequence <= entry.lastSequence) throw new RemoteMcpBridgeError('replay', 'Remote MCP request was replayed.');
		if (!verify(entry.requestKey, requestUnsigned(frame), frame.mac)) throw new RemoteMcpBridgeError('invalid-capability', 'Remote MCP request authentication failed.');
		// Sequence advances only after authentication, and before dispatch, so a
		// timed-out or failed mutation cannot be replayed.
		entry.lastSequence = frame.sequence;
		if (entry.inFlight >= this.maxInFlight) throw new RemoteMcpBridgeError('limit-exceeded', 'Too many remote MCP requests are in flight.');
		entry.inFlight += 1;
		const controller = new AbortController(); entry.controllers.add(controller);
		const timer = setTimeout(() => controller.abort('deadline'), Math.max(1, frame.deadline - now));
		try {
			const operation = this.options.dispatch(Object.freeze(expected), frame.op, frame.params, { signal: controller.signal });
			const payload = await Promise.race([operation, new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(new RemoteMcpBridgeError(entry.revoked ? 'revoked' : 'deadline', entry.revoked ? 'Remote MCP capability was revoked.' : 'Remote MCP request exceeded its deadline.')), { once: true }))]);
			if (entry.revoked || this.entries.get(entry.bridgeId) !== entry) throw new RemoteMcpBridgeError('revoked', 'Remote MCP capability was revoked.');
			return this.response(entry, frame, true, payload);
		} catch (error) {
			if (error instanceof RemoteMcpBridgeError) throw error;
			if (entry.revoked || this.entries.get(entry.bridgeId) !== entry) throw new RemoteMcpBridgeError('revoked', 'Remote MCP capability was revoked.');
			return this.response(entry, frame, false, boundedError(error));
		} finally { clearTimeout(timer); entry.controllers.delete(controller); entry.inFlight -= 1; }
	}

	revoke(bridgeId: string): boolean {
		const entry = this.entries.get(bridgeId); if (!entry) return false;
		entry.revoked = true; this.entries.delete(bridgeId);
		for (const controller of entry.controllers) controller.abort('revoked');
		return true;
	}
	revokeSession(sessionId: ProtocolId): number { return this.revokeWhere((entry) => entry.terminalSessionId === sessionId); }
	revokeProject(projectId: ProtocolId): number { return this.revokeWhere((entry) => entry.projectId === projectId); }
	revokeEnvironment(environmentId: string): number { return this.revokeWhere((entry) => entry.projectEnvironmentId === environmentId); }
	onReconnect(sessionId: ProtocolId): number { return this.revokeSession(sessionId); }
	onSessionExit(sessionId: ProtocolId): number { return this.revokeSession(sessionId); }
	shutdown(): void { for (const bridgeId of [...this.entries.keys()]) this.revoke(bridgeId); }

	private response(entry: Entry, request: RemoteMcpRequestFrame, ok: boolean, payload: JsonValue): RemoteMcpResponseFrame {
		const unsigned = { version: REMOTE_MCP_BRIDGE_VERSION, bridgeId: entry.bridgeId, sequence: request.sequence, requestId: request.requestId, ok, payload } as const;
		if (size(unsigned) > this.maxResponseBytes) throw new RemoteMcpBridgeError('limit-exceeded', 'Remote MCP response exceeds its bounded frame limit.');
		return Object.freeze({ ...unsigned, mac: sign(entry.responseKey, unsigned) });
	}
	private entry(bridgeId: string): Entry { const entry = this.entries.get(bridgeId); if (!entry || entry.revoked) throw new RemoteMcpBridgeError('revoked', 'Remote MCP capability is unavailable.'); return entry; }
	private revokeWhere(predicate: (entry: Entry) => boolean): number { let count = 0; for (const entry of [...this.entries.values()]) if (predicate(entry) && this.revoke(entry.bridgeId)) count += 1; return count; }
}

/** Target-helper utility. It signs only target-to-server frames and verifies
 * the distinct server-to-target key, providing direction-specific mutual auth. */
export class RemoteMcpTargetAuthenticator {
	private sequence = 0;
	private readonly requestKey: Buffer;
	private readonly responseKey: Buffer;
	constructor(private readonly capability: RemoteMcpBridgeCapability) {
		const base = Buffer.from(capability.bootstrapSecret, 'base64url');
		this.requestKey = derive(base, capability.serverInstanceId, capability.bridgeId, 'target-to-server');
		this.responseKey = derive(base, capability.serverInstanceId, capability.bridgeId, 'server-to-target');
	}
	request(input: { requestId: string; op: string; params: JsonValue; deadline: number }): RemoteMcpRequestFrame {
		const unsigned = { version: REMOTE_MCP_BRIDGE_VERSION, bridgeId: this.capability.bridgeId, sequence: ++this.sequence, deadline: input.deadline, requestId: input.requestId, op: input.op, params: input.params } as const;
		validateRequest({ ...unsigned, mac: 'x' }, REMOTE_MCP_MAX_FRAME_BYTES);
		return Object.freeze({ ...unsigned, mac: sign(this.requestKey, unsigned) });
	}
	verify(frame: RemoteMcpResponseFrame): void {
		if (frame.bridgeId !== this.capability.bridgeId || frame.version !== REMOTE_MCP_BRIDGE_VERSION || frame.sequence <= 0 || !verify(this.responseKey, responseUnsigned(frame), frame.mac)) throw new RemoteMcpBridgeError('invalid-capability', 'Remote MCP server response authentication failed.');
	}
}

function derive(secret: Buffer, serverInstanceId: string, bridgeId: string, direction: string): Buffer { return createHmac('sha256', secret).update(`terminay-remote-mcp\0${serverInstanceId}\0${bridgeId}\0${direction}`).digest(); }
function canonical(value: unknown): string { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`; }
function sign(key: Buffer, value: unknown): string { return createHmac('sha256', key).update(canonical(value)).digest('base64url'); }
function verify(key: Buffer, value: unknown, mac: string): boolean { let actual: Buffer; try { actual = Buffer.from(mac, 'base64url'); } catch { return false; } const expected = createHmac('sha256', key).update(canonical(value)).digest(); return actual.length === expected.length && timingSafeEqual(actual, expected); }
function requestUnsigned(frame: RemoteMcpRequestFrame): Omit<RemoteMcpRequestFrame, 'mac'> { const { mac: _mac, ...unsigned } = frame; return unsigned; }
function responseUnsigned(frame: RemoteMcpResponseFrame): Omit<RemoteMcpResponseFrame, 'mac'> { const { mac: _mac, ...unsigned } = frame; return unsigned; }
function size(value: unknown): number { return Buffer.byteLength(canonical(value)); }
function validateRequest(frame: RemoteMcpRequestFrame, maxBytes: number): void { if (frame.version !== REMOTE_MCP_BRIDGE_VERSION || !ID.test(frame.bridgeId) || !ID.test(frame.requestId) || !OP.test(frame.op) || !Number.isSafeInteger(frame.sequence) || frame.sequence <= 0 || !Number.isSafeInteger(frame.deadline) || size(frame) > maxBytes) throw new RemoteMcpBridgeError('bad-frame', 'Remote MCP request frame is invalid.'); }
function assertScope(scope: RemoteMcpBridgeScope): void { if (![scope.terminalSessionId, scope.projectId, scope.projectEnvironmentId].every((value) => ID.test(value)) || !Number.isSafeInteger(scope.environmentRevision) || scope.environmentRevision <= 0 || !['read', 'write'].includes(scope.scope)) throw new TypeError('Remote MCP scope is invalid.'); }
function assertExpected(entry: Entry, expected: RemoteMcpBridgeScope): void { if (entry.terminalSessionId !== expected.terminalSessionId || entry.projectId !== expected.projectId || entry.projectEnvironmentId !== expected.projectEnvironmentId || entry.environmentRevision !== expected.environmentRevision || entry.scope !== expected.scope) throw new RemoteMcpBridgeError('scope-mismatch', 'Remote MCP environment binding changed.'); }
function boundedError(error: unknown): JsonValue { const message = error instanceof Error ? error.message : 'Remote MCP operation failed.'; return { code: 'operation_failed', message: message.slice(0, 512) }; }
export function remoteMcpCapabilityFingerprint(capability: RemoteMcpBridgeCapability): string { return createHash('sha256').update(capability.bootstrapSecret).digest('hex'); }
