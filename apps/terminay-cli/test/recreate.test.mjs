import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parseCommandLine, UsageError } from '../dist/args.js';
import { runUpgradeCheck } from '../dist/commands/check.js';
import {
	buildReplacement,
	HELPER_SUFFIX,
	ownContainerCandidates,
	PREVIOUS_SUFFIX,
	recreateOffered,
	runContainerRecreateHelper,
	runRecreate,
} from '../dist/commands/recreate.js';
import { UpgradeError } from '../dist/commands/upgrade.js';
import { containerLayout, writePendingUpgrade } from '../dist/container.js';
import {
	createDockerClient,
	DOCKER_SOCKET_DEFAULT,
	dockerSocketPath,
	probeDockerSocket,
} from '../dist/docker.js';
import {
	ImageReferenceError,
	parseImageReference,
	resolveTargetImage,
} from '../dist/imageReference.js';
import { readUpgradeOutcome } from '../dist/outcome.js';
import { buildArchiveFixture } from './archive-fixture.mjs';
import { newId, startFakeDocker } from './docker-fixture.mjs';
import { startReleaseFixture } from './release-fixture.mjs';

const OPTIONS = { allowDowngrade: false, purge: false, yes: false, wait: true };
const REPOSITORY = 'ghcr.io/markwylde/terminay';
const HELPER_LABEL = 'com.terminay.recreate-helper-for';

const RELEASES = [
	{
		tag: 'v4.1.0',
		version: '4.1.0',
		revision: 'a'.repeat(40),
		publishedAt: '2026-09-01T00:00:00Z',
	},
	{
		tag: 'v4.1.2',
		version: '4.1.2',
		revision: 'c'.repeat(40),
		latest: true,
		publishedAt: '2026-09-15T00:00:00Z',
	},
];

/**
 * Deadline timers that come due only when the test says so. Every deadline a
 * recreate sets — on an engine request, the socket probe, a container's health,
 * the grace a container with no health check is given — goes through these, so
 * a slow machine can never be the reason one passes.
 */
function manualTimers() {
	const pending = new Map();
	const watchers = [];
	let next = 0;
	return {
		setTimeout(handler, ms) {
			next += 1;
			pending.set(next, { handler, ms });
			for (const watcher of watchers.filter((entry) => entry.ms === ms)) {
				watchers.splice(watchers.indexOf(watcher), 1);
				watcher.resolve(next);
			}
			return next;
		},
		clearTimeout(id) {
			pending.delete(id);
		},
		/** Resolves with the first `ms` deadline that is, or becomes, pending. */
		armed(ms) {
			for (const [id, timer] of pending)
				if (timer.ms === ms) return Promise.resolve(id);
			return new Promise((resolve) => watchers.push({ ms, resolve }));
		},
		/** That deadline's time comes. */
		fire(id) {
			const timer = pending.get(id);
			assert.ok(timer, `deadline ${id} is not pending`);
			pending.delete(id);
			timer.handler();
		},
		/** The first `ms` deadline set from now on comes due as soon as it is set. */
		async expire(ms) {
			this.fire(await this.armed(ms));
		},
	};
}

/** What an image built from the Dockerfile reports as its configuration. */
function imageOf(version, revision, dataRoot) {
	return {
		Id: `sha256:${newId()}`,
		Config: {
			Env: [
				'PATH=/usr/local/bin:/usr/bin:/bin',
				'TERMINAY_MANAGED_BY=container',
				`TERMINAY_DATA_ROOT=${dataRoot}`,
				`TERMINAY_SERVER_REVISION=${revision}`,
			],
			Labels: {
				'org.opencontainers.image.title': 'Terminay Server',
				'org.opencontainers.image.version': version,
			},
			Entrypoint: ['/usr/local/bin/terminay-server-entrypoint'],
			Cmd: null,
			User: 'terminay',
			WorkingDir: '/home/terminay',
			StopSignal: 'SIGTERM',
			Healthcheck: { Test: ['CMD', '/opt/terminay/bin/node', '-e', 'probe'] },
			ExposedPorts: { '8443/tcp': {} },
			Volumes: { [dataRoot]: {} },
		},
	};
}

/**
 * A Terminay container, as an engine describes one an operator started with a
 * name, a named data volume, the Docker socket, published ports, two networks,
 * an extra environment variable, and a Compose label.
 */
