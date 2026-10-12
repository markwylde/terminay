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
//   upgrade      Not run unless named with `--only upgrade`, because it needs
//                the project's published releases: it upgrades the server in
//                place to the newest release on the image's channel, with a
//                read-only root filesystem, and then restarts and recreates
//                the container on the same volume. The container's main
//                process must be the same one throughout, and the upgraded
//                release must be the one running each time.
//   recreate     Not run unless named with `--only recreate`, because it needs
//                Docker itself, its socket, and a registry image from Docker
//                Hub: it serves the image from a registry of its own, mounts
//                the Docker socket into the server, and has the server replace
//                its own container, first on a newer image and then on one
//                whose health check always fails. The first must leave one
//                container of the same name, volume, port, and environment on
//                the newer image; the second must leave the container it
//                started with, running. `--socket <path>` names the socket.
//
// The cases share nothing, so each runs in its own process and they all run at
// once; `--only` runs the named cases in this process, one after another.
//
// Usage: node scripts/container-image-smoke.mjs --image <ref> [--engine docker|podman] [--only <case,...>] [--socket <path>]
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
// Named explicitly or not at all: they reach outside the machine.
const OPTIONAL_CASES = ['upgrade', 'recreate'];
const created = { containers: new Set(), networks: new Set(), volumes: new Set(), images: new Set() };

if (!only) process.exit(await runCasesTogether());
for (const label of only)
	if (![...CASES, ...OPTIONAL_CASES].includes(label)) fail(`unknown case: ${label}`);

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

	const cases = { bare, advertised, derived, control, upgrade, recreate };
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
	for (const tagged of created.images)
		run([engine, 'image', 'rm', '--force', tagged], { allowFailure: true });
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
	// The entrypoint stays the container's main process and runs the server as
	// its child, which is what lets the server be restarted onto a newer
	// release without the container stopping.
	const mainProcess = run([engine, 'exec', first, 'cat', '/proc/1/cmdline']).stdout;
	assert(
		/terminay-server-entrypoint/u.test(mainProcess),
		`the container's main process is not the entrypoint: ${mainProcess.replaceAll('\0', ' ')}`,
	);
	// The upgrader is the CLI inside the release, and it can describe this
	// container with a read-only root filesystem. Whether anything newer
	// exists depends on the network, so only the description is asserted.
	const described = upgradeCheck(first);
	assert(described.environment === 'container', `the check does not see a container: ${JSON.stringify(described)}`);
	assert(described.canUpgrade === true, `a supervised container cannot upgrade itself: ${JSON.stringify(described)}`);
	assert(described.trigger?.kind === 'spawn', `unexpected trigger: ${JSON.stringify(described.trigger)}`);
	assert(described.modes?.includes('in-place'), `in-place is not offered: ${JSON.stringify(described.modes)}`);
	// No Docker socket was mounted, so replacing the container is not on offer.
	assert(!described.modes?.includes('recreate'), `recreate is offered with no Docker socket: ${JSON.stringify(described.modes)}`);
	assert(
		!args.revision || described.installed?.revision === args.revision,
		`the check does not name the image's revision: ${JSON.stringify(described.installed)}`,
	);
	const refused = run([engine, 'exec', first, 'terminay', 'daemon', 'install'], { allowFailure: true });
	assert(refused.status !== 0, '`daemon install` did not refuse inside the image');
	assert(
		/container/iu.test(refused.stdout + refused.stderr),
		`\`daemon install\` did not point at the container runtime:\n${refused.stdout}${refused.stderr}`,
	);
	// The same flags are how an operator withholds root from the terminals.
	const denied = run([engine, 'exec', first, 'sudo', '--non-interactive', 'true'], { allowFailure: true });
	assert(denied.status !== 0, 'sudo reached root in a container run with no new privileges');

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

	// Graceful stop, then a different container on the same volume. The
	// entrypoint forwards the signal, so the stop is the server's own bounded
	// shutdown and never the runtime's kill at the end of the grace period.
	const stopStarted = Date.now();
	run([engine, 'stop', '--time', '20', first]);
	assert(Date.now() - stopStarted < 18_000, 'the container was killed rather than stopped');
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

