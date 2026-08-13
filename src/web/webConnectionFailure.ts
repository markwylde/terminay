import type { RendererConnectionFailure } from '../shared/rendererConnectionController';

export function classifyWebConnectionFailure(error: unknown): RendererConnectionFailure {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	if (message.includes('revoked') || message.includes('reconnect proof request is invalid'))
		return Object.freeze({ disposition: 'blocked', reason: 'revoked' });
	if (message.includes('expired') || message.includes('credentials were rejected'))
		return Object.freeze({ disposition: 'blocked', reason: 'expired' });
	if (message.includes('exposure') && (message.includes('stopped') || message.includes('unavailable')))
		return Object.freeze({ disposition: 'blocked', reason: 'exposure-stopped' });
	if (message.includes('host shutdown') || message.includes('server is shutting down'))
		return Object.freeze({ disposition: 'stopped', reason: 'host-shutdown' });
	if (message.includes('relay') || message.includes('turn'))
		return Object.freeze({ disposition: 'retryable', reason: 'relay' });
	if (message.includes('route') || message.includes('signaling'))
		return Object.freeze({ disposition: 'retryable', reason: 'route' });
	return Object.freeze({ disposition: 'retryable', reason: 'offline' });
}