async function withEngine(options, run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-recreate-'));
	const dataRoot = join(directory, 'volume');
	await mkdir(dataRoot, { recursive: true });
	const release = async (version, revision) =>
		(
			await buildArchiveFixture({
				directory: join(directory, `image-${version}`),
				version,
				revision,
			})
		).root;
	const oldRelease = await release('4.1.0', 'a'.repeat(40));
	const newRelease = await release('4.1.2', 'c'.repeat(40));
	const releases = await startReleaseFixture({ directory, releases: RELEASES });

	const reference = options.reference ?? `${REPOSITORY}:latest`;
	const oldImage = imageOf('4.1.0', 'a'.repeat(40), dataRoot);
	const newImage = imageOf('4.1.2', 'c'.repeat(40), dataRoot);
	// As an image is when its health check was switched off.
	if (options.noHealthcheck === true) delete newImage.Config.Healthcheck;
	const helperLog = [];
	const timers = manualTimers();
	const settings = {
		healthTimeoutMs: 2_000,
		settleMs: 30,
		timers,
		...options.settings,
	};
	let replacementStarted;
	const started = new Promise((resolve) => {
		replacementStarted = resolve;
	});
	let helperEnv;
	const docker = await startFakeDocker({
		registry: {
			[options.target ?? `${REPOSITORY}:latest`]: options.sameImage
				? oldImage
				: newImage,
		},
		pullError: options.pullError,
		health: options.health,
		healthAtStart: options.healthAtStart,
		startError: options.startError,
		// A started helper container runs the new image's CLI.
		onStart: async (container, exited) => {
			if (container.Name === '/terminay' && container.created !== undefined)
				replacementStarted(container);
			if (container.Config.Labels?.[HELPER_LABEL] === undefined) return;
			const status = await runContainerRecreateHelper(
				container.created.Cmd.slice(1),
				{ env: helperEnv, ...settings },
				(line) => helperLog.push(line),
			);
			exited(container, status);
		},
	});
	helperEnv = {
		TERMINAY_DATA_ROOT: dataRoot,
		TERMINAY_IMAGE_RELEASE: newRelease,
		DOCKER_HOST: `unix://${docker.socketPath}`,
	};
	docker.addImage(reference, oldImage);

	const id = newId();
	const container = docker.addContainer({
		Id: id,
		Name: '/terminay',
		Image: oldImage.Id,
		Config: {
			...oldImage.Config,
			Image: reference,
			Hostname: id.slice(0, 12),
			Env: [...oldImage.Config.Env, 'TERMINAY_PUBLIC_HOST=box.example.com'],
			Labels: {
				...oldImage.Config.Labels,
				'com.docker.compose.project': 'home',
			},
			ExposedPorts: { '8443/tcp': {}, '9000/tcp': {} },
		},
		HostConfig: {
			AutoRemove: false,
			NetworkMode: 'home_default',
			Binds: [
				`terminay-data:${dataRoot}`,
				`/var/run/docker.sock:${docker.socketPath}`,
			],
			PortBindings: { '8443/tcp': [{ HostIp: '', HostPort: '8443' }] },
			RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
			GroupAdd: ['998'],
			CapDrop: ['ALL'],
			...options.hostConfig,
		},
		Mounts: [
			{
				Type: 'volume',
				Name: 'terminay-data',
				Source: '/var/lib/docker/volumes/terminay-data/_data',
				Destination: dataRoot,
				RW: true,
			},
			{
				Type: 'bind',
				Source: '/var/run/docker.sock',
				Destination: docker.socketPath,
				RW: true,
			},
			// Created by the engine for a `VOLUME` nobody named.
			{
				Type: 'volume',
				Name: 'f'.repeat(64),
				Source: `/var/lib/docker/volumes/${'f'.repeat(64)}/_data`,
				Destination: '/home/terminay/cache',
				RW: true,
			},
		],
		NetworkSettings: {
			Networks: {
				extra: { Aliases: ['terminay-extra'], IPAMConfig: null },
				home_default: {
					Aliases: ['terminay', id.slice(0, 12)],
					IPAMConfig: { IPv4Address: '172.20.0.9' },
					MacAddress: '02:42:ac:14:00:09',
				},
			},
		},
		State: { Running: true, Status: 'running', Health: { Status: 'healthy' } },
	});

	const env = {
		TERMINAY_MANAGED_BY: 'container',
		TERMINAY_DATA_ROOT: dataRoot,
		TERMINAY_IMAGE_RELEASE: oldRelease,
		DOCKER_HOST: `unix://${docker.socketPath}`,
		HOSTNAME: id.slice(0, 12),
		...options.env,
	};
	const layout = containerLayout(env);
	await mkdir(layout.prefix, { recursive: true });
	const lines = [];
	const source = { apiBase: releases.origin, webBase: releases.origin };
	try {
		await run({
			directory,
			dataRoot,
			docker,
			container,
			oldImage,
			newImage,
			env,
			helperEnv,
			layout,
			lines,
			helperLog,
			settings,
			timers,
			/** Resolves once the replacement container has been started. */
			replacementStarted: started,
			recreate: (overrides = {}) =>
				runRecreate(
					{ ...OPTIONS, recreate: true },
					{ write: (line) => lines.push(line) },
					{ env, ...source, ...settings, ...overrides },
				),
			check: (overrides = {}) =>
				runUpgradeCheck(OPTIONS, {
					env: { ...env, ...overrides.env },
					...source,
					recreate: { probeTimeoutMs: 200, timers, ...overrides.recreate },
				}),
			outcome: () => readUpgradeOutcome(layout.resultPath),
		});
	} finally {
		await docker.close();
		await releases.close();
		await rm(directory, { recursive: true, force: true });
	}
}

const named = (docker, name) => docker.findContainer(name);

// ---------------------------------------------------------------------------
// 6.1 — is there a Docker socket this account can use?

