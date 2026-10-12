import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseCommandLine } from '../dist/args.js';
import { runUpgradeCheck } from '../dist/commands/check.js';
import { NotInstalledError } from '../dist/context.js';
import { installUpgradeHelper } from '../dist/helper.js';
import { installLayout, writeInstallRecord } from '../dist/layout.js';
import { writeUpgradeOutcome } from '../dist/outcome.js';
import { createSystemd } from '../dist/systemd.js';
import { createFakeBin, writeExecutable } from './fake-bin.mjs';
import { startReleaseFixture } from './release-fixture.mjs';

const execFileAsync = promisify(execFile);
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');
const OPTIONS = { allowDowngrade: false, purge: false, yes: false, wait: true };

const TAGS = [
	{
		tag: 'v4.1.0',
		version: '4.1.0',
		revision: 'a'.repeat(40),
		publishedAt: '2026-09-01T00:00:00Z',
	},
	{
		tag: 'v4.1.1',
		version: '4.1.1',
		revision: 'b'.repeat(40),
		latest: true,
		publishedAt: '2026-09-08T00:00:00Z',
	},
];

const ROLLING = [
	{
		tag: 'main-latest',
		version: '0.0.0',
		assetVersion: 'main',
		channel: 'main',
		revision: 'd'.repeat(40),
		latest: true,
		publishedAt: '2026-10-02T00:00:00Z',
	},
];

/**
 * A machine with an install record and nothing else: the check reads the
 * record, the layout, and the release API, and none of that needs a running
 * service. `systemRoot` stands in for `/`, so a system-scope install can be
 * laid out by a test that is not root.
 */
async function withInstall(options, run) {
	const home = await mkdtemp(join(tmpdir(), 'terminay-check-'));
	const systemRoot = join(home, 'root');
	const fake = await createFakeBin();
	for (const tool of ['systemctl', 'journalctl', 'loginctl', 'sudo', 'chown'])
		fake.install(tool, '');
	const releases = await startReleaseFixture({
		directory: home,
		releases: options.releases ?? TAGS,
	});
	const scope = options.scope ?? 'user';
	const layout = installLayout(scope, home, systemRoot);
	// The helper hands its request directory to the run-as account with the
	// machine's own `chown`, which is reached through the process PATH.
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		await mkdir(layout.prefix, { recursive: true });
		await writeInstallRecord(layout, {
			schemaVersion: 1,
			scope,
			channel: 'tag',
			version: '4.1.0',
			revision: 'a'.repeat(40),
			runAs: 'ada',
			dataRoot: join(home, 'data'),
			projectRoot: home,
			port: 8443,
			healthPort: 8444,
			expose: 'hosted',
			hostedDomain: 'terminay.com',
			installedAt: '2026-09-01T00:00:00Z',
			...options.record,
		});
		const dependencies = {
			home,
			systemRoot,
			env: fake.env(),
			apiBase: releases.origin,
			webBase: releases.origin,
			architecture: 'x64',
		};
		await run({
			home,
			fake,
			layout,
			releases,
			dependencies,
			check: (overrides = {}) =>
				runUpgradeCheck(
					{ ...OPTIONS, scope },
					{ ...dependencies, ...overrides },
				),
		});
	} finally {
		process.env.PATH = originalPath;
		await releases.close();
		await fake.close();
		await rm(home, { recursive: true, force: true });
	}
}

/** The release the installed server carries its own upgrader in. */
async function shipUpgrader(layout) {
	writeExecutable(join(layout.currentLink, 'bin/terminay'), '#!/bin/sh\n');
}

test('--check is an upgrade flag, takes no reference, and stands alone', () => {
	const parsed = parseCommandLine(['daemon', 'upgrade', '--check', '--user']);
	assert.equal(parsed.command, 'upgrade');
	assert.equal(parsed.options.check, true);
	assert.equal(
		parseCommandLine(['daemon', 'upgrade']).options.check,
		undefined,
	);
	for (const argv of [
		['daemon', 'upgrade', 'v4.1.1', '--check'],
		['daemon', 'upgrade', '--check', '--allow-downgrade'],
		['daemon', 'upgrade', '--check', '--public-host', '192.168.1.20'],
		['daemon', 'install', '--check'],
		['daemon', 'status', '--check'],
	]) {
		assert.throws(() => parseCommandLine(argv), /--check/u, argv.join(' '));
	}
});

test('a newer tagged release is reported as available, in the documented shape', async () => {
	await withInstall({}, async ({ check }) => {
		const report = await check();
		assert.deepEqual(report, {
			schemaVersion: 1,
			environment: 'user',
			installed: {
				channel: 'tag',
				version: '4.1.0',
				revision: 'a'.repeat(40),
			},
			available: { version: '4.1.1', publishedAt: '2026-09-08T00:00:00Z' },
			canUpgrade: true,
			modes: ['in-place'],
			trigger: { kind: 'spawn' },
			unavailable: null,
			lastResult: null,
		});
		// The contract fixes the order as well as the members.
		assert.deepEqual(Object.keys(report), [
			'schemaVersion',
			'environment',
			'installed',
			'available',
			'canUpgrade',
			'modes',
			'trigger',
			'unavailable',
			'lastResult',
		]);
	});
});

