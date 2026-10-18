import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
	appendFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runUpgradeCheck } from '../dist/commands/check.js';
import { runContainerUpgrade } from '../dist/commands/containerUpgrade.js';
import { UpgradeError } from '../dist/commands/upgrade.js';
import {
	containerLayout,
	markRelease,
	readPendingUpgrade,
	runContainerRelease,
	runningRelease,
	selectRelease,
	superviseStep,
	writePendingUpgrade,
	writeStagedRecord,
} from '../dist/container.js';
import { installArchive, installedVersions } from '../dist/install.js';
import { readUpgradeOutcome } from '../dist/outcome.js';
import { buildArchiveFixture } from './archive-fixture.mjs';
import { startReleaseFixture } from './release-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '../dist/cli.js');
const ENTRYPOINT = resolve(here, '../../../docker/terminay-server-entrypoint');
const COMMAND = resolve(here, '../../../docker/terminay');
// The image's /bin/sh is dash, so that is what runs the entrypoint here when
// the machine has one.
const SHELL = existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh';
const OPTIONS = { allowDowngrade: false, purge: false, yes: false, wait: true };

/**
 * A server a supervisor can supervise: it answers the readiness endpoint on
 * the health port, says which release it is and what it was started with,
 * leaves a detached process behind as the session holder does, and exits
 * cleanly on SIGTERM.
 */
function serverLauncher(version, behaviour = 'ready') {
	if (behaviour === 'crash') return '#!/bin/sh\nexit 7\n';
	const script = [
		'const http = require("node:http");',
		'const { spawn } = require("node:child_process");',
		'const fs = require("node:fs");',
		`const version = ${JSON.stringify(version)};`,
		'if (process.argv.includes("--version")) { console.log(version); process.exit(0); }',
		`const ready = ${behaviour === 'ready'};`,
		'const holderFile = process.env.TERMINAY_FIXTURE_HOLDER;',
		'if (holderFile && !fs.existsSync(holderFile)) {',
		'  const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1e9)"], { detached: true, stdio: "ignore" });',
		'  holder.unref();',
		'  fs.writeFileSync(holderFile, String(holder.pid));',
		'}',
		'http.createServer((request, response) => {',
		'  response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });',
		'  response.end(JSON.stringify({ status: "ok", ready, version, ui: process.env.TERMINAY_UI_RENDERER_DIRECTORY, upgrader: process.env.TERMINAY_UPGRADER, revision: process.env.TERMINAY_SERVER_REVISION }));',
		'}).listen(Number(process.env.TERMINAY_HEALTH_PORT), "127.0.0.1", () => {',
		// Told to the test the moment the server can be asked, so it waits on
		// this rather than asking until it answers.
		'  console.log(`fixture-server ${version} ${ready ? "ready" : "not-ready"} ${process.pid}`);',
		'});',
		'process.on("SIGTERM", () => process.exit(0));',
		'process.on("SIGINT", () => process.exit(0));',
	].join('\n');
	return `#!/bin/sh\nexec "$TERMINAY_FIXTURE_NODE" -e '${script}' -- "$@"\n`;
}

const RELEASES = [
	{
		tag: 'v4.1.1',
		version: '4.1.1',
		revision: 'b'.repeat(40),
		publishedAt: '2026-09-08T00:00:00Z',
		launcher: serverLauncher('4.1.1'),
	},
	{
		tag: 'v4.1.2',
		version: '4.1.2',
		revision: 'c'.repeat(40),
		latest: true,
		publishedAt: '2026-09-15T00:00:00Z',
		launcher: serverLauncher('4.1.2'),
		// This one carries its own upgrader, as every archive now does.
		extraFiles: { 'bin/terminay': '#!/bin/sh\n' },
		executable: ['bin/terminay'],
	},
];

function freePort() {
	return new Promise((done) => {
		const server = createServer();
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
	});
}

function health(port) {
	return new Promise((done) => {
		const request = get(
			{ host: '127.0.0.1', port, path: '/readyz' },
			(response) => {
				let body = '';
				response.setEncoding('utf8');
				response.on('data', (chunk) => {
					body += chunk;
				});
				response.on('end', () => {
					try {
						done(JSON.parse(body));
					} catch {
						done(undefined);
					}
				});
			},
		);
		request.on('error', () => done(undefined));
	});
}

