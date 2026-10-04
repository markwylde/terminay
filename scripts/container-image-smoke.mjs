#!/usr/bin/env node
// Smoke test of the official container image.
//
// It starts the built image and pairs Terminay Desktop's own pairing and
// reconnect code with it, approving the device through the `terminay` command
// the image carries. The device runs in a second container started from the
// same image, so the test controls which network it sits on:
//
//   bare         No configuration, no published port. The device shares the
//                server's network, so the server can route to it. Then the
//                container is replaced on the same volume and the device
//                reconnects without pairing again.
//   advertised   A public host and the pinned UDP range published. The device
//                sits on a network isolated from the server's and is told not
//                to derive a candidate, so only the advertised one can work.
//   derived      A pinned, published range and a direct origin on the host, but
//                no advertised address. The isolated device reaches the server
//                through the candidate it derives from the origin it signalled
//                through.
//   control      The derived case with derivation switched off. It must fail:
//                if it connects, the two networks are not isolated and the two
//                cases above prove nothing.
//
// The cases share nothing, so each runs in its own process and they all run at
// once; `--only` runs the named cases in this process, one after another.
//
// Usage: node scripts/container-image-smoke.mjs --image <ref> [--engine docker|podman] [--only <case,...>]
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const image = args.image;
if (!image) fail('usage: container-image-smoke.mjs --image <ref> [--engine docker|podman]');
const engine = args.engine ?? detectEngine();
const isPodman = /podman/iu.test(run([engine, '--version']).stdout);
const only = args.only?.split(',');
const run_id = randomBytes(4).toString('hex');
const name = (suffix) => `terminay-smoke-${run_id}-${suffix}`;
const HOLD_MS = 10_000;
// The width of the ICE range an isolated case publishes on the container host.
const ICE_SPAN = 16;
const CASES = ['bare', 'advertised', 'derived', 'control'];
const created = { containers: new Set(), networks: new Set(), volumes: new Set() };

if (!only) process.exit(await runCasesTogether());
for (const label of only) if (!CASES.includes(label)) fail(`unknown case: ${label}`);

const work = await mkdtemp(join(tmpdir(), 'terminay-image-smoke-'));
let failed = false;
try {
	await build({
		absWorkingDir: repositoryRoot,
		banner: {
			js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
		},
		bundle: true,
		entryPoints: ['scripts/support/container-image-smoke-client.mjs'],
		format: 'esm',
		logLevel: 'silent',
		outfile: join(work, 'client.mjs'),
		platform: 'node',
		target: 'node20',
	});

	const cases = { bare, advertised, derived, control };
	for (const label of only) {
		log(`--- ${label}`);
		await cases[label]();
		for (const container of created.containers)
			run([engine, 'rm', '--force', '--volumes', container], { allowFailure: true });
		created.containers.clear();
		log(`ok ${label}`);
	}
} catch (error) {
	failed = true;
	process.stderr.write(
		`container image smoke failed: ${error instanceof Error ? error.stack : String(error)}\n`,
	);
	for (const container of created.containers) {
		const logs = run([engine, 'logs', '--tail', '60', container], { allowFailure: true });
		process.stderr.write(`\n--- logs ${container}\n${logs.stdout}${logs.stderr}\n`);
	}
} finally {
	for (const container of created.containers)
		run([engine, 'rm', '--force', '--volumes', container], { allowFailure: true });
	for (const volume of created.volumes)
		run([engine, 'volume', 'rm', '--force', volume], { allowFailure: true });
	for (const network of created.networks)
		run([engine, 'network', 'rm', '--force', network], { allowFailure: true });
	await rm(work, { force: true, recursive: true });
}
process.exit(failed ? 1 : 0);

/**
 * Run every case at once, each in a process of its own, and print each one's
 * output whole when it ends so the cases do not interleave in the log.
 */
async function runCasesTogether() {
	const script = fileURLToPath(import.meta.url);
	const statuses = await Promise.all(
		CASES.map(
			(label) =>
				new Promise((resolve) => {
					const child = spawn(
						process.execPath,
						[script, ...process.argv.slice(2), '--only', label],
						{ stdio: ['ignore', 'pipe', 'pipe'] },
					);
					let output = '';
					child.stdout.on('data', (chunk) => {
						output += chunk;
					});
					child.stderr.on('data', (chunk) => {
						output += chunk;
					});
					child.on('close', (status) => {
						process.stdout.write(output);
						if (status !== 0) log(`failed ${label} (exit ${status})`);
						resolve(status);
					});
				}),
		),
	);
	return statuses.every((status) => status === 0) ? 0 : 1;
}

