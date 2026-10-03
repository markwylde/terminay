import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Candidates a client derives from the host it reached direct signaling
 * through.
 *
 * A client that signalled through `https://<host>:<port>` has shown that
 * `<host>` reaches the server's machine. A server behind a port forward, or in
 * a container, often cannot observe that address about itself, so its own
 * candidates name addresses the client cannot route to — while the ports in
 * them are the ones the operator published. Pairing each offered UDP host port
 * with the signaling host gives the client a destination it can reach, with no
 * address configured on the server.
 *
 * This is a routing hint and nothing else. It is computed on the client from a
 * description the server has already signed and the client has already
 * verified; it changes neither. A wrong guess costs connectivity checks that
 * get no answer.
 */

export type ResolveHost = (host: string) => Promise<readonly string[]>;

const resolveWithSystem: ResolveHost = async (host) =>
	(await lookup(host, { all: true })).map((entry) => entry.address);

/**
 * The literal addresses a direct origin's host stands for, as this machine
 * resolves them. Loopback is excluded: a loopback direct origin carries
 * signaling to a published listener and says nothing about where media goes.
 */
export async function directOriginAddresses(
	directOrigin: string,
	resolveHost: ResolveHost = resolveWithSystem,
): Promise<readonly string[]> {
	let hostname: string;
	try {
		hostname = new URL(directOrigin).hostname.toLowerCase();
	} catch {
		return [];
	}
	const host =
		hostname.startsWith('[') && hostname.endsWith(']')
			? hostname.slice(1, -1)
			: hostname;
	if (host === 'localhost' || host.endsWith('.localhost')) return [];
	let addresses: readonly string[];
	if (isIP(host) !== 0) addresses = [host];
	else {
		try {
			addresses = await resolveHost(host);
		} catch {
			// A name that does not resolve here derives nothing; the server's own
			// candidates are still tried.
			return [];
		}
	}
	return Object.freeze([
		...new Set(
			addresses.filter(
				(address) => isIP(address) !== 0 && !isLoopbackAddress(address),
			),
		),
	]);
}

/**
 * Rewrite one offered candidate to each derived address, keeping its port.
 *
 * Only UDP host candidates are used: a reflexive or relayed candidate's port
 * belongs to some other machine's mapping, not to a port the operator
 * published on the signaling host. A candidate already at a derived address is
 * left alone, and `seen` keeps one derived candidate per address and port.
 */
export function deriveDirectOriginCandidates(
	candidate: string,
	addresses: readonly string[],
	seen: Set<string>,
): readonly string[] {
	const line = candidate.startsWith('a=') ? candidate.slice(2) : candidate;
	const fields = line.trim().split(/\s+/u);
	// candidate:<foundation> <component> <transport> <priority> <address> <port> typ <type>
	if (
		fields.length < 8 ||
		!fields[0]?.startsWith('candidate:') ||
		fields[2]?.toLowerCase() !== 'udp' ||
		fields[6] !== 'typ' ||
		fields[7] !== 'host'
	)
		return [];
	const offered = (fields[4] as string).toLowerCase();
	const port = fields[5] as string;
	if (!/^[0-9]{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535)
		return [];
	const derived: string[] = [];
	for (const address of addresses) {
		if (address.toLowerCase() === offered) continue;
		const key = `${address}|${port}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const foundation = `candidate:${seen.size}directorigin`;
		derived.push(
			[foundation, fields[1], fields[2], fields[3], address, port, 'typ', 'host']
				.join(' '),
		);
	}
	return Object.freeze(derived);
}

/** Every candidate line carried in a session description, with its media id. */
export function descriptionCandidates(
	sdp: string,
): readonly Readonly<{ candidate: string; sdpMid: string }>[] {
	const found: { candidate: string; sdpMid: string }[] = [];
	const pending: string[] = [];
	let sdpMid: string | undefined;
	const flush = () => {
		for (const candidate of pending.splice(0))
			found.push({ candidate, sdpMid: sdpMid ?? '0' });
	};
	for (const line of sdp.split(/\r?\n/u)) {
		if (line.startsWith('m=')) {
			flush();
			sdpMid = undefined;
		} else if (line.startsWith('a=mid:')) sdpMid = line.slice('a=mid:'.length);
		else if (line.startsWith('a=candidate:')) pending.push(line.slice(2));
	}
	flush();
	return Object.freeze(found);
}

function isLoopbackAddress(address: string): boolean {
	return address.startsWith('127.') || address === '::1';
}