test('the socket path follows DOCKER_HOST only when it names a Unix socket', () => {
	assert.equal(dockerSocketPath({}), DOCKER_SOCKET_DEFAULT);
	assert.equal(
		dockerSocketPath({ DOCKER_HOST: 'unix:///run/user/1000/docker.sock' }),
		'/run/user/1000/docker.sock',
	);
	assert.equal(
		dockerSocketPath({ DOCKER_HOST: 'tcp://10.0.0.1:2375' }),
		DOCKER_SOCKET_DEFAULT,
	);
	assert.equal(
		dockerSocketPath({ DOCKER_HOST: 'unix://relative.sock' }),
		DOCKER_SOCKET_DEFAULT,
	);
});

test('a socket with an engine behind it is usable', async () => {
	const docker = await startFakeDocker();
	try {
		// No deadline comes due here, so only the engine's answer can decide.
		assert.deepEqual(
			await probeDockerSocket(docker.socketPath, undefined, manualTimers()),
			{ usable: true },
		);
	} finally {
		await docker.close();
	}
});

test('no socket, or something that is not one, is not usable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'td-'));
	try {
		assert.deepEqual(await probeDockerSocket(join(directory, 'docker.sock')), {
			usable: false,
			cause: 'absent',
		});
		// What an engine leaves when the mount's source did not exist.
		await mkdir(join(directory, 'directory.sock'));
		assert.deepEqual(
			await probeDockerSocket(join(directory, 'directory.sock')),
			{
				usable: false,
				cause: 'not-a-socket',
			},
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('a socket nothing answers on is not usable, and is given up on at its deadline', async () => {
	const docker = await startFakeDocker();
	try {
		docker.state.silent = true;
		const timers = manualTimers();
		const probe = probeDockerSocket(docker.socketPath, 150, timers);
		// The one deadline the probe sets is what gives up on it.
		await timers.expire(150);
		assert.deepEqual(await probe, {
			usable: false,
			cause: 'unresponsive',
		});
	} finally {
		await docker.close();
	}
});

test('a socket whose listener hangs up without answering is not usable', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'td-'));
	const socketPath = join(directory, 'd.sock');
	const server = createServer((socket) => socket.destroy());
	await new Promise((resolve) => server.listen(socketPath, resolve));
	try {
		// The hang-up decides it, not a deadline: none comes due.
		assert.deepEqual(await probeDockerSocket(socketPath, 300, manualTimers()), {
			usable: false,
			cause: 'unresponsive',
		});
	} finally {
		await new Promise((resolve) => server.close(resolve));
		await rm(directory, { recursive: true, force: true });
	}
});

test('a socket this account may not open is not usable', {
	skip: process.getuid?.() === 0 ? 'root opens any socket' : false,
}, async () => {
	const docker = await startFakeDocker();
	try {
		// As a socket owned by root:docker with mode 0660 is to an account
		// outside that group.
		await chmod(docker.socketPath, 0o000);
		assert.equal((await stat(docker.socketPath)).mode & 0o777, 0);
		assert.deepEqual(await probeDockerSocket(docker.socketPath), {
			usable: false,
			cause: 'denied',
		});
	} finally {
		await chmod(docker.socketPath, 0o600).catch(() => undefined);
		await docker.close();
	}
});

test('a container with a usable socket is offered recreate beside in-place', async () => {
	await withEngine({}, async ({ check, docker }) => {
		const report = await check();
		assert.equal(report.environment, 'container');
		assert.deepEqual(report.modes, ['in-place', 'recreate']);
		// Asking changed nothing.
		assert.ok(docker.calls.every((call) => call.startsWith('GET ')));
	});
});

test('a container with no socket is offered in-place only', async () => {
	await withEngine({}, async ({ check, directory }) => {
		const report = await check({
			env: { DOCKER_HOST: `unix://${join(directory, 'absent.sock')}` },
		});
		assert.deepEqual(report.modes, ['in-place']);
	});
});

test('a container whose socket does not answer is offered in-place only', async () => {
	await withEngine({}, async ({ check, docker, timers }) => {
		docker.state.silent = true;
		const report = check();
		await timers.expire(200);
		assert.deepEqual((await report).modes, ['in-place']);
	});
});

test('a container whose account may not open the socket is offered in-place only', {
	skip: process.getuid?.() === 0 ? 'root opens any socket' : false,
}, async () => {
	await withEngine({}, async ({ check, docker }) => {
		await chmod(docker.socketPath, 0o000);
		try {
			assert.deepEqual((await check()).modes, ['in-place']);
		} finally {
			await chmod(docker.socketPath, 0o600);
		}
	});
});

test('recreate is not offered where it would be refused', async () => {
	const pinned = `${REPOSITORY}@sha256:${'9'.repeat(64)}`;
	await withEngine({ reference: pinned }, async ({ check }) => {
		assert.deepEqual((await check()).modes, ['in-place']);
	});
	await withEngine({ hostConfig: { AutoRemove: true } }, async ({ check }) => {
		assert.deepEqual((await check()).modes, ['in-place']);
	});
	await withEngine(
		{ hostConfig: { NetworkMode: `container:${newId()}` } },
		async ({ check }) => {
			assert.deepEqual((await check()).modes, ['in-place']);
		},
	);
});

