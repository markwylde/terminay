#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';

/**
 * Prove a published UDP port round-trips through the container runtime.
 *
 * `--advertise-address` rests entirely on this: a client sends connectivity
 * checks to a host-side address and port, the runtime forwards them into the
 * container, and the container's replies find their way back. On macOS and
 * Windows that path runs through a virtual machine and a userspace proxy, so it
 * is an assumption about someone else's software rather than about ours.
 *
 * If a runtime ever stops honouring it, the flag silently stops working and the
 * failure looks exactly like the ICE failure it was added to fix. This makes
 * that fail loudly instead.
 */

export const DEFAULT_IMAGE = 'node:24-bookworm';
export const SMOKE_ENVIRONMENT_FLAG = 'TERMINAY_RUN_DAEMON_SMOKE';

export function isEnabled(env = process.env) {
	return env[SMOKE_ENVIRONMENT_FLAG] === '1';
}

/** The echo server the container runs on the published port. */
export const ECHO_SERVER = `
const dgram = require("node:dgram");
const socket = dgram.createSocket("udp4");
socket.on("message", (message, remote) => {
  socket.send(Buffer.concat([Buffer.from("pong:"), message]), remote.port, remote.address);
});
socket.bind(Number(process.argv[1]), "0.0.0.0");
`;

function probe(port, timeoutMs = 8_000) {
	return new Promise((resolve) => {
		const socket = createSocket('udp4');
		const nonce = randomUUID();
		const timer = setTimeout(() => {
			socket.close();
			resolve({ ok: false, reason: 'no reply within the timeout' });
		}, timeoutMs);
		socket.on('message', (message) => {
			clearTimeout(timer);
			socket.close();
			const reply = message.toString();
			resolve(
				reply === `pong:${nonce}`
					? { ok: true }
					: { ok: false, reason: `unexpected reply ${JSON.stringify(reply)}` },
			);
		});
		socket.on('error', (error) => {
			clearTimeout(timer);
			resolve({ ok: false, reason: error.message });
		});
		socket.send(Buffer.from(nonce), port, '127.0.0.1');
	});
}

export async function provePublishedUdpPort(options = {}) {
	const image = options.image ?? DEFAULT_IMAGE;
	const port = options.port ?? 51_000;
	const container = `terminay-udp-probe-${randomUUID().slice(0, 8)}`;

	const started = spawnSync(
		'docker',
		[
			'run',
			'--detach',
			'--name',
			container,
			'-p',
			`${port}:${port}/udp`,
			image,
			'node',
			'-e',
			ECHO_SERVER,
			String(port),
		],
		{ encoding: 'utf8' },
	);
	if (started.status !== 0) {
		throw new Error(
			`could not start the probe container: ${started.stderr || started.stdout}`,
		);
	}

	try {
		// The container needs a moment to bind before the first datagram, and UDP
		// gives no signal that it has, so an early probe is retried rather than
		// read as a failure of the forward.
		let outcome = { ok: false, reason: 'not attempted' };
		for (let attempt = 0; attempt < 5 && !outcome.ok; attempt += 1) {
			outcome = await probe(port, 4_000);
		}
		if (!outcome.ok) {
			throw new Error(
				`a published UDP port did not round-trip (${outcome.reason}). \`--advertise-address\` depends on this, so it would not work on this runtime.`,
			);
		}
		return { port, image };
	} finally {
		spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
	}
}

if (process.argv[1] && process.argv[1].endsWith('published-udp-port.mjs')) {
	if (!isEnabled()) {
		console.log(
			`Set ${SMOKE_ENVIRONMENT_FLAG}=1 to probe a published UDP port.`,
		);
		process.exit(0);
	}
	const result = await provePublishedUdpPort();
	console.log(
		`A published UDP port round-trips on ${result.image} (port ${result.port}).`,
	);
}