/**
 * Deadline timers that come due only when the test says so. The upgrade's
 * stop and readiness deadlines go through these, so a slow machine can never
 * be the reason one passes.
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
	};
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * A container, without one: a data volume, the release an image was built
 * with, and the environment the image sets. The image's release carries the
 * image's own Node and CLI, which is what the entrypoint selects with.
 */
async function withContainer(options, run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-container-'));
	const dataRoot = join(directory, 'volume');
	await mkdir(dataRoot, { recursive: true });
	const port = await freePort();
	const holderFile = join(directory, 'holder.pid');
	const makeImage = async (image) => {
		const built = await buildArchiveFixture({
			directory: join(
				directory,
				`image-${image.version}-${image.revision.slice(0, 4)}`,
			),
			version: image.version,
			channel: image.channel ?? 'tag',
			revision: image.revision,
			launcher: serverLauncher(image.version),
		});
		await symlink(process.execPath, join(built.root, 'bin/node'));
		await mkdir(join(built.root, 'cli'));
		await writeFile(
			join(built.root, 'cli/terminay.mjs'),
			`import ${JSON.stringify(CLI)};\n`,
		);
		await writeFile(
			join(built.root, 'bin/terminay'),
			`#!/bin/sh\nexec ${JSON.stringify(join(built.root, 'bin/node'))} ${JSON.stringify(join(built.root, 'cli/terminay.mjs'))} "$@"\n`,
			{ mode: 0o755 },
		);
		return built.root;
	};
	const imageRelease = await makeImage(
		options.image ?? { version: '4.1.0', revision: 'a'.repeat(40) },
	);
	const releases = await startReleaseFixture({
		directory,
		releases: options.releases ?? RELEASES,
	});
	const env = (image = imageRelease) => ({
		TERMINAY_MANAGED_BY: 'container',
		TERMINAY_DATA_ROOT: dataRoot,
		TERMINAY_IMAGE_RELEASE: image,
		TERMINAY_HEALTH_PORT: String(port),
	});
	const started = [];
	/** `docker run`: the entrypoint, as the container's main process. */
	const start = (args = [], image = imageRelease) => {
		const child = spawn(SHELL, [ENTRYPOINT, ...args], {
			env: {
				PATH: process.env.PATH,
				NODE_TLS_REJECT_UNAUTHORIZED: '0',
				TERMINAY_FIXTURE_NODE: process.execPath,
				TERMINAY_FIXTURE_HOLDER: holderFile,
				// As the image's environment does.
				TERMINAY_SERVER_REVISION: 'image-revision',
				...env(image),
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const container = { child, stdout: '', stderr: '', pid: child.pid };
		child.stdout.on('data', (chunk) => {
			container.stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			container.stderr += chunk;
		});
		let partial = '';
		child.stdout.on('data', (chunk) => {
			partial += chunk;
			const lines = partial.split('\n');
			partial = lines.pop();
			for (const line of lines) {
				const [tag, version, readiness] = line.split(' ');
				if (tag !== 'fixture-server') continue;
				servers.push({ version, ready: readiness === 'ready' });
				for (const check of [...serverWaiters]) check();
			}
		});
		// Once its output has closed too, so all of it has been read.
		container.exited = new Promise((done) => {
			child.on('close', (code, signal) => done({ code, signal }));
		});
		started.push(container);
		return container;
	};
	/** Every fixture server that has started listening, in order. */
	const servers = [];
	const serverWaiters = new Set();
	let seen = 0;
	/**
	 * The next server to start listening after the last one waited for, of
	 * `version` and, when given, that readiness.
	 */
	const listening = (version, ready) =>
		new Promise((done) => {
			const check = () => {
				const index = servers.findIndex(
					(server, at) =>
						at >= seen &&
						server.version === version &&
						(ready === undefined || server.ready === ready),
				);
				if (index < 0) return;
				serverWaiters.delete(check);
				seen = index + 1;
				done(servers[index]);
			};
			serverWaiters.add(check);
			check();
		});
	const timers = manualTimers();
	const lines = [];
	try {
		await run({
			directory,
			dataRoot,
			port,
			imageRelease,
			makeImage,
			layout: containerLayout(env()),
			env,
			start,
			lines,
			holderFile,
			timers,
			listening,
			/** The next server of `version` to listen ready, as it reports itself. */
			ready: async (version) => {
				await listening(version, true);
				const snapshot = await health(port);
				assert.equal(snapshot?.ready, true);
				assert.equal(snapshot.version, version);
				return snapshot;
			},
			/** `docker stop`: SIGTERM to the main process. */
			stop: async (container) => {
				container.child.kill('SIGTERM');
				return container.exited;
			},
			upgrade: (ref, overrides = {}) =>
				runContainerUpgrade(
					ref,
					{ ...OPTIONS, ...overrides.options },
					{ write: (line) => lines.push(line) },
					{
						env: env(),
						apiBase: releases.origin,
						webBase: releases.origin,
						releasePublicKeyPem: releases.publicPem,
						readinessTimeoutMs: 8_000,
						timers,
						...overrides.dependencies,
					},
				),
			check: () =>
				runUpgradeCheck(OPTIONS, {
					env: env(),
					apiBase: releases.origin,
					webBase: releases.origin,
				}),
		});
	} finally {
		for (const container of started) {
			if (container.child.exitCode === null) container.child.kill('SIGKILL');
		}
		const pidFile = join(dataRoot, 'releases/server.pid');
		for (const file of [pidFile, holderFile]) {
			const pid = Number((await readFile(file, 'utf8').catch(() => '')).trim());
			if (pid > 1 && alive(pid)) process.kill(pid, 'SIGKILL');
		}
		await releases.close();
		await rm(directory, { recursive: true, force: true });
	}
}

/** Stage a release on the volume the way an upgrade does, without a server. */
async function stage(layout, directory, release) {
	const built = await buildArchiveFixture({
		directory: join(
			directory,
			`stage-${release.version}-${release.revision.slice(0, 4)}`,
		),
		version: release.version,
		channel: release.channel ?? 'tag',
		revision: release.revision,
	});
	const staged = await installArchive({
		layout,
		archivePath: built.archivePath,
		channel: release.channel ?? 'tag',
	});
	if (release.over !== undefined) {
		await writeStagedRecord(layout, {
			name: staged.name,
			imageRevision: release.over,
		});
	}
	return staged;
}

test('with nothing staged, the release built into the image is selected', async () => {
	await withContainer({}, async ({ layout, imageRelease }) => {
		assert.deepEqual(await selectRelease(layout), { root: imageRelease });
	});
});

test('a staged release newer than the image is selected, and equal is not older', async () => {
	await withContainer({}, async ({ layout, directory }) => {
		const newer = await stage(layout, directory, {
			version: '4.1.1',
			revision: 'b'.repeat(40),
		});
		await markRelease(layout, newer.name);
		assert.deepEqual(await selectRelease(layout), {
			root: newer.directory,
			staged: '4.1.1',
		});

		const same = await stage(layout, directory, {
			version: '4.1.0',
			revision: 'a'.repeat(40),
		});
		await markRelease(layout, same.name);
		assert.equal((await selectRelease(layout)).staged, '4.1.0');
	});
});

test('a damaged staged release is skipped with a reason that names it, and the image starts', async () => {
	await withContainer({}, async ({ layout, directory, imageRelease }) => {
		const staged = await stage(layout, directory, {
			version: '4.1.1',
			revision: 'b'.repeat(40),
		});
		await markRelease(layout, staged.name);
		await appendFile(
			join(staged.directory, 'server/dist/cli.js'),
			'// edited\n',
		);

		const selected = await selectRelease(layout);
		assert.equal(selected.root, imageRelease);
		assert.equal(selected.staged, undefined);
		assert.match(selected.skipped, /skipping the staged release 4\.1\.1/u);
		assert.match(selected.skipped, /server\/dist\/cli\.js/u);

		// A mark that points at nothing at all is the same story.
		await rm(staged.directory, { recursive: true });
		const missing = await selectRelease(layout);
		assert.equal(missing.root, imageRelease);
		assert.match(missing.skipped, /4\.1\.1/u);
	});
});

test('a newer image wins over a stale staged release', async () => {
	await withContainer(
		{ image: { version: '4.3.0', revision: 'e'.repeat(40) } },
		async ({ layout, directory, imageRelease }) => {
			const staged = await stage(layout, directory, {
				version: '4.2.0',
				revision: 'd'.repeat(40),
			});
			await markRelease(layout, staged.name);
			const selected = await selectRelease(layout);
			assert.equal(selected.root, imageRelease);
			assert.match(
				selected.skipped,
				/older than the 4\.3\.0 this image carries/u,
			);
		},
	);
});

test('a rolling build wins while the image is the commit it was staged over, and loses to any other', async () => {
	const image = { version: '0.0.0', channel: 'main', revision: 'a'.repeat(40) };
	await withContainer(
		{ image },
		async ({ layout, directory, imageRelease, makeImage, env }) => {
			const staged = await stage(layout, directory, {
				version: '0.0.0',
				channel: 'main',
				revision: 'b'.repeat(40),
				over: 'a'.repeat(40),
			});
			await markRelease(layout, staged.name);
			assert.equal(staged.name, `main-${'b'.repeat(12)}`);
			assert.equal((await selectRelease(layout)).staged, staged.name);

			// The operator pulled a different image: it is deliberate, and it wins.
			const pulled = await makeImage({ ...image, revision: 'c'.repeat(40) });
			const after = await selectRelease(containerLayout(env(pulled)));
			assert.equal(after.root, pulled);
			assert.match(after.skipped, /staged over image revision aaaaaaaaaaaa/u);
			assert.notEqual(pulled, imageRelease);
		},
	);

	// A rolling build with no record of what it was staged over cannot be
	// ordered at all, so the image stands.
	await withContainer(
		{ image },
		async ({ layout, directory, imageRelease }) => {
			const staged = await stage(layout, directory, {
				version: '0.0.0',
				channel: 'main',
				revision: 'b'.repeat(40),
			});
			await markRelease(layout, staged.name);
			const selected = await selectRelease(layout);
			assert.equal(selected.root, imageRelease);
			assert.match(selected.skipped, /nothing records which image/u);
		},
	);
});

test('the entrypoint is told to restart only when one was asked for, and to exit otherwise', async () => {
	await withContainer({}, async ({ layout, directory, imageRelease }) => {
		await mkdir(layout.prefix, { recursive: true });
		const logged = [];
		const log = (line) => logged.push(line);

		assert.deepEqual(await superviseStep(layout, { phase: 'start' }, log), {
			action: 'run',
			release: imageRelease,
		});
		// The server exited and nothing asked for a restart: its status is the
		// container's, so the runtime's restart policy applies.
		assert.deepEqual(
			await superviseStep(layout, { phase: 'exited', status: 1 }, log),
			{ action: 'exit' },
		);

		// A requested restart is consumed by the restart it causes.
		const staged = await stage(layout, directory, {
			version: '4.1.1',
			revision: 'b'.repeat(40),
		});
		await markRelease(layout, staged.name);
		await writeFile(layout.restartMarker, '');
		assert.deepEqual(
			await superviseStep(layout, { phase: 'exited', status: 0 }, log),
			{ action: 'run', release: staged.directory },
		);
		assert.equal(existsSync(layout.restartMarker), false);
		assert.deepEqual(
			await superviseStep(layout, { phase: 'exited', status: 0 }, log),
			{ action: 'exit' },
		);

		// Selecting for a command that prints and exits changes nothing.
		await writeFile(layout.restartMarker, '');
		assert.deepEqual(await superviseStep(layout, { phase: 'select' }, log), {
			action: 'run',
			release: staged.directory,
		});
		assert.equal(existsSync(layout.restartMarker), true);
		assert.deepEqual(logged, []);
	});
});

test('an upgrade nobody confirmed is undone before anything is started again', async () => {
	await withContainer({}, async ({ layout, directory, imageRelease }) => {
		const staged = await stage(layout, directory, {
			version: '4.1.1',
			revision: 'b'.repeat(40),
		});
		const pend = async () => {
			await markRelease(layout, staged.name);
			await writePendingUpgrade(layout, {
				previous: null,
				next: staged.name,
				from: '4.1.0',
				to: '4.1.1',
			});
		};
		const logged = [];

		// The new server exited on its own before it was confirmed.
		await pend();
		assert.deepEqual(
			await superviseStep(layout, { phase: 'exited', status: 7 }, (line) =>
				logged.push(line),
			),
			{ action: 'run', release: imageRelease },
		);
		assert.equal(await readPendingUpgrade(layout), undefined);
		await assert.rejects(() => readlink(layout.currentLink));
		assert.deepEqual(
			await readUpgradeOutcome(layout.resultPath).then((outcome) => ({
				...outcome,
				at: undefined,
			})),
			{
				schemaVersion: 1,
				from: '4.1.0',
				to: '4.1.1',
				outcome: 'rolled-back',
				reason: '4.1.1 exited with status 7 before it reported ready',
				at: undefined,
			},
		);
		assert.match(logged.join('\n'), /restoring 4\.1\.0/u);

		// The container itself went away mid-upgrade and has come back.
		await pend();
		assert.deepEqual(await superviseStep(layout, { phase: 'start' }), {
			action: 'run',
			release: imageRelease,
		});
		assert.match(
			(await readUpgradeOutcome(layout.resultPath)).reason,
			/container stopped before 4\.1\.1 reported ready/u,
		);
	});
});

test('the hidden command answers in one line, and with the image when it cannot decide', async () => {
	await withContainer({}, async ({ env, imageRelease, layout }) => {
		const out = [];
		const log = [];
		const call = (argv, environment = env()) =>
			runContainerRelease(
				argv,
				environment,
				(line) => out.push(line),
				(line) => log.push(line),
			);
		assert.equal(await call(['select']), 0);
		assert.equal(await call(['exited', '3']), 0);
		assert.deepEqual(out, [`run ${imageRelease}`, 'exit']);
		assert.equal(await call(['nonsense']), 64);

		// A releases path that cannot be read as a directory must not stop the
		// server from starting on the image's release.
		await writeFile(layout.prefix, 'not a directory');
		out.length = 0;
		assert.equal(await call(['start']), 0);
		assert.deepEqual(out, [`run ${imageRelease}`]);
	});
});

test('daemon upgrade refuses where no entrypoint supervises the server', async () => {
	await withContainer({}, async ({ upgrade, check, dataRoot }) => {
		await assert.rejects(
			() => upgrade(),
			(error) =>
				error instanceof UpgradeError &&
				/not started by an entrypoint that can restart it/u.test(
					error.message,
				) &&
				/recreate the container/u.test(error.message),
		);
		assert.deepEqual(await readdir(dataRoot), [], 'nothing may be staged');

		const report = await check();
		assert.equal(report.environment, 'container');
		assert.equal(report.canUpgrade, false);
		assert.match(report.unavailable.reason, /recreate the container/u);
		// What exists is still reported, so the client can say why.
		assert.deepEqual(report.available, {
			version: '4.1.2',
			publishedAt: '2026-09-15T00:00:00Z',
		});
	});
});

test('an in-place upgrade restarts the server on the new release while the entrypoint and held terminals live on', async () => {
	await withContainer({}, async (container) => {
		const { layout, imageRelease, port, holderFile, lines } = container;
		const main = container.start();
		const first = await container.ready('4.1.0');
		// The image's release serves its own UI and names its own upgrader.
		assert.equal(first.ui, `${imageRelease}/ui`);
		assert.equal(first.upgrader, `${imageRelease}/bin/terminay`);
		const serverBefore = Number(await readFile(layout.serverPidPath, 'utf8'));
		const holder = Number(await readFile(holderFile, 'utf8'));

		const before = await container.check();
		assert.equal(before.environment, 'container');
		assert.deepEqual(before.installed, {
			channel: 'tag',
			version: '4.1.0',
			revision: 'a'.repeat(40),
		});
		assert.equal(before.canUpgrade, true);
		assert.deepEqual(before.trigger, { kind: 'spawn' });
		assert.deepEqual(before.modes, ['in-place']);
		assert.equal(before.available.version, '4.1.2');

		const result = await container.upgrade('v4.1.1');
		assert.equal(result.from, '4.1.0');
		assert.equal(result.to, '4.1.1');

		const upgraded = await health(port);
		assert.equal(upgraded.version, '4.1.1');
		const stagedRoot = join(layout.versionsDirectory, '4.1.1');
		// The staged release serves its own UI, not the image's. This one was
		// published before archives carried an upgrader, so the image's is the
		// one it is given.
		assert.equal(upgraded.ui, `${stagedRoot}/ui`);
		assert.equal(upgraded.upgrader, `${imageRelease}/bin/terminay`);
		// The image's environment names the image's commit, which is no longer
		// what is running, so it is not handed on.
		assert.equal(first.revision, 'image-revision');
		assert.equal(upgraded.revision, undefined);
		assert.equal(
			(await readFile(layout.runningPath, 'utf8')).trim(),
			stagedRoot,
		);
		assert.equal(await readlink(layout.currentLink), 'versions/4.1.1');

		// The container did not restart: its main process is the same one, the
		// server is a new one, and the process the old server left holding
		// terminals is still running.
		assert.equal(main.child.exitCode, null);
		assert.equal(main.child.pid, main.pid);
		const serverAfter = Number(await readFile(layout.serverPidPath, 'utf8'));
		assert.notEqual(serverAfter, serverBefore);
		assert.equal(alive(serverBefore), false);
		assert.equal(alive(holder), true);

		assert.deepEqual(
			{ ...(await readUpgradeOutcome(layout.resultPath)), at: undefined },
			{
				schemaVersion: 1,
				from: '4.1.0',
				to: '4.1.1',
				outcome: 'succeeded',
				at: undefined,
			},
		);
		assert.equal(await readPendingUpgrade(layout), undefined);
		assert.equal(existsSync(layout.restartMarker), false);
		assert.match(lines.join('\n'), /Upgraded to 4\.1\.1/u);
		// Only release files and the upgrade's own records: nothing else in the
		// data root was created or opened.
		assert.deepEqual(await readdir(container.dataRoot), ['releases']);

		// A second upgrade follows the channel and keeps exactly one previous.
		await container.upgrade();
		const latest = await container.ready('4.1.2');
		assert.equal(
			latest.upgrader,
			`${join(layout.versionsDirectory, '4.1.2')}/bin/terminay`,
			'a release that carries an upgrader is upgraded by its own',
		);
		assert.deepEqual(await installedVersions(layout), ['4.1.1', '4.1.2']);
		assert.deepEqual((await readdir(layout.stagedDirectory)).sort(), [
			'4.1.1.json',
			'4.1.2.json',
		]);
		assert.equal((await container.check()).available, null);
		assert.equal((await container.check()).lastResult.to, '4.1.2');
		const again = await container.upgrade();
		assert.equal(again.upToDate, true);
		assert.equal(main.child.exitCode, null);

		// `docker stop`: the server shuts down and the container exits with its
		// status, even though a restart had been asked for before.
		const stopped = await container.stop(main);
		assert.deepEqual(stopped, { code: 0, signal: null });

		// `docker restart`, or a new container from the same old image on the
		// same volume: the upgraded release is the one that starts.
		const second = container.start();
		await container.ready('4.1.2');
		assert.equal((await runningRelease(layout)).staged, '4.1.2');
		assert.deepEqual(await container.stop(second), { code: 0, signal: null });

		// A newer image on that volume wins over what was staged.
		const pulled = await container.makeImage({
			version: '4.3.0',
			revision: 'f'.repeat(40),
		});
		const third = container.start([], pulled);
		await container.ready('4.3.0');
		assert.match(third.stderr, /skipping the staged release 4\.1\.2/u);
		await container.stop(third);
	});
});

test('a release that never reports ready is rolled back and the command fails', async () => {
	const releases = [
		{
			tag: 'v4.1.1',
			version: '4.1.1',
			revision: 'b'.repeat(40),
			latest: true,
			launcher: serverLauncher('4.1.1', 'never-ready'),
		},
	];
	await withContainer({ releases }, async (container) => {
		const { layout, imageRelease } = container;
		const main = container.start();
		await container.ready('4.1.0');

		const upgrading = container.upgrade(undefined, {
			dependencies: { readinessTimeoutMs: 1_500 },
		});
		// The new release is up and answering, but not ready; then the wait
		// for it reaches its deadline.
		await container.listening('4.1.1', false);
		container.timers.fire(await container.timers.armed(1_500));
		await assert.rejects(
			upgrading,
			(error) =>
				error instanceof UpgradeError &&
				/did not become ready/u.test(error.message) &&
				/4\.1\.0 was restored and is running again/u.test(error.message),
		);
		await container.ready('4.1.0');
		assert.equal(
			(await readFile(layout.runningPath, 'utf8')).trim(),
			imageRelease,
		);
		await assert.rejects(() => readlink(layout.currentLink));
		assert.equal(await readPendingUpgrade(layout), undefined);
		assert.equal(main.child.exitCode, null, 'the container must keep running');

		const outcome = await readUpgradeOutcome(layout.resultPath);
		assert.equal(outcome.outcome, 'rolled-back');
		assert.equal(outcome.from, '4.1.0');
		assert.equal(outcome.to, '4.1.1');
		assert.match(outcome.reason, /did not become ready/u);
		assert.equal((await container.check()).lastResult.outcome, 'rolled-back');
		await container.stop(main);
	});
});

test('a release that cannot start at all does not take the container down with it', async () => {
	const releases = [
		{
			tag: 'v4.1.1',
			version: '4.1.1',
			revision: 'b'.repeat(40),
			latest: true,
			launcher: serverLauncher('4.1.1', 'crash'),
		},
	];
	await withContainer({ releases }, async (container) => {
		const { layout } = container;
		const main = container.start();
		await container.ready('4.1.0');

		await assert.rejects(() => container.upgrade(), UpgradeError);
		// The entrypoint undid the upgrade itself the moment the new server
		// exited, and is still the container's main process.
		await container.ready('4.1.0');
		assert.equal(main.child.exitCode, null);
		assert.match(main.stderr, /4\.1\.1 exited with status 7/u);
		await assert.rejects(() => readlink(layout.currentLink));
		assert.equal(
			(await readUpgradeOutcome(layout.resultPath)).outcome,
			'rolled-back',
		);
		await container.stop(main);
	});
});

test('a server that exits without a requested restart ends the container with its status', async () => {
	await withContainer({}, async (container) => {
		const main = container.start();
		await container.ready('4.1.0');
		const server = Number(
			await readFile(container.layout.serverPidPath, 'utf8'),
		);
		process.kill(server, 'SIGKILL');
		assert.deepEqual(await main.exited, { code: 137, signal: null });
	});
});

test('a command that prints and exits passes straight through and leaves nothing behind', async () => {
	await withContainer({}, async (container) => {
		const once = container.start(['--version']);
		assert.deepEqual(await once.exited, { code: 0, signal: null });
		assert.equal(once.stdout, '4.1.0\n');
		assert.deepEqual(await readdir(container.dataRoot), []);
	});
});

test('the image command runs the CLI of the release the server is running', async () => {
	await withContainer({}, async (container) => {
		const { layout, imageRelease, env } = container;
		const run = (environment) =>
			new Promise((done) => {
				const child = spawn(SHELL, [COMMAND, '--help'], {
					env: { PATH: process.env.PATH, ...environment },
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				let stdout = '';
				child.stdout.on('data', (chunk) => {
					stdout += chunk;
				});
				child.on('close', (code) => done({ code, stdout }));
			});
		// Nothing recorded: the image's own.
		const fromImage = await run(env());
		assert.equal(fromImage.code, 0);
		assert.match(fromImage.stdout, /terminay daemon <command>/u);

		// The entrypoint recorded another release: that one's CLI runs.
		const other = join(container.directory, 'other');
		await mkdir(join(other, 'bin'), { recursive: true });
		await writeFile(
			join(other, 'bin/terminay'),
			'#!/bin/sh\necho other-release\n',
			{
				mode: 0o755,
			},
		);
		await mkdir(layout.prefix, { recursive: true });
		await writeFile(layout.runningPath, `${other}\n`);
		assert.equal((await run(env())).stdout, 'other-release\n');

		// A recorded release with no CLI falls back to the image's.
		await writeFile(
			layout.runningPath,
			`${join(container.directory, 'gone')}\n`,
		);
		assert.match((await run(env())).stdout, /terminay daemon <command>/u);
		assert.ok(imageRelease.length > 0);
	});
});
