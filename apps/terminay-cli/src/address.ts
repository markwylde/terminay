import { createSocket } from 'node:dgram';
import { isIP } from 'node:net';

import { DEFAULT_ICE_PORT } from './advertise.js';
import { isLoopbackHost } from './args.js';

/**
 * Guessing the address devices will actually reach this machine on.
 *
 * A UDP socket "connected" to a public address picks the source address the
 * routing table would use, without sending a packet. That is right for a box
 * with a routable address and wrong for one behind NAT, which is why the
 * derived origin is printed at install and `--direct-origin` is documented
 * next to it.
 */

const PROBE_ADDRESS = '203.0.113.1';
const PROBE_PORT = 33_333;

/** Narrowed to what the probe uses, so a test can supply its own. */
export interface ProbeSocket {
	on(event: 'error', handler: (error: Error) => void): unknown;
	connect(port: number, address: string, callback: () => void): unknown;
	address(): { address: string };
	close(): unknown;
}

export type ProbeSocketFactory = () => ProbeSocket;

const openProbeSocket: ProbeSocketFactory = () =>
	createSocket('udp4') as unknown as ProbeSocket;

export function primaryAddress(
	createProbeSocket: ProbeSocketFactory = openProbeSocket,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		let socket: ProbeSocket;
		try {
			socket = createProbeSocket();
		} catch {
			resolve(undefined);
			return;
		}
		const finish = (value: string | undefined) => {
			try {
				socket.close();
			} catch {
				// Already closed.
			}
			resolve(value);
		};
		socket.on('error', () => finish(undefined));
		try {
			socket.connect(PROBE_PORT, PROBE_ADDRESS, () => {
				try {
					finish(socket.address().address);
				} catch {
					finish(undefined);
				}
			});
		} catch {
			finish(undefined);
		}
	});
}

/** Bracket an IPv6 literal so the result is a usable origin. */
export function originFor(address: string, port: number): string {
	const host = address.includes(':') ? `[${address}]` : address;
	return `https://${host}:${port}`;
}

export async function defaultDirectOrigin(
	port: number,
	createProbeSocket: ProbeSocketFactory = openProbeSocket,
): Promise<string | undefined> {
	const address = await primaryAddress(createProbeSocket);
	return address === undefined ? undefined : originFor(address, port);
}

/** What one public host stands for once it is spelled out as two settings. */
export interface PublicHostDerivation {
	readonly directOrigin: string;
	/** Present only for a routable literal address. */
	readonly advertiseAddress?: string;
}

/**
 * Can this host be offered to a peer as an ICE candidate?
 *
 * A candidate is a literal address the other side sends connectivity checks
 * to: a name resolves on the peer's machine, and a loopback address names the
 * peer itself, so neither can stand in for one.
 */
export function isRoutableLiteral(host: string): boolean {
	return isIP(host) !== 0 && !isLoopbackHost(host);
}

/**
 * Spell one public host out as the direct origin and, when it is a routable
 * literal address, the advertised ICE address.
 */
export function derivePublicHost(
	host: string,
	port: number,
): PublicHostDerivation {
	const directOrigin = originFor(host, port);
	if (!isRoutableLiteral(host)) return Object.freeze({ directOrigin });
	const literal = host.includes(':') ? `[${host}]` : host;
	return Object.freeze({
		directOrigin,
		advertiseAddress: `${literal}:${DEFAULT_ICE_PORT}`,
	});
}

/** Said whenever a public host could only derive the direct origin. */
export const PUBLIC_HOST_NEEDS_LITERAL =
	'Browsers and phones need a routable literal address: a name or a loopback address reaches this server for signaling only, so pass --public-host with the address devices reach this machine on, such as 192.168.1.20.';
