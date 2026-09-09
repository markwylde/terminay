import { createSocket } from 'node:dgram';

import type { AdvertisedIceAddress } from './hostedPeerLifecycle.js';

/**
 * Prove the advertised UDP port can be bound before the server starts.
 *
 * An advertised address exists because the addresses a server can observe about
 * itself are not the ones clients reach it on. If its port is already taken,
 * ICE binds elsewhere and every offer carries a candidate pointing at a port
 * nothing is listening on — the same silent `checking` failure the option was
 * added to remove, only now with an option set that looks like it should have
 * worked. Failing here puts that in front of the operator instead.
 *
 * The check binds and releases. It is a probe, not a reservation: something
 * else could take the port in between. That race is worth accepting for a
 * check that catches the case that actually happens, which is a port already
 * held by another server or a stale process.
 */
export function assertAdvertisedPortIsBindable(
	advertise: AdvertisedIceAddress,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const socket = createSocket(advertise.host.includes(':') ? 'udp6' : 'udp4');
		const fail = (cause: string) => {
			try {
				socket.close();
			} catch {
				// Already closed by the error that brought us here.
			}
			reject(
				new Error(
					`advertised ICE port ${advertise.port} cannot be bound (${cause}). It is the port clients reach this server on, so the server will not start without it.`,
				),
			);
		};
		socket.once('error', (error: NodeJS.ErrnoException) =>
			fail(error.code ?? error.message),
		);
		socket.bind(advertise.port, () => {
			socket.close(() => resolve());
		});
	});
}
