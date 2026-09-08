import { createSocket } from 'node:dgram';

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

const openProbeSocket: ProbeSocketFactory = () => createSocket('udp4') as unknown as ProbeSocket;

export function primaryAddress(createProbeSocket: ProbeSocketFactory = openProbeSocket): Promise<string | undefined> {
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