/**
 * An in-place upgrade against the project's published releases.
 *
 * The shipped CLI trusts one release key and one release host, so this case
 * cannot be given a release of its own: it upgrades to whatever the image's
 * channel really has, and has nothing to do when that is what the image
 * already carries.
 */
async function upgrade() {
	const volume = createVolume('upgrade');
	// A read-only root filesystem: the data volume is the only thing written.
	const hardened = [
		'--cap-drop=ALL',
		'--security-opt', 'no-new-privileges',
		'--read-only',
		'--tmpfs', '/tmp:rw,nosuid,size=64m',
	];
	const start = (suffix) =>
		startServer(suffix, ['--volume', `${volume}:/var/lib/terminay`, ...hardened]);
	const mainProcess = (server) =>
		run([engine, 'inspect', '--format', '{{.State.Pid}} {{.State.StartedAt}}', server]).stdout.trim();
	const bystanderAlive = (server) =>
		run(
			[
				engine, 'exec', server, 'sh', '-c',
				'for p in /proc/[0-9]*; do read -r c < "$p/comm" 2>/dev/null && [ "$c" = sleep ] && exit 0; done; exit 1',
			],
			{ allowFailure: true },
		).status === 0;

	const first = start('upgrade-1');
	await waitReady(first);
	const before = upgradeCheck(first);
	assert(!before.checkError, `the release channel could not be read: ${before.checkError}`);
	assert(before.canUpgrade === true, `the container cannot upgrade itself: ${JSON.stringify(before)}`);
	if (before.available === null) {
		log('the image already carries the newest release on its channel; nothing to upgrade to');
		return;
	}

	// A process in the container that the upgrade has no business with. It
	// outlives the upgrade only if the container was never restarted.
	run([engine, 'exec', '--detach', first, 'sleep', '100000']);
	const mainBefore = mainProcess(first);
	const upgraded = run([engine, 'exec', first, 'terminay', 'daemon', 'upgrade']);
	assert(/Upgraded to /u.test(upgraded.stdout), `the upgrade did not report success:\n${upgraded.stdout}${upgraded.stderr}`);
	await waitReady(first);
	assert(mainProcess(first) === mainBefore, 'the container restarted during an in-place upgrade');
	assert(bystanderAlive(first), 'a process outside the server did not survive the upgrade');

	const after = upgradeCheck(first);
	const sameRelease = (report) =>
		report.installed.revision === after.installed.revision &&
		report.installed.version === after.installed.version;
	assert(
		after.installed.revision !== before.installed.revision ||
			after.installed.version !== before.installed.version,
		`the running release did not change: ${JSON.stringify(after.installed)}`,
	);
	assert(
		before.available.revision === undefined || after.installed.revision === before.available.revision,
		`the running release is not the one that was offered: ${JSON.stringify(after.installed)}`,
	);
	assert(after.lastResult?.outcome === 'succeeded', `no successful outcome was recorded: ${JSON.stringify(after.lastResult)}`);
	assert(after.available === null, `an upgrade is still offered after upgrading: ${JSON.stringify(after.available)}`);
	// The server itself answers from the upgraded release.
	assert(/ready\s+yes/iu.test(daemonStatus(first)), 'the upgraded server does not report ready');

	// The upgraded release is what a restarted container runs.
	run([engine, 'restart', '--time', '20', first]);
	await waitReady(first);
	assert(sameRelease(upgradeCheck(first)), 'a restart went back to the release the image carries');

	const stopStarted = Date.now();
	run([engine, 'stop', '--time', '20', first]);
	assert(Date.now() - stopStarted < 18_000, 'the container was killed rather than stopped');
	run([engine, 'rm', '--force', first]);
	created.containers.delete(first);

	// And what a new container from the same, older image runs on that volume.
	const second = start('upgrade-2');
	await waitReady(second);
	assert(sameRelease(upgradeCheck(second)), 'a container recreated from the same image did not run the upgraded release');
}

