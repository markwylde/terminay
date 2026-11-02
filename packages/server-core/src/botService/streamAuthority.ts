import type { RequestContext } from '../types.js';

/** Use the transport's connection lifetime signal, not an individual request's
 * completion signal. The host aborts this on disconnect or authority revocation. */
export interface BotStreamAuthority
	extends Pick<
		RequestContext,
		| 'connectionId'
		| 'clientId'
		| 'authScope'
		| 'claims'
		| 'permissions'
		| 'signal'
	> {
	/** Revalidate live terminal-create grants before each read/write callback. */
	readonly assertCurrent: () => void;
}
export function assertBotStreamAuthority(authority: BotStreamAuthority): void {
	authority.signal.throwIfAborted();
	const claims = authority.claims;
	if (
		authority.clientId === 'system:mcp' ||
		!['write', 'admin'].includes(authority.authScope) ||
		(claims &&
			typeof claims === 'object' &&
			!Array.isArray(claims) &&
			[
				'sessionId',
				'projectId',
				'capability',
				'capabilityId',
				'mcpPrincipal',
				'chatId',
				'mcp',
			].some((key) => claims[key] !== undefined))
	)
		throw Object.assign(new Error('bots require terminal-create authority'), {
			code: 'forbidden',
		});
	authority.assertCurrent();
}
