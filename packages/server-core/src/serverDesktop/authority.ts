import { protocolError } from '@terminay/protocol';
import type { AuthenticatedClient, RequestContext } from '../types.js';

/**
 * Who may use the server desktop.
 *
 * Pairing is the trust point: a connection that is in Terminay with write
 * authority can already run programs as the server account, so the desktop
 * gives it nothing it lacks. A connection narrowed to a project, a terminal
 * session, a capability, a chat, or an MCP principal is deliberately less than
 * that, and is refused. The refusal says nothing about the desktop's state.
 */
const NARROWING_CLAIMS = [
	'sessionId',
	'projectId',
	'capability',
	'capabilityId',
	'mcpPrincipal',
	'chatId',
	'botExecutionId',
	'mcp',
] as const;

type Authority =
	| Pick<RequestContext, 'clientId' | 'authScope' | 'claims'>
	| AuthenticatedClient;

export function hasServerDesktopAuthority(
	context: Authority | undefined,
): boolean {
	if (context === undefined) return false;
	const claims = context.claims;
	if (context.clientId === 'system:mcp') return false;
	if (context.authScope !== 'write' && context.authScope !== 'admin')
		return false;
	if (claims !== undefined && claims !== null) {
		// Claims of a shape this check cannot read are not trusted to be empty.
		if (typeof claims !== 'object' || Array.isArray(claims)) return false;
		if (NARROWING_CLAIMS.some((key) => claims[key] !== undefined)) return false;
	}
	return true;
}

/** Refuse a connection without desktop authority, as forbidden and no more. */
export function assertServerDesktopAuthority(
	context: Authority & { readonly signal?: AbortSignal },
): void {
	if (!hasServerDesktopAuthority(context))
		throw protocolError(
			'forbidden',
			'the server desktop needs an unrestricted connection to this server',
		);
	context.signal?.throwIfAborted();
}

/** What a desktop stream checks on every read and write. */
export interface ServerDesktopStreamAuthority {
	readonly connectionId: string;
	readonly clientId: string;
	readonly deviceId?: string;
	/** Aborted when the connection ends or its device is revoked. */
	readonly signal: AbortSignal;
	/** Throws unless the connection still holds desktop authority. */
	readonly assert: () => void;
}

/**
 * The lifetime of each connection that uses the desktop. A stream is bound to
 * the connection, not to the request that opened it: the host reports a
 * disconnect or a revoked device with `revoke`, which ends every stream the
 * connection holds.
 */
export class ServerDesktopConnections {
	private readonly lifetimes = new Map<string, AbortController>();

	authority(context: RequestContext): ServerDesktopStreamAuthority {
		assertServerDesktopAuthority(context);
		let lifetime = this.lifetimes.get(context.connectionId);
		if (lifetime === undefined) {
			lifetime = new AbortController();
			this.lifetimes.set(context.connectionId, lifetime);
		}
		const signal = lifetime.signal;
		return {
			connectionId: context.connectionId,
			clientId: context.clientId,
			...(context.deviceId === undefined ? {} : { deviceId: context.deviceId }),
			signal,
			assert: () => {
				signal.throwIfAborted();
				assertServerDesktopAuthority(context);
			},
		};
	}

	/** The connection ended or lost its authority. */
	revoke(connectionId: string): void {
		const lifetime = this.lifetimes.get(connectionId);
		if (lifetime === undefined) return;
		this.lifetimes.delete(connectionId);
		lifetime.abort(
			protocolError('forbidden', 'the desktop connection has ended'),
		);
	}

	close(): void {
		for (const id of [...this.lifetimes.keys()]) this.revoke(id);
	}
}
