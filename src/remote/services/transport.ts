import { getSessionTransportHost } from '../../web/sessionTransportHost';

export type RemoteApiTransport = { postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> };
export type RemoteTransportRuntime = { api: RemoteApiTransport; origin: string };

class HostedBootstrapApiTransport implements RemoteApiTransport {
	postJson<TResponse>(pathname: string, body: unknown): Promise<TResponse> {
		const host = getSessionTransportHost();
		if (host === undefined) throw new Error('Session bootstrap API is unavailable.');
		return host.postJson<TResponse>(pathname, body);
	}
}

export function createRemoteTransportRuntime(): RemoteTransportRuntime {
	const host = getSessionTransportHost();
	if (host === undefined) throw new Error('A secure Terminay session host is required.');
	return { api: new HostedBootstrapApiTransport(), origin: host.origin };
}
