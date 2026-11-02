import type { AuthenticatedClient, RequestContext } from '../types.js';
import { BotError } from './store.js';

export function assertBotAuthority(
	context:
		| Pick<RequestContext, 'clientId' | 'authScope' | 'claims' | 'signal'>
		| AuthenticatedClient,
): void {
	const claims = context.claims;
	if (
		context.clientId === 'system:mcp' ||
		!['write', 'admin'].includes(context.authScope) ||
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
		throw new BotError(
			'forbidden',
			'bots require terminal-create authority on this server',
		);
	if ('signal' in context) context.signal.throwIfAborted();
}
export function canReadBotEvents(
	client: AuthenticatedClient | undefined,
): boolean {
	if (!client) return false;
	try {
		assertBotAuthority(client);
		return true;
	} catch {
		return false;
	}
}