test('the engine behind the socket must be the one running this container', async () => {
	// Another machine's socket: it answers, and knows no such container.
	await withEngine(
		{ env: { HOSTNAME: newId().slice(0, 12) } },
		async ({ check }) => {
			assert.deepEqual((await check()).modes, ['in-place']);
		},
	);
	// A hostname set to another container's name must not select it.
	await withEngine({ env: { HOSTNAME: 'terminay' } }, async ({ env }) => {
		assert.equal(await recreateOffered(env), false);
	});
});

test('a container whose hostname was overridden is found through /proc', async () => {
	await withEngine(
		{ env: { HOSTNAME: 'box' } },
		async ({ env, container, directory }) => {
			assert.equal(await recreateOffered(env), false);
			const procRoot = join(directory, 'proc');
			await mkdir(join(procRoot, 'self'), { recursive: true });
			await writeFile(
				join(procRoot, 'self/mountinfo'),
				[
					'711 623 0:57 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/ABC',
					`720 711 254:1 /docker/containers/${container.Id}/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/vda1 rw`,
					`721 711 254:1 /docker/containers/${container.Id}/hostname /etc/hostname rw,relatime - ext4 /dev/vda1 rw`,
				].join('\n'),
			);
			await writeFile(join(procRoot, 'self/cgroup'), '0::/\n');
			assert.deepEqual(await ownContainerCandidates(env, procRoot), [
				container.Id,
			]);
			assert.equal(await recreateOffered(env, { procRoot }), true);
		},
	);
});

