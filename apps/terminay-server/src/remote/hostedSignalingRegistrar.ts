import {
	type DesktopSignalingBootstrap,
	parseDesktopSignalingBootstrap,
} from '@terminay/protocol';

export interface HostedSignalingRegistrationRequest {
	readonly serverId: string;
	readonly deviceId: string;
	readonly peerId: string;
	readonly sessionOrigin: string;
	/** Upper bound selected by the server-owned reconnect admission. */
	readonly expiresAt: number;
}

export interface HostedSignalingRegistrar {
	/**
	 * Register the matching host/session with the hosted relay and return its
	 * already-minted wire bootstrap. Implementations own credentials; Terminay
	 * never guesses or synthesizes a hosted token at this boundary.
	 */
	readonly register: (
		request: HostedSignalingRegistrationRequest,
		signal?: AbortSignal,
	) => unknown | Promise<unknown>;
}

export async function registerHostedDesktopSignaling(
	registrar: HostedSignalingRegistrar,
	request: HostedSignalingRegistrationRequest,
	options: Readonly<{ now?: () => number; signal?: AbortSignal }> = {},
): Promise<DesktopSignalingBootstrap> {
	if (!registrar || typeof registrar.register !== 'function')
		throw new TypeError('hosted signaling registrar is invalid');
	const now = options.now?.() ?? Date.now();
	if (!Number.isSafeInteger(now) || !Number.isSafeInteger(request.expiresAt))
		throw new TypeError('hosted signaling registration clock is invalid');
	if (request.expiresAt <= now || request.expiresAt > now + 10 * 60_000)
		throw new RangeError('hosted signaling registration expiry is invalid');
	if (options.signal?.aborted)
		throw (
			options.signal.reason ??
			new DOMException('The operation was aborted', 'AbortError')
		);

	const bootstrap = parseDesktopSignalingBootstrap(
		await registrar.register(Object.freeze({ ...request }), options.signal),
		request.sessionOrigin,
		now,
	);
	if (
		bootstrap.serverId !== request.serverId ||
		bootstrap.deviceId !== request.deviceId ||
		bootstrap.peerId !== request.peerId ||
		bootstrap.expiresAt > request.expiresAt
	)
		throw new Error('hosted signaling registration identity is invalid');
	if (options.signal?.aborted)
		throw (
			options.signal.reason ??
			new DOMException('The operation was aborted', 'AbortError')
		);
	return bootstrap;
}