async function bare() {
	const network = createNetwork('bare');
	const volume = createVolume('bare');
	const alias = name('server');
	// Hardened flags: the image must not need a privilege, a capability, or a
	// writable root filesystem.
	const hardened = [
		'--cap-drop=ALL',
		'--security-opt', 'no-new-privileges',
		'--read-only',
		'--tmpfs', '/tmp:rw,nosuid,size=64m',
	];
	const start = (suffix) =>
		startServer(suffix, [
			'--network', network,
			'--network-alias', alias,
			'--hostname', name(suffix),
			'--volume', `${volume}:/var/lib/terminay`,
			...hardened,
			// A name only: it gives the direct origin a host the device can
			// resolve on this network and derives no advertised address.
			'--env', `TERMINAY_PUBLIC_HOST=${alias}`,
		]);

	const first = start('bare-1');
	await waitReady(first);
	const status = daemonStatus(first);
	assert(/no service unit/iu.test(status), `status does not say the server is unmanaged:\n${status}`);
	assert(/advertised\s+not set/iu.test(status), `a bare server reports an advertised address:\n${status}`);
	assert(new RegExp(args.revision ?? '.', 'u').test(status), `status does not name the build revision:\n${status}`);
	const refused = run([engine, 'exec', first, 'terminay', 'daemon', 'upgrade'], { allowFailure: true });
	assert(refused.status !== 0, '`daemon upgrade` did not refuse inside the image');
	assert(
		/container/iu.test(refused.stdout + refused.stderr),
		`\`daemon upgrade\` did not point at the container runtime:\n${refused.stdout}${refused.stderr}`,
	);

	const store = deviceStore('bare');
	const paired = await device({
		network,
		mode: 'pair',
		target: pairingUrl(first),
		store,
		server: first,
	});
	const identity = paired.serverId;
	assert(identity, 'the device did not learn a server identity');
	const pair = deviceCandidatePair(first);
	assert(
		pair?.localType === 'host' && pair?.remoteType === 'host',
		`with no advertised address the server should connect host-to-host, got ${JSON.stringify(pair)}`,
	);

	// Graceful stop, then a different container on the same volume.
	run([engine, 'stop', '--time', '20', first]);
	const exit = run([engine, 'inspect', '--format', '{{.State.ExitCode}}', first]).stdout.trim();
	assert(exit === '0', `the server exited ${exit} on SIGTERM`);
	run([engine, 'rm', '--force', first]);
	created.containers.delete(first);

	const second = start('bare-2');
	await waitReady(second);
	const reconnected = await device({
		network,
		mode: 'reconnect',
		target: paired.origin,
		store,
		server: second,
	});
	assert(
		reconnected.serverId === identity,
		`the server identity changed across container recreation: ${identity} -> ${reconnected.serverId}`,
	);
}

async function advertised() {
	const serverNetwork = createNetwork('adv-server');
	const deviceNetwork = createNetwork('adv-device');
	const host = hostAddressFrom(deviceNetwork);
	const { server, ports: { signaling, ice } } = startPublishedServer('advertised', (ports) => [
		'--network', serverNetwork,
		'--env', `TERMINAY_HTTP_PORT=${ports.signaling}`,
		'--env', `TERMINAY_ICE_PORT=${ports.ice}`,
		'--env', `TERMINAY_PUBLIC_HOST=${host}`,
	]);
	await waitReady(server);
	const status = daemonStatus(server);
	assert(
		status.includes(`${host}:${ice}`),
		`status does not report the advertised address ${host}:${ice}:\n${status}`,
	);
	const url = pairingUrl(server);
	assert(
		new URL(url).origin === `https://${host}:${signaling}`,
		`the direct link does not name the public host: ${new URL(url).origin}`,
	);
	await device({
		network: deviceNetwork,
		mode: 'pair',
		target: url,
		store: deviceStore('advertised'),
		server,
		// Only the advertised candidate may carry this connection.
		derive: 'no-derive',
	});
}

function derived() {
	return forwardedWithoutAdvertisedAddress('der', 'derive');
}

async function control() {
	let connected = true;
	try {
		await forwardedWithoutAdvertisedAddress('ctl', 'no-derive');
	} catch (error) {
		connected = false;
		assert(
			/the device \(pair\) exited/u.test(String(error)),
			`the control case failed for the wrong reason: ${error}`,
		);
	}
	assert(
		!connected,
		'a device on an isolated network connected with no advertised and no derived candidate, so the isolated cases are not isolating',
	);
}

