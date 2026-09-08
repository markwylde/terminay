#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Connect to a containerised peer over an advertised ICE address.
 *
 * This is the claim `--advertise-address` exists to make, end to end: a client
 * on the host reaches a peer inside a container it has no route to, because the
 * peer advertised a published port instead of the addresses it can see about
 * itself.
 *
 * Everything else about the option is unit-tested. This is the part that can
 * only be proven by two real WebRTC stacks completing a connection across the
 * boundary, so it runs a real peer on each side and exchanges SDP through a
 * shared directory rather than a signalling service — the transport is what is
 * under test, not the signalling.
 *
 * Opt-in (`TERMINAY_RUN_DAEMON_SMOKE=1`): it needs the container runtime and
 * about a minute.
 */

export const DEFAULT_IMAGE = 'node:24-bookworm';
export const SMOKE_ENVIRONMENT_FLAG = 'TERMINAY_RUN_DAEMON_SMOKE';
export const ADVERTISED_PORT = 51_000;
export const ADVERTISED_SPAN = 4;

export function isEnabled(env = process.env) {
	return env[SMOKE_ENVIRONMENT_FLAG] === '1';
}

const repositoryRoot = resolve(new URL('..', import.meta.url).pathname);

/** The peer inside the container: advertises the published address and offers. */
export const CONTAINER_PEER = `
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const { RTCPeerConnection } = await import('/wt/build/webrtc-runtime/artifact/lib/index.mjs');
const host = process.argv[2];
const port = Number(process.argv[3]);
const span = Number(process.argv[4]);

const peer = new RTCPeerConnection({
  iceServers: [],
  maxMessageSize: 1024 * 1024,
  iceUseIpv4: true,
  iceUseIpv6: false,
  iceAdditionalHostAddresses: [host],
  icePortRange: [port, port + span - 1],
});

const channel = peer.createDataChannel('api');
channel.addEventListener('open', () => channel.send('from-container'));
channel.addEventListener('message', (event) => {
  writeFileSync('/shared/container-received.txt', String(event.data));
});

const offer = await peer.createOffer();
await peer.setLocalDescription(offer);
await new Promise((settle) => setTimeout(settle, 2500));
writeFileSync('/shared/offer.tmp', peer.localDescription.sdp);
renameSync('/shared/offer.tmp', '/shared/offer.sdp');
console.log(peer.localDescription.sdp.split(/\\r?\\n/).filter((l) => l.startsWith('a=candidate:')).join('\\n'));

for (let i = 0; i < 120; i += 1) {
  if (existsSync('/shared/answer.sdp')) {
    await peer.setRemoteDescription({ type: 'answer', sdp: readFileSync('/shared/answer.sdp', 'utf8') });
    break;
  }
  await new Promise((settle) => setTimeout(settle, 500));
}

for (let i = 0; i < 60; i += 1) {
  if (peer.connectionState === 'connected') {
    writeFileSync('/shared/container-state.txt', 'connected');
    await new Promise((settle) => setTimeout(settle, 2000));
    process.exit(0);
  }
  await new Promise((settle) => setTimeout(settle, 500));
}
writeFileSync('/shared/container-state.txt', 'failed:' + peer.connectionState);
process.exit(1);
`;

async function answerFrom(shared) {
	const { RTCPeerConnection } = await import(
		`${repositoryRoot}/build/webrtc-runtime/artifact/lib/index.mjs`
	);
	for (
		let attempt = 0;
		attempt < 120 && !existsSync(join(shared, 'offer.sdp'));
		attempt += 1
	) {
		await new Promise((settle) => setTimeout(settle, 500));
	}
	if (!existsSync(join(shared, 'offer.sdp')))
		throw new Error('the container never produced an offer');
	const offer = readFileSync(join(shared, 'offer.sdp'), 'utf8');

	const peer = new RTCPeerConnection({
		iceServers: [],
		maxMessageSize: 1024 * 1024,
	});
	let received;
	peer.addEventListener('datachannel', (event) => {
		const channel = event.channel ?? event;
		channel.addEventListener('message', (message) => {
			received = String(message.data);
			channel.send('from-host');
		});
	});

	await peer.setRemoteDescription({ type: 'offer', sdp: offer });
	await peer.setLocalDescription(await peer.createAnswer());
	await new Promise((settle) => setTimeout(settle, 2500));
	writeFileSync(join(shared, 'answer.tmp'), peer.localDescription.sdp);
	renameSync(join(shared, 'answer.tmp'), join(shared, 'answer.sdp'));

	try {
		for (let attempt = 0; attempt < 60; attempt += 1) {
			if (peer.connectionState === 'connected' && received !== undefined) {
				return { connected: true, offer, received };
			}
			await new Promise((settle) => setTimeout(settle, 500));
		}
		return { connected: false, offer, state: peer.connectionState };
	} finally {
		peer.close();
	}
}

export async function proveAdvertisedReachability(options = {}) {
	const image = options.image ?? DEFAULT_IMAGE;
	const port = options.port ?? ADVERTISED_PORT;
	const span = options.span ?? ADVERTISED_SPAN;
	const container = `terminay-advertise-${randomUUID().slice(0, 8)}`;
	const shared = await mkdtemp(join(tmpdir(), 'terminay-advertise-'));

	mkdirSync(shared, { recursive: true });
	writeFileSync(join(shared, 'peer.mjs'), CONTAINER_PEER);

	const started = spawnSync(
		'docker',
		[
			'run',
			'--detach',
			'--name',
			container,
			'-p',
			`${port}-${port + span - 1}:${port}-${port + span - 1}/udp`,
			'-v',
			`${repositoryRoot}:/wt:ro`,
			'-v',
			`${shared}:/shared`,
			image,
			'node',
			'/shared/peer.mjs',
			'127.0.0.1',
			String(port),
			String(span),
		],
		{ encoding: 'utf8' },
	);
	if (started.status !== 0) {
		throw new Error(
			`could not start the peer container: ${started.stderr || started.stdout}`,
		);
	}

	try {
		const outcome = await answerFrom(shared);
		const candidates =
			spawnSync('docker', ['logs', container], { encoding: 'utf8' }).stdout ??
			'';
		if (!outcome.connected) {
			throw new Error(
				`the connection never completed (state ${outcome.state}). Candidates offered:\n${candidates}`,
			);
		}
		// The advertised candidate is the only one the host could have used: the
		// container's own address is not routable from here.
		if (!candidates.includes(` 127.0.0.1 ${port} typ host`)) {
			throw new Error(
				`the container did not offer the advertised candidate:\n${candidates}`,
			);
		}
		return { candidates, received: outcome.received };
	} finally {
		spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
		rmSync(shared, { recursive: true, force: true });
	}
}

if (
	process.argv[1] &&
	process.argv[1].endsWith('advertised-ice-reachability.mjs')
) {
	if (!isEnabled()) {
		console.log(
			`Set ${SMOKE_ENVIRONMENT_FLAG}=1 to prove advertised-address reachability.`,
		);
		process.exit(0);
	}
	const result = await proveAdvertisedReachability();
	console.log(
		'Connected to a containerised peer over the advertised candidate.',
	);
	console.log(result.candidates.trim());
}