test('an install already on the newest release has nothing available', async () => {
	await withInstall(
		{ record: { version: '4.1.1', revision: 'b'.repeat(40) } },
		async ({ check }) => {
			const report = await check();
			assert.equal(report.available, null);
			assert.equal(report.canUpgrade, true);
			assert.equal(report.checkError, undefined);
		},
	);
});

test('an install ahead of its channel is never offered an older release', async () => {
	await withInstall(
		{ record: { version: '4.2.0', revision: 'e'.repeat(40) } },
		async ({ check }) => {
			const report = await check();
			assert.equal(report.available, null);
			assert.equal(report.installed.version, '4.2.0');
			assert.equal(report.checkError, undefined);
		},
	);
});

test('a source install has no channel, so nothing is available and the reason says so', async () => {
	await withInstall(
		{ record: { channel: 'source', version: 'abc123def456' } },
		async ({ check }) => {
			// No release API at all: a source install must not even ask.
			const report = await check({
				apiBase: 'https://127.0.0.1:1',
				webBase: 'https://127.0.0.1:1',
			});
			assert.equal(report.available, null);
			assert.equal(report.canUpgrade, false);
			assert.match(report.unavailable.reason, /built from source/u);
			assert.match(
				report.unavailable.command,
				/daemon upgrade <branch-or-tag> --user$/u,
			);
			assert.equal(report.checkError, undefined);
		},
	);
});

test('unreachable release metadata is a checkError beside a complete description, not a failure', async () => {
	await withInstall({}, async ({ check }) => {
		const report = await check({
			apiBase: 'https://127.0.0.1:1',
			webBase: 'https://127.0.0.1:1',
		});
		assert.equal(typeof report.checkError, 'string');
		assert.ok(report.checkError.length > 0);
		// Everything else is still there, so the server keeps what it knew.
		assert.equal(report.available, null);
		assert.equal(report.environment, 'user');
		assert.equal(report.installed.version, '4.1.0');
		assert.equal(report.canUpgrade, true);
		assert.deepEqual(report.modes, ['in-place']);
		assert.deepEqual(report.trigger, { kind: 'spawn' });
		assert.equal(Object.keys(report).at(-1), 'checkError');
	});
});

test('a system install without the helper cannot upgrade itself and names the one command that fixes it', async () => {
	await withInstall({ scope: 'system' }, async ({ check, layout }) => {
		await shipUpgrader(layout);
		const report = await check();
		assert.equal(report.environment, 'system');
		assert.equal(report.canUpgrade, false);
		assert.deepEqual(report.trigger, { kind: 'spawn' });
		assert.deepEqual(report.available, {
			version: '4.1.1',
			publishedAt: '2026-09-08T00:00:00Z',
		});
		assert.match(report.unavailable.reason, /one manual upgrade/u);
		assert.match(report.unavailable.reason, /upgrade itself/u);
		assert.equal(
			report.unavailable.command,
			`sudo ${layout.currentLink}/bin/terminay daemon upgrade --system`,
		);
	});
});

test('a system install from before the archive carried a CLI is pointed at npx', async () => {
	await withInstall({ scope: 'system' }, async ({ check }) => {
		const report = await check();
		assert.equal(report.canUpgrade, false);
		assert.equal(
			report.unavailable.command,
			'sudo npx terminay daemon upgrade --system',
		);
	});
});

test('a system install with the helper is triggered through its request file', async () => {
	await withInstall({ scope: 'system' }, async ({ check, layout, fake }) => {
		await shipUpgrader(layout);
		await installUpgradeHelper({
			layout,
			runAs: 'ada',
			systemd: createSystemd({ scope: 'system', env: fake.env() }),
		});
		const before = fake.invocations().length;

		const report = await check();
		assert.equal(report.canUpgrade, true);
		assert.equal(report.unavailable, null);
		assert.deepEqual(report.trigger, {
			kind: 'request-file',
			path: layout.upgradeHelper.requestFile,
		});
		assert.ok(
			report.trigger.path.endsWith('/var/lib/terminay-upgrade/request'),
		);

		// The server runs this as an unprivileged account: it must reach for
		// no service tool and no privilege, only files anyone can read.
		assert.deepEqual(fake.invocations().slice(before), []);
		assert.equal((await stat(layout.recordPath)).mode & 0o044, 0o044);
	});
});