test('a cgroup v1 path names the container too', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'td-'));
	try {
		const id = newId();
		await mkdir(join(directory, 'self'));
		await writeFile(
			join(directory, 'self/cgroup'),
			`12:pids:/docker/${id}\n1:name=systemd:/system.slice/docker-${id}.scope\n`,
		);
		assert.deepEqual(
			await ownContainerCandidates({ HOSTNAME: id.slice(0, 12) }, directory),
			[id, id.slice(0, 12)],
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// 6.2 — which image does a recreate move to?

test('a moving tag is pulled again under the same reference', () => {
	for (const [reference, tag] of [
		['ghcr.io/markwylde/terminay:latest', 'latest'],
		['ghcr.io/markwylde/terminay:main', 'main'],
	]) {
		assert.equal(parseImageReference(reference).kind, 'moving');
		assert.deepEqual(resolveTargetImage(reference, '5.2.0'), {
			reference,
			repository: 'ghcr.io/markwylde/terminay',
			tag,
		});
	}
});

test('a reference with no tag stays as written and pulls latest, never every tag', () => {
	assert.deepEqual(resolveTargetImage('markwylde/terminay'), {
		reference: 'markwylde/terminay',
		repository: 'markwylde/terminay',
		tag: 'latest',
	});
	// The colon here is the registry's port.
	assert.deepEqual(resolveTargetImage('localhost:5000/terminay'), {
		reference: 'localhost:5000/terminay',
		repository: 'localhost:5000/terminay',
		tag: 'latest',
	});
});

test('a version tag moves to the available version, written the same way', () => {
	assert.deepEqual(
		resolveTargetImage('ghcr.io/markwylde/terminay:5.1.1', '5.2.0'),
		{
			reference: 'ghcr.io/markwylde/terminay:5.2.0',
			repository: 'ghcr.io/markwylde/terminay',
			tag: '5.2.0',
		},
	);
	assert.deepEqual(
		resolveTargetImage('ghcr.io/markwylde/terminay:v5.1.1', '5.2.0'),
		{
			reference: 'ghcr.io/markwylde/terminay:v5.2.0',
			repository: 'ghcr.io/markwylde/terminay',
			tag: 'v5.2.0',
		},
	);
	assert.deepEqual(resolveTargetImage('localhost:5000/x:1.2.3', 'v1.3.0'), {
		reference: 'localhost:5000/x:1.3.0',
		repository: 'localhost:5000/x',
		tag: '1.3.0',
	});
	assert.deepEqual(parseImageReference('localhost:5000/x:1.2.3'), {
		kind: 'version',
		repository: 'localhost:5000/x',
		tag: '1.2.3',
		version: '1.2.3',
		prefixed: false,
	});
});

test('a version tag with no release to move to, or a release that is not a version, is refused', () => {
	assert.throws(
		() => resolveTargetImage('terminay:5.1.1'),
		ImageReferenceError,
	);
	assert.throws(
		() => resolveTargetImage('terminay:5.1.1', 'latest; rm -rf /'),
		ImageReferenceError,
	);
});

test('a digest-pinned reference is refused with a reason', () => {
	const digest = `sha256:${'9'.repeat(64)}`;
	for (const reference of [
		`ghcr.io/markwylde/terminay@${digest}`,
		`ghcr.io/markwylde/terminay:5.1.1@${digest}`,
		`localhost:5000/x@${digest}`,
	]) {
		const parsed = parseImageReference(reference);
		assert.equal(parsed.kind, 'pinned');
		assert.match(parsed.reason, /pinned to one image by digest/u);
		assert.throws(
			() => resolveTargetImage(reference, '5.2.0'),
			ImageReferenceError,
		);
	}
	// An image id is no more a reference to pull than a digest is.
	assert.equal(parseImageReference(digest).kind, 'pinned');
	assert.equal(parseImageReference('9'.repeat(64)).kind, 'pinned');
});

// ---------------------------------------------------------------------------
// 6.3 — the recreate itself.

test('recreate replaces the container with one of the same configuration on the newer image', async () => {
	await withEngine(
		{},
		async ({
			recreate,
			docker,
			container,
			newImage,
			dataRoot,
			outcome,
			lines,
		}) => {
			let helper;
			const starting = docker.state.onStart;
			docker.state.onStart = (started, exited) => {
				if (started.Config.Labels?.[HELPER_LABEL] !== undefined)
					helper = started;
				return starting(started, exited);
			};
			const result = await recreate();
			assert.deepEqual(result, {
				from: '4.1.0',
				to: 'latest',
				rolledBack: false,
				upToDate: false,
			});
			assert.match(lines.join('\n'), /every terminal in it ends/u);

			// The helper: the new image's own CLI, what the old container had, and
			// nothing it did not.
			assert.equal(helper.created.Image, `${REPOSITORY}:latest`);
			assert.deepEqual(helper.created.Entrypoint, [
				'/opt/terminay/bin/terminay',
			]);
			assert.deepEqual(helper.created.Cmd, [
				'container-recreate',
				container.Id,
				`${REPOSITORY}:latest`,
				'4.1.0',
				'latest',
			]);
			assert.equal(helper.created.User, 'terminay');
			assert.deepEqual(helper.created.HostConfig, {
				AutoRemove: true,
				NetworkMode: 'none',
				Binds: [
					`/var/run/docker.sock:${docker.socketPath}`,
					`terminay-data:${dataRoot}`,
				],
				GroupAdd: ['998'],
			});
			assert.equal(named(docker, `terminay${HELPER_SUFFIX}`), undefined);

			// One container, under the old name, on the new image.
			const replacement = named(docker, 'terminay');
			assert.notEqual(replacement.Id, container.Id);
			assert.equal(replacement.Image, newImage.Id);
			assert.equal(replacement.State.Running, true);
			assert.equal(docker.containers.size, 1);
			assert.equal(named(docker, `terminay${PREVIOUS_SUFFIX}`), undefined);

			const spec = replacement.created;
			assert.equal(spec.Image, `${REPOSITORY}:latest`);
			// Only what the operator added: the image's own settings come from
			// the new image, its build revision among them.
			assert.deepEqual(spec.Env, ['TERMINAY_PUBLIC_HOST=box.example.com']);
			assert.deepEqual(spec.Labels, { 'com.docker.compose.project': 'home' });
			assert.deepEqual(spec.ExposedPorts, { '9000/tcp': {} });
			for (const inherited of [
				'Entrypoint',
				'Cmd',
				'User',
				'WorkingDir',
				'Healthcheck',
				'StopSignal',
				'Volumes',
				'Hostname',
			])
				assert.equal(
					spec[inherited],
					undefined,
					`${inherited} was carried from the old image`,
				);
			assert.ok(
				replacement.Config.Env.includes(
					`TERMINAY_SERVER_REVISION=${'c'.repeat(40)}`,
				),
			);
			assert.ok(
				!replacement.Config.Env.includes(
					`TERMINAY_SERVER_REVISION=${'a'.repeat(40)}`,
				),
			);

			assert.deepEqual(spec.HostConfig, {
				...container.HostConfig,
				Binds: [
					`terminay-data:${dataRoot}`,
					`/var/run/docker.sock:${docker.socketPath}`,
					// The unnamed volume is named, so it is the same one.
					`${'f'.repeat(64)}:/home/terminay/cache`,
				],
			});
			assert.deepEqual(spec.NetworkingConfig, {
				EndpointsConfig: {
					home_default: {
						// The old container's generated alias is not carried.
						Aliases: ['terminay'],
						IPAMConfig: { IPv4Address: '172.20.0.9' },
					},
				},
			});
			assert.deepEqual(replacement.NetworkSettings.Networks.extra, {
				Aliases: ['terminay-extra'],
			});

			// Stopped with the container's own timeout, renamed, replaced, and
			// only then removed — and no volume was removed with anything.
			const order = docker.calls.filter((call) => !call.startsWith('GET '));
			const index = (pattern) => order.findIndex((call) => pattern.test(call));
			const stop = index(
				new RegExp(`POST /containers/${container.Id}/stop$`, 'u'),
			);
			const rename = index(/rename\?name=terminay-terminay-previous$/u);
			const create = index(/POST \/containers\/create\?name=terminay$/u);
			const remove = index(
				new RegExp(`DELETE /containers/${container.Id}$`, 'u'),
			);
			assert.ok(
				stop >= 0 && stop < rename && rename < create && create < remove,
				order.join('\n'),
			);
			assert.ok(!docker.calls.includes('VOLUMES REMOVED'));

			const recorded = await outcome();
			assert.equal(recorded.outcome, 'succeeded');
			assert.equal(recorded.from, '4.1.0');
			assert.equal(recorded.to, '4.1.2');
		},
	);
});

test('a replacement that is not healthy is removed and the old container started again', async () => {
	await withEngine(
		{
			health: (candidate) =>
				candidate.created === undefined ? 'healthy' : 'unhealthy',
		},
		async ({ recreate, docker, container, outcome, helperLog }) => {
			await assert.rejects(recreate(), UpgradeError);
			const restored = named(docker, 'terminay');
			assert.equal(restored.Id, container.Id);
			assert.equal(restored.State.Running, true);
			assert.equal(docker.containers.size, 1, helperLog.join('\n'));
			assert.equal(named(docker, `terminay${PREVIOUS_SUFFIX}`), undefined);
			assert.ok(!docker.calls.includes('VOLUMES REMOVED'));

			const recorded = await outcome();
			assert.equal(recorded.outcome, 'rolled-back');
			assert.equal(recorded.from, '4.1.0');
			assert.equal(recorded.to, '4.1.2');
			assert.match(recorded.reason, /its health check failed: not ready/u);
			assert.match(recorded.reason, /previous container was restored\.$/u);
		},
	);
});

test('a replacement that never reports healthy is given up on at the deadline', async () => {
	await withEngine(
		{ health: () => 'starting', settings: { healthTimeoutMs: 150 } },
		async ({ recreate, docker, container, outcome, timers }) => {
			const recreated = recreate();
			await timers.expire(150);
			await assert.rejects(recreated, UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.match((await outcome()).reason, /did not report healthy within/u);
		},
	);
});

test('a replacement already unhealthy by the time it is looked at is not kept', async () => {
	await withEngine(
		{
			healthAtStart: true,
			health: (candidate) =>
				candidate.created === undefined ? 'healthy' : 'unhealthy',
		},
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(recreate(), UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.match(
				(await outcome()).reason,
				/its health check failed: not ready/u,
			);
		},
	);
});

test('a replacement already healthy by the time it is looked at is kept', async () => {
	await withEngine(
		{ healthAtStart: true },
		async ({ recreate, docker, newImage, outcome }) => {
			await recreate();
			assert.equal(named(docker, 'terminay').Image, newImage.Id);
			assert.equal((await outcome()).outcome, 'succeeded');
		},
	);
});

test('a replacement that exits before it is healthy is removed and the old container started again', async () => {
	await withEngine(
		{
			health: (candidate) =>
				candidate.Name === '/terminay' && candidate.created !== undefined
					? 'die'
					: 'healthy',
		},
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(recreate(), UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.equal(docker.containers.size, 1);
			const recorded = await outcome();
			assert.equal(recorded.outcome, 'rolled-back');
			assert.match(
				recorded.reason,
				/it exited with status 1 before it was healthy/u,
			);
		},
	);
});

test('an engine that stops reporting on the replacement is a failure, not a reason to ask again', async () => {
	await withEngine(
		{
			health: (candidate) =>
				candidate.Name === '/terminay' && candidate.created !== undefined
					? 'drop'
					: 'healthy',
		},
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(recreate(), UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.match(
				(await outcome()).reason,
				/stopped reporting on it before it was healthy/u,
			);
		},
	);
});

test('a replacement with no health check is kept once it has stayed up', async () => {
	await withEngine(
		{ noHealthcheck: true, health: () => 'starting' },
		async ({ recreate, docker, newImage, outcome, timers }) => {
			const recreated = recreate();
			// The grace period passes with the replacement still running.
			await timers.expire(30);
			await recreated;
			const replacement = named(docker, 'terminay');
			assert.equal(replacement.Image, newImage.Id);
			assert.equal(replacement.State.Health, undefined);
			assert.equal((await outcome()).outcome, 'succeeded');
		},
	);
});

test('a replacement with no health check that exits is not kept', async () => {
	await withEngine(
		{
			noHealthcheck: true,
			settings: { settleMs: 1_000 },
			health: (candidate) =>
				candidate.Name === '/terminay' && candidate.created !== undefined
					? 'die'
					: 'starting',
		},
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(recreate(), UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.match((await outcome()).reason, /it exited with status 1/u);
		},
	);
});

test('the wait for health is one subscription and one look, never a repeated question', async () => {
	await withEngine(
		{ health: () => 'starting', settings: { healthTimeoutMs: 400 } },
		async ({ recreate, docker, timers, replacementStarted }) => {
			const recreated = recreate();
			// The wait runs from the start until its deadline: anything that
			// asked again would have done so in between.
			const deadline = await timers.armed(400);
			await replacementStarted;
			timers.fire(deadline);
			await assert.rejects(recreated, UpgradeError);
			const replacement = docker.calls.findIndex((call) =>
				/POST \/containers\/create\?name=terminay$/u.test(call),
			);
			const after = docker.calls.slice(replacement + 1);
			const start = after.findIndex((call) => /\/start$/u.test(call));
			// Subscribed before the start, so no transition can be missed.
			assert.ok(after.indexOf('GET /events') < start, after.join('\n'));
			const removal = after.findIndex((call) => call.startsWith('DELETE '));
			const looks = after
				.slice(start, removal)
				.filter((call) => /^GET \/containers\/[^/]+\/json$/u.test(call));
			assert.equal(looks.length, 1, after.join('\n'));
			assert.equal(docker.streams.size, 0);
		},
	);
});

test('a replacement that cannot be started is removed and the old container started again', async () => {
	await withEngine(
		{
			startError: (candidate) =>
				candidate.Name === '/terminay' && candidate.created !== undefined,
		},
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(recreate(), UpgradeError);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.equal(docker.containers.size, 1);
			const recorded = await outcome();
			assert.equal(recorded.outcome, 'rolled-back');
			assert.match(
				recorded.reason,
				/driver failed programming external connectivity/u,
			);
		},
	);
});

test('a version-tagged container moves to the tag of the newest release', async () => {
	await withEngine(
		{
			reference: 'localhost:5000/terminay:v4.1.0',
			target: 'localhost:5000/terminay:v4.1.2',
		},
		async ({ recreate, docker, newImage, outcome }) => {
			const result = await recreate();
			assert.equal(result.to, '4.1.2');
			assert.ok(
				docker.calls.includes(
					'POST /images/create?fromImage=localhost%3A5000%2Fterminay&tag=v4.1.2',
				),
				docker.calls.join('\n'),
			);
			const replacement = named(docker, 'terminay');
			assert.equal(replacement.created.Image, 'localhost:5000/terminay:v4.1.2');
			assert.equal(replacement.Image, newImage.Id);
			assert.equal((await outcome()).outcome, 'succeeded');
		},
	);
});

test('when the pulled image is the one already running, nothing is done', async () => {
	await withEngine(
		{ sameImage: true },
		async ({ recreate, docker, container, outcome, lines }) => {
			const result = await recreate();
			assert.equal(result.upToDate, true);
			assert.match(lines.join('\n'), /Nothing to do/u);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.ok(
				!docker.calls.some((call) => call.includes('/containers/create')),
			);
			assert.equal(await outcome(), undefined);
		},
	);
});

test('an image that cannot be pulled changes nothing and is recorded', async () => {
	await withEngine(
		{ pullError: 'unauthorized: authentication required' },
		async ({ recreate, docker, container, outcome }) => {
			await assert.rejects(
				recreate(),
				/could not be pulled, so nothing was changed: .*unauthorized/u,
			);
			assert.equal(named(docker, 'terminay').Id, container.Id);
			assert.equal(named(docker, 'terminay').State.Running, true);
			assert.ok(
				!docker.calls.some((call) => call.includes('/containers/create')),
			);
			const recorded = await outcome();
			assert.equal(recorded.outcome, 'rolled-back');
			assert.equal(recorded.from, '4.1.0');
			assert.equal(recorded.to, 'latest');
		},
	);
});

test('recreate refuses a container it could not stand a replacement in for', async () => {
	const untouched = ({ docker }) =>
		assert.ok(
			docker.calls.every((call) => call.startsWith('GET ')),
			docker.calls.join('\n'),
		);
	await withEngine(
		{ reference: `${REPOSITORY}@sha256:${'9'.repeat(64)}` },
		async (engine) => {
			await assert.rejects(engine.recreate(), /pinned to one image by digest/u);
			untouched(engine);
		},
	);
	await withEngine({ hostConfig: { AutoRemove: true } }, async (engine) => {
		await assert.rejects(engine.recreate(), /started with `--rm`/u);
		untouched(engine);
	});
	await withEngine(
		{ hostConfig: { NetworkMode: `container:${newId()}` } },
		async (engine) => {
			await assert.rejects(
				engine.recreate(),
				/shares another container’s network/u,
			);
			untouched(engine);
		},
	);
});

test('recreate refuses without a usable socket, and outside a container', async () => {
	await withEngine({}, async ({ recreate, directory, env, docker, timers }) => {
		await assert.rejects(
			recreate({
				env: {
					...env,
					DOCKER_HOST: `unix://${join(directory, 'absent.sock')}`,
				},
			}),
			/no Docker socket is mounted/u,
		);
		docker.state.silent = true;
		const unanswered = recreate({ probeTimeoutMs: 150 });
		await timers.expire(150);
		await assert.rejects(unanswered, /no Docker daemon answered/u);
		docker.state.silent = false;
		await assert.rejects(
			recreate({ env: { ...env, TERMINAY_MANAGED_BY: undefined } }),
			/not running in the official image/u,
		);
		assert.ok(docker.calls.every((call) => call.startsWith('GET ')));
	});
});

test('recreate refuses while an in-place upgrade is unconfirmed, or an earlier recreate is unfinished', async () => {
	await withEngine(
		{},
		async ({ recreate, layout, docker, container, outcome }) => {
			await writePendingUpgrade(layout, {
				previous: null,
				next: '4.1.1',
				from: '4.1.0',
				to: '4.1.1',
			});
			await assert.rejects(recreate(), /already in progress/u);
			await rm(layout.pendingPath);

			docker.addContainer({
				...container,
				Id: newId(),
				Name: `/terminay${PREVIOUS_SUFFIX}`,
				State: { Running: false },
			});
			await assert.rejects(recreate(), /left from an earlier recreate/u);
			assert.equal((await outcome()).outcome, 'rolled-back');
			assert.ok(docker.calls.every((call) => call.startsWith('GET ')));
		},
	);
});

test('the helper settles what the stopped container left on the data volume', async () => {
	await withEngine(
		{},
		async ({
			docker,
			container,
			newImage,
			layout,
			helperEnv,
			settings,
			outcome,
		}) => {
			docker.addImage(`${REPOSITORY}:latest`, newImage);
			// An in-place upgrade was mid-flight when the container was stopped.
			await writePendingUpgrade(layout, {
				previous: null,
				next: '4.1.1',
				from: '4.1.0',
				to: '4.1.1',
			});
			await writeFile(layout.restartMarker, '');
			await writeFile(layout.serverPidPath, '4242\n');
			const status = await runContainerRecreateHelper(
				[container.Id, `${REPOSITORY}:latest`, '4.1.0', 'latest'],
				{ env: helperEnv, ...settings },
				() => undefined,
			);
			assert.equal(status, 0);
			for (const path of [
				layout.pendingPath,
				layout.restartMarker,
				layout.serverPidPath,
			])
				await assert.rejects(stat(path), { code: 'ENOENT' });
			// The recreate's outcome is the one on record, not the undone upgrade's.
			const recorded = await outcome();
			assert.equal(recorded.outcome, 'succeeded');
			assert.equal(recorded.to, '4.1.2');
		},
	);
});

test('the helper refuses arguments that do not name a Terminay container and a reference', async () => {
	await withEngine({}, async ({ docker, container, helperEnv, outcome }) => {
		const run = (argv) =>
			runContainerRecreateHelper(argv, { env: helperEnv }, () => undefined);
		assert.equal(await run([]), 64);
		assert.equal(await run(['terminay', `${REPOSITORY}:latest`, 'a', 'b']), 64);
		assert.equal(
			await run([
				container.Id,
				`${REPOSITORY}@sha256:${'9'.repeat(64)}`,
				'a',
				'b',
			]),
			64,
		);
		assert.equal(await outcome(), undefined);

		// Some other container on the same engine is never replaced.
		const other = docker.addContainer({
			...container,
			Id: newId(),
			Name: '/database',
			Config: { ...container.Config, Env: ['POSTGRES_PASSWORD=x'] },
		});
		assert.equal(
			await run([other.Id, `${REPOSITORY}:latest`, '4.1.0', 'latest']),
			1,
		);
		assert.equal(other.State.Running, true);
		assert.ok(docker.calls.every((call) => call.startsWith('GET ')));
		assert.match(
			(await outcome()).reason,
			/not a Terminay server on this data volume/u,
		);
	});
});

test('a container on the host network, or with no network, is given no networking of its own', () => {
	const image = imageOf('4.1.0', 'a'.repeat(40), '/var/lib/terminay');
	const id = newId();
	const container = (mode, networks) => ({
		Id: id,
		Name: '/terminay',
		Image: image.Id,
		Config: {
			...image.Config,
			Image: 'terminay',
			Hostname: 'box',
			Cmd: ['--verbose'],
		},
		HostConfig: { NetworkMode: mode, Links: ['/db:/terminay/database'] },
		Mounts: [],
		NetworkSettings: { Networks: networks },
	});
	const host = buildReplacement(
		container('host', { host: {} }),
		image,
		'terminay',
	);
	assert.equal(host.spec.NetworkingConfig, undefined);
	assert.equal(host.spec.Hostname, undefined);
	assert.deepEqual(host.networks, []);
	// A command the operator gave is theirs, and is kept.
	assert.deepEqual(host.spec.Cmd, ['--verbose']);
	assert.deepEqual(host.spec.HostConfig.Links, ['db:database']);

	const bridge = buildReplacement(
		container('default', { bridge: { Aliases: null } }),
		image,
		'terminay',
	);
	assert.deepEqual(bridge.spec.NetworkingConfig, {
		EndpointsConfig: { bridge: {} },
	});
	// A hostname the operator chose is kept; a generated one is not.
	assert.equal(bridge.spec.Hostname, 'box');
});

// ---------------------------------------------------------------------------
// The flag.

test('--recreate is an upgrade flag that takes nothing else', () => {
	assert.equal(
		parseCommandLine(['daemon', 'upgrade', '--recreate']).options.recreate,
		true,
	);
	assert.equal(
		parseCommandLine(['daemon', 'upgrade']).options.recreate,
		undefined,
	);
	for (const argv of [
		['daemon', 'upgrade', 'v5.2.0', '--recreate'],
		['daemon', 'upgrade', '--recreate', '--check'],
		['daemon', 'upgrade', '--recreate', '--allow-downgrade'],
		['daemon', 'upgrade', '--recreate', '--public-host', '192.168.1.20'],
		['daemon', 'upgrade', '--recreate', '--user'],
		['daemon', 'install', '--recreate'],
		['daemon', 'upgrade', '--recreate=ghcr.io/x/y:latest'],
	])
		assert.throws(() => parseCommandLine(argv), UsageError, argv.join(' '));
});

test('the Docker client reports an engine error with what it was doing', async () => {
	const docker = await startFakeDocker();
	try {
		const client = createDockerClient(docker.socketPath);
		await assert.rejects(
			client.startContainer(newId()),
			/starting the container failed \(404\): No such container/u,
		);
		assert.equal(await client.inspectContainer(newId()), undefined);
		assert.equal(
			await client.inspectImage('ghcr.io/markwylde/terminay:latest'),
			undefined,
		);
		await assert.rejects(
			client.pullImage('ghcr.io/x/y', 'latest'),
			/manifest for ghcr.io\/x\/y:latest not found/u,
		);
	} finally {
		await docker.close();
	}
});