/**
 * Replacing the container through a mounted Docker socket.
 *
 * A recreate pulls, so the image has to come from a registry. This case runs
 * one of its own and pushes the image under test to it under a moving tag;
 * "a newer image" is then the same image with one more label pushed to that
 * tag, and "an image that does not come up" the same with a health check that
 * always fails. Nothing here depends on the project's published images.
 */
async function recreate() {
	assert(!isPodman, 'the recreate case drives the Docker Engine API through its socket and needs docker');
	const socket = args.socket ?? '/var/run/docker.sock';
	const volume = createVolume('recreate');
	const registry = name('registry');
	const registryPort = 20_000 + randomInt(10_000);
	const signaling = 20_000 + randomInt(10_000);
	created.containers.add(registry);
	run([engine, 'run', '--detach', '--name', registry, '--publish', `127.0.0.1:${registryPort}:5000`, 'registry:2']);
	// A registry on localhost is one the daemon pulls from without TLS.
	const reference = `localhost:${registryPort}/terminay-smoke:latest`;
	created.images.add(reference);
	const publish = async (source) => {
		run([engine, 'tag', source, reference]);
		// The registry is listening a moment after its container starts.
		for (let attempt = 1; ; attempt += 1) {
			const pushed = run([engine, 'push', reference], { allowFailure: true });
			if (pushed.status === 0) break;
			assert(attempt < 10, `could not push to the local registry:\n${pushed.stdout}${pushed.stderr}`);
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		return run([engine, 'image', 'inspect', '--format', '{{.Id}}', source]).stdout.trim();
	};
	const derive = (suffix, lines) => {
		const tagged = `${name(suffix)}:latest`;
		created.images.add(tagged);
		run([engine, 'build', '--tag', tagged, '-'], { input: [`FROM ${image}`, ...lines, ''].join('\n') });
		return tagged;
	};
	const inspect = (container) => {
		const result = run([engine, 'inspect', container], { allowFailure: true });
		return result.status === 0 ? JSON.parse(result.stdout)[0] : undefined;
	};

	await publish(image);
	// The account in the image is not root, so it is given the group that owns
	// the socket as a container sees it.
	const group = run([
		engine, 'run', '--rm', '--user', '0:0', '--volume', `${socket}:/var/run/docker.sock`,
		'--entrypoint', 'stat', image, '--format', '%g', '/var/run/docker.sock',
	]).stdout.trim();
	assert(/^\d+$/u.test(group), `could not read the group of the Docker socket: ${group}`);

	const server = name('recreate');
	const helper = `${server}-terminay-recreate`;
	const previous = `${server}-terminay-previous`;
	for (const container of [server, helper, previous]) created.containers.add(container);
	run([
		engine, 'run', '--detach', '--name', server,
		'--env', 'TERMINAY_EXPOSE=direct',
		'--env', 'TERMINAY_SMOKE_MARKER=kept',
		'--label', 'terminay.smoke=kept',
		'--volume', `${volume}:/var/lib/terminay`,
		'--volume', `${socket}:/var/run/docker.sock`,
		'--group-add', group,
		'--publish', `127.0.0.1:${signaling}:8443/tcp`,
		'--restart', 'unless-stopped',
		reference,
	]);
	await waitReady(server);
	run([engine, 'exec', server, 'sh', '-c', 'echo kept > /var/lib/terminay/smoke-marker']);
	const described = upgradeCheck(server);
	assert(
		described.modes?.join(',') === 'in-place,recreate',
		`recreate is not offered with a usable Docker socket: ${JSON.stringify(described)}`,
	);

	/** Wait for the helper to finish, however it ends. */
	const settled = async () => {
		const deadline = Date.now() + 240_000;
		while (inspect(helper) !== undefined) {
			assert(Date.now() < deadline, 'the recreate helper container did not finish');
			await new Promise((resolve) => setTimeout(resolve, 1_000));
		}
		assert(inspect(previous) === undefined, `the previous container was left behind as ${previous}`);
		const current = inspect(server);
		assert(current?.State?.Running === true, `no running container is named ${server}`);
		return current;
	};
	// The command is in the container it replaces, so it ends when that does.
	const replace = () => run([engine, 'exec', server, 'terminay', 'daemon', 'upgrade', '--recreate'], { allowFailure: true });

	// Onto a newer image.
	const first = inspect(server);
	const newer = await publish(derive('newer', ['LABEL terminay.smoke.generation="2"']));
	const moved = replace();
	const second = await settled();
	assert(second.Id !== first.Id, `the container was not replaced:\n${moved.stdout}${moved.stderr}`);
	assert(second.Image === newer, `the replacement runs ${second.Image}, not the newer image ${newer}`);
	assert(second.Config.Image === reference, `the replacement was created from ${second.Config.Image}`);
	assert(second.Config.Env.includes('TERMINAY_SMOKE_MARKER=kept'), 'an environment variable set on the container was not carried over');
	assert(second.Config.Labels['terminay.smoke'] === 'kept', 'a label set on the container was not carried over');
	assert(second.Config.Labels['terminay.smoke.generation'] === '2', 'the replacement does not carry the newer image\'s own label');
	assert(
		second.Mounts.some((mount) => mount.Destination === '/var/lib/terminay' && mount.Name === volume),
		`the replacement is not on the same data volume: ${JSON.stringify(second.Mounts)}`,
	);
	assert(
		second.HostConfig.PortBindings?.['8443/tcp']?.[0]?.HostPort === String(signaling),
		`the published port was not carried over: ${JSON.stringify(second.HostConfig.PortBindings)}`,
	);
	assert(second.HostConfig.RestartPolicy?.Name === 'unless-stopped', 'the restart policy was not carried over');
	await waitReady(server);
	const marker = run([engine, 'exec', server, 'cat', '/var/lib/terminay/smoke-marker']).stdout.trim();
	assert(marker === 'kept', 'the data volume was not the same one after the recreate');
	const after = upgradeCheck(server);
	assert(after.lastResult?.outcome === 'succeeded', `no successful outcome was recorded: ${JSON.stringify(after.lastResult)}`);
	assert(after.modes?.includes('recreate'), 'the replacement lost the Docker socket');

	// Onto an image that never reports healthy: the container it started with
	// must be the one left running.
	await publish(
		derive('unhealthy', [
			'LABEL terminay.smoke.generation="3"',
			'HEALTHCHECK --interval=2s --timeout=2s --start-period=0s --retries=1 CMD ["/bin/false"]',
		]),
	);
	replace();
	const third = await settled();
	assert(third.Id === second.Id, 'a replacement that was not healthy was kept');
	assert(third.Image === newer, 'the restored container is not on the image it was running');
	await waitReady(server);
	const failed = upgradeCheck(server);
	assert(failed.lastResult?.outcome === 'rolled-back', `the failure was not recorded: ${JSON.stringify(failed.lastResult)}`);
	assert(/health check failed/u.test(failed.lastResult.reason ?? ''), `the outcome does not say why: ${failed.lastResult.reason}`);
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
	// A terminal's user can install packages: sudo asks for no password.
	const root = run([engine, 'exec', server, 'sudo', '--non-interactive', 'id', '--user']).stdout.trim();
	assert(root === '0', `sudo did not reach root for the image's user: ${root}`);
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

/** What the release's own upgrader says about this container. */
function upgradeCheck(server) {
	const { stdout } = run([engine, 'exec', server, 'terminay', 'daemon', 'upgrade', '--check']);
	assert(stdout.trim().split('\n').length === 1, `the check printed more than one line:\n${stdout}`);
	return JSON.parse(stdout);
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

function run(command, { allowFailure = false, input } = {}) {
	const result = spawnSync(command[0], command.slice(1), {
		encoding: 'utf8',
		timeout: 180_000,
		...(input === undefined ? {} : { input }),
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