async function forwardedWithoutAdvertisedAddress(prefix, derive) {
	const serverNetwork = createNetwork(`${prefix}-server`);
	const deviceNetwork = createNetwork(`${prefix}-device`);
	const host = hostAddressFrom(deviceNetwork);
	const { server } = startPublishedServer(prefix, (ports) => [
		'--network', serverNetwork,
		// The origin is on the host, the range is pinned and published, and no
		// address is advertised: the device has to derive the candidate.
		'--env', `TERMINAY_HTTP_PORT=${ports.signaling}`,
		'--env', `TERMINAY_DIRECT_ORIGIN=https://${host}:${ports.signaling}`,
		'--env', `TERMINAY_ICE_PORT=${ports.ice}`,
	]);
	await waitReady(server);
	const status = daemonStatus(server);
	assert(/advertised\s+not set/iu.test(status), `a server with no public host reports an advertised address:\n${status}`);
	await device({
		network: deviceNetwork,
		mode: 'pair',
		target: pairingUrl(server),
		store: deviceStore(prefix),
		server,
		derive,
	});
}

/**
 * Start a server that publishes a signaling port and a pinned ICE range on the
 * container host. The host is shared: the other cases publish there at the same
 * moment, and so may another run of this test or a real Terminay container. So
 * the ports are drawn at random, below the range the kernel hands out, and
 * drawn again when the engine reports them taken.
 */
function startPublishedServer(suffix, flagsFor) {
	for (let attempt = 1; ; attempt += 1) {
		const ports = {
			signaling: 20_000 + randomInt(10_000),
			ice: 10_000 + ICE_SPAN * randomInt(600),
		};
		try {
			const server = startServer(suffix, [
				'--publish', `${ports.signaling}:${ports.signaling}/tcp`,
				'--publish', `${ports.ice}-${ports.ice + ICE_SPAN - 1}:${ports.ice}-${ports.ice + ICE_SPAN - 1}/udp`,
				...flagsFor(ports),
			]);
			return { server, ports };
		} catch (error) {
			const taken = /port is already allocated|address already in use/iu.test(String(error));
			if (!taken || attempt === 5) throw error;
			// The engine leaves the container it could not start.
			run([engine, 'rm', '--force', name(suffix)], { allowFailure: true });
		}
	}
}

/** Run the device in a container and approve it when it shows a match code. */
async function device({ network, mode, target, store, server, derive = 'derive' }) {
	const container = name(`device-${randomBytes(3).toString('hex')}`);
	created.containers.add(container);
	// The bundle is copied in rather than bind-mounted: a CI job that talks to
	// its host's container engine cannot mount its own filesystem.
	run([
		engine, 'create', '--name', container,
		'--network', network,
		'--volume', `${store}:/store`,
		'--user', '0:0',
		'--entrypoint', '/opt/terminay/bin/node',
		image,
		'/client.mjs', mode, target, '/store',
		'/opt/terminay/webrtc-runtime', String(HOLD_MS), derive,
	]);
	run([engine, 'cp', join(work, 'client.mjs'), `${container}:/client.mjs`]);
	const child = spawn(engine, ['start', '--attach', container], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const result = { events: [] };
	let stderr = '';
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	const lines = createInterface({ input: child.stdout });
	lines.on('line', (line) => {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			return;
		}
		result.events.push(record);
		log(`  device ${JSON.stringify(record)}`);
		if (record.event === 'match-code') approve(server, record.matchCode);
		if (record.event === 'paired') {
			result.origin = record.origin;
			result.serverId = record.serverId;
		}
		if (record.event === 'connected') result.serverId = record.serverId;
	});
	const code = await new Promise((resolve) => {
		const timer = setTimeout(() => {
			child.kill('SIGKILL');
			resolve('timeout');
		}, 120_000);
		child.on('close', (status) => {
			clearTimeout(timer);
			resolve(status);
		});
	});
	run([engine, 'rm', '--force', container], { allowFailure: true });
	created.containers.delete(container);
	if (code !== 0) {
		throw new Error(
			`the device (${mode}) exited ${code}: ${JSON.stringify(result.events)}\n${stderr.slice(-2000)}`,
		);
	}
	for (const expected of ['connected', 'held']) {
		assert(
			result.events.some((record) => record.event === expected),
			`the device never reported "${expected}"`,
		);
	}
	assert(
		!result.events.some((record) => record.event === 'failure' || record.status === 'degraded'),
		`the connection did not stay up: ${JSON.stringify(result.events)}`,
	);
	return result;
}