test('the rolling channel is ordered by when its archive was published', async () => {
	const record = {
		channel: 'main',
		version: '0.0.0',
		revision: 'c'.repeat(40),
	};
	await withInstall(
		{
			releases: ROLLING,
			record: { ...record, publishedAt: '2026-10-01T00:00:00Z' },
		},
		async ({ check }) => {
			const report = await check();
			assert.deepEqual(report.available, {
				version: 'main',
				publishedAt: '2026-10-02T00:00:00Z',
			});
		},
	);
	await withInstall(
		{
			releases: ROLLING,
			record: { ...record, publishedAt: '2026-10-02T00:00:00Z' },
		},
		async ({ check }) => assert.equal((await check()).available, null),
	);
});

test('a rolling install that never recorded a time is told apart by the commit in the published archive', async () => {
	// Nothing on the release names the commit, so the head of the archive is
	// read for it. A different commit is an upgrade; the same one is not.
	await withInstall(
		{
			releases: ROLLING,
			record: { channel: 'main', version: '0.0.0', revision: 'c'.repeat(40) },
		},
		async ({ check }) => {
			const report = await check();
			assert.deepEqual(report.available, {
				version: 'main',
				revision: 'd'.repeat(40),
				publishedAt: '2026-10-02T00:00:00Z',
			});
			assert.equal(report.checkError, undefined);
		},
	);
	await withInstall(
		{
			releases: ROLLING,
			record: { channel: 'main', version: '0.0.0', revision: 'd'.repeat(40) },
		},
		async ({ check }) => {
			const report = await check();
			assert.equal(report.available, null);
			assert.equal(report.checkError, undefined);
		},
	);
});

test('the last upgrade outcome is reported, and nothing private with it', async () => {
	await withInstall({}, async ({ check, layout }) => {
		await writeUpgradeOutcome(layout.resultPath, {
			from: '4.0.9',
			to: '4.1.0',
			outcome: 'rolled-back',
			reason: 'the upgrade to 4.1.0 did not become ready',
			at: '2026-09-02T00:00:00.000Z',
		});
		const report = await check();
		assert.deepEqual(report.lastResult, {
			from: '4.0.9',
			to: '4.1.0',
			outcome: 'rolled-back',
			reason: 'the upgrade to 4.1.0 did not become ready',
			at: '2026-09-02T00:00:00.000Z',
		});
		// Nothing in the whole line names where the server keeps its state or
		// which account it runs as.
		const line = JSON.stringify(report);
		assert.doesNotMatch(line, /"runAs"|"dataRoot"|"projectRoot"|ada/u);
	});
});

test('an unreadable outcome record reads as no attempt', async () => {
	await withInstall({}, async ({ check, layout }) => {
		await writeFile(layout.resultPath, '{ not json');
		assert.equal((await check()).lastResult, null);
	});
});

test('a machine with nothing installed cannot be described', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-check-empty-'));
	try {
		await assert.rejects(
			() =>
				runUpgradeCheck(
					{ ...OPTIONS, scope: 'user' },
					{ home, systemRoot: join(home, 'root'), architecture: 'x64' },
				),
			NotInstalledError,
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('with both scopes installed, the CLI inside an install describes that install', async () => {
	await withInstall({ scope: 'system' }, async ({ home, dependencies }) => {
		const user = installLayout('user', home);
		await mkdir(user.prefix, { recursive: true });
		await writeInstallRecord(user, {
			schemaVersion: 1,
			scope: 'user',
			channel: 'tag',
			version: '4.1.1',
			revision: 'b'.repeat(40),
			runAs: 'ada',
			dataRoot: join(home, 'user-data'),
			projectRoot: home,
			port: 8443,
			healthPort: 8444,
			expose: 'hosted',
			hostedDomain: 'terminay.com',
			installedAt: '2026-09-08T00:00:00Z',
		});
		const { resolveContext } = await import('../dist/context.js');
		const from = (self) =>
			resolveContext({
				options: OPTIONS,
				home,
				systemRoot: dependencies.systemRoot,
				self,
			});
		// No scope flag: the server does not know its scope, but the CLI it
		// runs lives under exactly one prefix.
		assert.equal(
			(await from(join(user.prefix, 'current/cli/terminay.mjs'))).layout.scope,
			'user',
		);
		assert.equal(
			(
				await from(
					join(
						dependencies.systemRoot,
						'opt/terminay/current/cli/terminay.mjs',
					),
				)
			).layout.scope,
			'system',
		);
		await assert.rejects(() => from('/usr/bin/terminay'), /Choose one/u);
	});
});

test('the binary prints exactly one line of JSON and exits zero, even with the release API unreachable', async (t) => {
	// On a host that is not a systemd Linux box the platform gate answers
	// first, which is its own behaviour and covered elsewhere.
	if (process.platform !== 'linux') return t.skip('requires a Linux host');
	await withInstall({}, async ({ home, fake }) => {
		const { stdout } = await execFileAsync(
			process.execPath,
			[CLI, 'daemon', 'upgrade', '--check', '--user'],
			{ env: { ...fake.env(), HOME: home } },
		);
		assert.equal(stdout.split('\n').filter(Boolean).length, 1);
		assert.equal(JSON.parse(stdout).schemaVersion, 1);
	});
});