/** Approve through the CLI the image carries, after comparing the code. */
function approve(server, matchCode) {
	const listed = run([engine, 'exec', server, 'terminay', 'daemon', 'approvals']).stdout;
	const line = listed.split('\n').find((entry) => entry.includes(`match code ${matchCode}`));
	assert(line, `the server does not list match code ${matchCode}:\n${listed}`);
	run([engine, 'exec', server, 'terminay', 'daemon', 'approve', line.trim().split(/\s+/u)[0]]);
}

function pairingUrl(server) {
	const output = run([
		engine, 'exec', server, 'terminay', 'daemon', 'qr-code', '--no-wait', '--mode', 'direct',
	]).stdout;
	const match = /^\s*direct\s+(https:\/\/\S+)/mu.exec(output);
	assert(match, `no direct pairing link in:\n${output}`);
	return match[1];
}

function daemonStatus(server) {
	return run([engine, 'exec', server, 'terminay', 'daemon', 'status']).stdout;
}

/** The selected candidate pair of the newest device session, from the log. */
function deviceCandidatePair(server) {
	const logs = run([engine, 'logs', server]);
	const pairs = `${logs.stdout}\n${logs.stderr}`
		.split('\n')
		.filter((line) => line.includes('"event":"candidate-pair"') && line.includes('"scope":"device"'))
		.map((line) => {
			try {
				return JSON.parse(line.slice(line.indexOf('{')));
			} catch {
				return undefined;
			}
		})
		.filter((record) => record?.pairState === 'succeeded');
	return pairs.at(-1);
}

function startServer(suffix, flags) {
	const container = name(suffix);
	created.containers.add(container);
	run([
		engine, 'run', '--detach', '--name', container,
		// Direct signaling only: a pull request must not depend on the hosted
		// relay being reachable. The image's own default is covered by its
		// packaging contract test.
		'--env', 'TERMINAY_EXPOSE=direct',
		...flags, image,
	]);
	return container;
}

async function waitReady(server) {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const state = run([engine, 'inspect', '--format', '{{.State.Status}}', server], { allowFailure: true }).stdout.trim();
		if (state === 'exited' || state === 'dead')
			throw new Error(`the server container ${server} exited before it was ready`);
		const probe = run(
			[
				engine, 'exec', server, '/opt/terminay/bin/node', '-e',
				"fetch('http://127.0.0.1:8444/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
			],
			{ allowFailure: true },
		);
		if (probe.status === 0) return;
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`the server container ${server} did not become ready`);
}

/** The address a container on `network` reaches the container host at. */
function hostAddressFrom(network) {
	const probe = run([
		engine, 'run', '--rm', '--network', network,
		...(isPodman ? [] : ['--add-host', 'host.docker.internal:host-gateway']),
		'--entrypoint', '/opt/terminay/bin/node', image, '-e',
		`require('node:dns').lookup('${isPodman ? 'host.containers.internal' : 'host.docker.internal'}', { family: 4 }, (error, address) => { if (error) { console.error(error.message); process.exit(1); } console.log(address); })`,
	]);
	const address = probe.stdout.trim();
	assert(/^\d+\.\d+\.\d+\.\d+$/u.test(address), `could not find the container host address: ${probe.stdout}${probe.stderr}`);
	return address;
}

function createNetwork(suffix) {
	const network = name(suffix);
	// Docker isolates user-defined networks from one another by default; Podman
	// has to be asked.
	run([engine, 'network', 'create', ...(isPodman ? ['--opt', 'isolate=true'] : []), network]);
	created.networks.add(network);
	return network;
}

function createVolume(suffix) {
	const volume = name(suffix);
	run([engine, 'volume', 'create', volume]);
	created.volumes.add(volume);
	return volume;
}

/** A volume holding one device's credentials between its pair and reconnect. */
function deviceStore(suffix) {
	return createVolume(`store-${suffix}`);
}

function run(command, { allowFailure = false } = {}) {
	const result = spawnSync(command[0], command.slice(1), {
		encoding: 'utf8',
		timeout: 180_000,
	});
	if (!allowFailure && (result.error || result.status !== 0)) {
		throw new Error(
			`${command.join(' ')} failed (${result.error?.message ?? result.status}):\n${result.stdout}${result.stderr}`,
		);
	}
	return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function detectEngine() {
	for (const candidate of ['docker', 'podman']) {
		if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
	}
	fail('neither docker nor podman is available');
}

function parseArgs(argv) {
	const parsed = {};
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		if (!key?.startsWith('--') || argv[index + 1] === undefined) fail(`unexpected argument: ${key}`);
		parsed[key.slice(2)] = argv[index + 1];
	}
	return parsed;
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function log(message) {
	process.stdout.write(`${message}\n`);
}

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(2);
}
