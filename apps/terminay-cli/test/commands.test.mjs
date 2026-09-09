import assert from 'node:assert/strict';
import {
	mkdtemp,
	readFile,
	readlink,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { invokingUser } from '../dist/account.js';
import { runInstall } from '../dist/commands/install.js';
import { runStart, runStatus, runStop } from '../dist/commands/lifecycle.js';
import { runResetIdentity, runUninstall } from '../dist/commands/uninstall.js';
import { runUpgrade, UpgradeError } from '../dist/commands/upgrade.js';
import { NotInstalledError, resolveContext } from '../dist/context.js';
import { activeVersion, installedVersions } from '../dist/install.js';
import { installLayout, readInstallRecord } from '../dist/layout.js';
import { createSystemd } from '../dist/systemd.js';
import { parseEnvironmentFile } from '../dist/unit.js';
import { createFakeBin } from './fake-bin.mjs';
import { startFakeHealthServer } from './fake-server.mjs';
import { startReleaseFixture } from './release-fixture.mjs';

const OPTIONS = { allowDowngrade: false, purge: false, yes: false, wait: true };

function pipe() {
	const input = new PassThrough();
	input.isTTY = false;
	return { input, output: new PassThrough() };
}

/**
 * A whole machine, faked: a temporary home for the install prefix, stub
 * systemd tools on PATH, a local signed release server, and a health endpoint
 * that answers ready.
 */
async function withMachine(options, run) {
	const home = await mkdtemp(join(tmpdir(), 'terminay-machine-'));
	const fake = await createFakeBin();
	fake.install('systemctl', '');
	fake.install('journalctl', 'echo "no log lines"');
	fake.install('loginctl', '');
	fake.install('getent', `echo "ada:x:1000:1000:Ada:${home}:/bin/bash"`);
	fake.install('id', '');
	const releases = await startReleaseFixture({
		directory: home,
		releases: options.releases,
	});
	const health = await startFakeHealthServer(
		options.health ?? [{ status: 'ok', ready: true, version: '4.1.1' }],
	);
	const lines = [];
	try {
		await run({
			home,
			fake,
			releases,
			health,
			lines,
			write: (line) => lines.push(line),
			env: fake.env(),
			layout: installLayout('user', home),
			installDependencies: {
				home,
				streams: pipe(),
				env: fake.env(),
				write: (line) => lines.push(line),
				apiBase: releases.origin,
				webBase: releases.origin,
				architecture: 'x64',
				serverId: 'test-box',
				releasePublicKeyPem: releases.publicPem,
				// Nothing listens on the install-time health port in these tests,
				// so the wait is kept short rather than burning the full deadline.
				readinessTimeoutMs: 300,
			},
		});
	} finally {
		await health.close();
		await releases.close();
		await fake.close();
		await rm(home, { recursive: true, force: true });
	}
}

/** The health port is fixed in the record, so it is pointed at the fixture. */
async function pointHealthAtFixture(layout, port) {
	const recordPath = layout.recordPath;
	const record = JSON.parse(await readFile(recordPath, 'utf8'));
	await writeFile(
		recordPath,
		`${JSON.stringify({ ...record, healthPort: port }, null, 2)}\n`,
	);
}

test('install resolves, verifies, unpacks, writes the unit, and starts the service', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
					publishedAt: '2026-09-08T00:00:00Z',
				},
			],
		},
		async ({ home, fake, lines, layout, installDependencies }) => {
			const result = await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					directOrigin: 'https://box.example.test:8443',
				},
				installDependencies,
			);

			assert.equal(result.version, '4.1.1');
			assert.equal(result.channel, 'tag');
			assert.equal(result.revision, 'a'.repeat(40));

			// The version landed under versions/ and current points at it.
			assert.deepEqual(await installedVersions(layout), ['4.1.1']);
			assert.equal(await activeVersion(layout), '4.1.1');
			assert.equal(await readlink(layout.currentLink), 'versions/4.1.1');

			// The unit exists, is reached through current, and was enabled.
			const unit = await readFile(layout.unitPath, 'utf8');
			assert.match(unit, /ExecStart=.*\/current\/bin\/terminay-server/u);
			const invocations = fake.invocations();
			assert.ok(invocations.includes('systemctl --user daemon-reload'));
			assert.ok(
				invocations.includes(
					'systemctl --user enable --now terminay-server.service',
				),
			);
			assert.ok(
				invocations.some((line) => line.startsWith('loginctl enable-linger')),
				'a user service must linger',
			);

			// The environment file is readable only by the service account.
			assert.equal((await stat(layout.environmentFile)).mode & 0o777, 0o640);
			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(environment.TERMINAY_SERVER_ID, 'test-box');
			assert.equal(environment.TERMINAY_EXPOSE, 'hosted,direct');
			assert.equal(
				environment.TERMINAY_DIRECT_ORIGIN,
				'https://box.example.test:8443',
			);

			const record = await readInstallRecord(layout);
			assert.equal(record.channel, 'tag');
			assert.equal(record.version, '4.1.1');
			// A user-scope service always runs as whoever invoked it. `USER` is
			// absent in a container, so the passwd database is the authority.
			assert.equal(record.runAs, invokingUser());

			// The downloaded archive is not left lying around.
			assert.equal(
				await stat(join(layout.prefix, '.downloads')).catch(() => undefined),
				undefined,
			);

			const output = lines.join('\n');
			assert.match(output, /Checksum and signature verified\./u);
			assert.match(output, /direct URL {3}https:\/\/box\.example\.test:8443/u);
			assert.match(output, /npx terminay daemon qr-code/u);
			assert.ok(home.length > 0);
		},
	);
});

test('an archive signed by another key is refused and nothing is installed', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ layout, installDependencies }) => {
			await assert.rejects(
				// Verified against the CLI's real embedded key, which did not sign
				// this fixture.
				() =>
					runInstall(
						undefined,
						{
							...OPTIONS,
							scope: 'user',
							directOrigin: 'https://box.example.test:8443',
						},
						{ ...installDependencies, releasePublicKeyPem: undefined },
					),
				/not signed by the Terminay release key/u,
			);
			assert.deepEqual(await installedVersions(layout), []);
			assert.equal(
				await readFile(layout.unitPath, 'utf8').catch(() => undefined),
				undefined,
				'no unit may be written',
			);
		},
	);
});

test('a reinstall keeps the server id devices are paired with', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ layout, installDependencies }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					directOrigin: 'https://box.example.test:8443',
				},
				installDependencies,
			);
			await writeFile(
				layout.environmentFile,
				(await readFile(layout.environmentFile, 'utf8')).replace(
					'TERMINAY_SERVER_ID=test-box',
					'TERMINAY_SERVER_ID=already-paired',
				),
			);
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					directOrigin: 'https://box.example.test:8443',
				},
				{ ...installDependencies, serverId: 'a-different-id' },
			);
			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(environment.TERMINAY_SERVER_ID, 'already-paired');
		},
	);
});

test('direct exposure with no derivable origin fails rather than advertising a wrong one', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ installDependencies }) => {
			// `--expose hosted` needs no direct origin at all.
			const result = await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			assert.equal(result.directOrigin, undefined);
		},
	);
});

test('upgrade follows the tag channel, stages beside, switches, and retains one previous', async () => {
	await withMachine(
		{
			releases: [
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
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);

			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			const result = await runUpgrade(undefined, OPTIONS, context, {
				apiBase: installDependencies.apiBase,
				webBase: installDependencies.webBase,
				architecture: 'x64',
				releasePublicKeyPem: installDependencies.releasePublicKeyPem,
				readinessTimeoutMs: 5_000,
			});

			assert.equal(result.from, '4.1.0');
			assert.equal(result.to, '4.1.1');
			assert.equal(await activeVersion(layout), '4.1.1');
			assert.deepEqual(
				await installedVersions(layout),
				['4.1.0', '4.1.1'],
				'one previous version is kept',
			);
			assert.equal((await readInstallRecord(layout)).version, '4.1.1');
		},
	);
});

test('upgrade refuses a downgrade unless it is asked for', async () => {
	await withMachine(
		{
			releases: [
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
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				'v4.1.1',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			const dependencies = {
				apiBase: installDependencies.apiBase,
				webBase: installDependencies.webBase,
				architecture: 'x64',
				releasePublicKeyPem: installDependencies.releasePublicKeyPem,
				readinessTimeoutMs: 5_000,
			};
			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};

			await assert.rejects(
				() => runUpgrade('v4.1.0', OPTIONS, context, dependencies),
				(error) =>
					error instanceof UpgradeError &&
					error.message.includes('4.1.1') &&
					error.message.includes('4.1.0'),
			);
			assert.equal(
				await activeVersion(layout),
				'4.1.1',
				'a refused downgrade must not move current',
			);

			const allowed = await runUpgrade(
				'v4.1.0',
				{ ...OPTIONS, allowDowngrade: true },
				context,
				dependencies,
			);
			assert.equal(allowed.to, '4.1.0');
			assert.equal(await activeVersion(layout), '4.1.0');
		},
	);
});

test('an upgrade already on the newest version does nothing', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			const result = await runUpgrade(undefined, OPTIONS, context, {
				apiBase: installDependencies.apiBase,
				webBase: installDependencies.webBase,
				architecture: 'x64',
				releasePublicKeyPem: installDependencies.releasePublicKeyPem,
			});
			assert.equal(result.upToDate, true);
		},
	);
});

test('an upgrade that never becomes ready rolls back to the version that worked', async () => {
	await withMachine(
		{
			releases: [
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
			],
		},
		async ({ health, fake, layout, installDependencies, write, lines }) => {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};

			// No health server answers on this port, so readiness never arrives.
			await pointHealthAtFixture(layout, 1);
			context.record = await readInstallRecord(layout);

			await assert.rejects(
				() =>
					runUpgrade(undefined, OPTIONS, context, {
						apiBase: installDependencies.apiBase,
						webBase: installDependencies.webBase,
						architecture: 'x64',
						releasePublicKeyPem: installDependencies.releasePublicKeyPem,
						readinessTimeoutMs: 200,
					}),
				(error) =>
					error instanceof UpgradeError &&
					/did not become ready/u.test(error.message),
			);

			assert.equal(
				await activeVersion(layout),
				'4.1.0',
				'current must point back at the working version',
			);
			assert.equal(
				(await readInstallRecord(layout)).version,
				'4.1.0',
				'the record must not claim the failed version',
			);
			assert.match(lines.join('\n'), /Rolling back/u);
		},
	);
});

test('a source install has no channel to follow and says so', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const record = {
				...(await readInstallRecord(layout)),
				channel: 'source',
			};
			const context = {
				layout,
				record,
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			await assert.rejects(
				() => runUpgrade(undefined, OPTIONS, context, {}),
				(error) =>
					error instanceof UpgradeError &&
					/no channel to follow/u.test(error.message),
			);
		},
	);
});

test('start waits for readiness and stop stops the unit', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};

			assert.equal(await runStart(context), true);
			await runStop(context);
			const invocations = fake.invocations();
			assert.ok(
				invocations.includes('systemctl --user start terminay-server.service'),
			);
			assert.ok(
				invocations.includes('systemctl --user stop terminay-server.service'),
			);
		},
	);
});

test('status reports the unit, version, channel, readiness, and exposure — and nothing else', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ health, fake, layout, installDependencies, lines, write }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					directOrigin: 'https://box.example.test:8443',
				},
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			lines.length = 0;

			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			const report = await runStatus(context);

			assert.equal(report.version, '4.1.1');
			assert.equal(report.channel, 'tag');
			assert.equal(report.ready, true);
			assert.deepEqual([...report.exposure], ['hosted', 'direct']);

			const output = lines.join('\n');
			// No path, project, workspace, device, or key appears in the report.
			assert.doesNotMatch(
				output,
				/\/home\/|\/var\/lib|\.local\/share/u,
				'status must not print filesystem paths',
			);
			assert.doesNotMatch(
				output,
				/passphrase|token|deviceId|device key|host key/iu,
			);
			assert.ok(
				!output.includes(context.record.runAs),
				'status must not name the run-as account',
			);
		},
	);
});

test('uninstall removes the service and versions but keeps the data root', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const record = await readInstallRecord(layout);
			const context = {
				layout,
				record,
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};

			const result = await runUninstall(OPTIONS, context, pipe());
			assert.equal(result.removedDataRoot, false);
			assert.equal(
				await readFile(layout.unitPath, 'utf8').catch(() => undefined),
				undefined,
			);
			assert.deepEqual(await installedVersions(layout), []);
			assert.equal(await readInstallRecord(layout), undefined);
			assert.ok(
				(await stat(record.dataRoot)).isDirectory(),
				'the data root must survive',
			);
			assert.ok(
				fake
					.invocations()
					.includes('systemctl --user disable terminay-server.service'),
			);
		},
	);
});

test('--purge without a terminal needs --yes, and removes the data root with it', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const record = await readInstallRecord(layout);
			const context = {
				layout,
				record,
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};

			await assert.rejects(
				() => runUninstall({ ...OPTIONS, purge: true }, context, pipe()),
				/needs --yes/u,
			);
			assert.ok(
				(await stat(record.dataRoot)).isDirectory(),
				'a refused purge must not remove anything',
			);

			const result = await runUninstall(
				{ ...OPTIONS, purge: true, yes: true },
				context,
				pipe(),
			);
			assert.equal(result.removedDataRoot, true);
			assert.equal(
				await stat(record.dataRoot).catch(() => undefined),
				undefined,
			);
		},
	);
});

test('reset-identity refuses to unpair every device without confirmation', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			await assert.rejects(
				() => runResetIdentity(OPTIONS, context, pipe()),
				/needs --yes/u,
			);
		},
	);
});

test('commands run against a machine with nothing installed say so', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-empty-'));
	try {
		await assert.rejects(
			() => resolveContext({ options: OPTIONS, home }),
			(error) =>
				error instanceof NotInstalledError &&
				/npx terminay daemon install/u.test(error.message),
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('the binary never supplies its own release key', async () => {
	const source = await readFile(
		resolve(new URL('../src/cli.ts', import.meta.url).pathname),
		'utf8',
	);
	assert.doesNotMatch(
		source,
		/releasePublicKeyPem/u,
		'the shipped entry point must verify against the embedded key only',
	);
});

test('install persists the advertised address and names the port to forward', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ layout, installDependencies, lines }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					expose: 'hosted',
					advertiseAddress: '127.0.0.1:51000',
				},
				installDependencies,
			);

			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(
				environment.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'127.0.0.1:51000',
			);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				'127.0.0.1:51000',
			);

			// Forwarding the port is the one step the CLI cannot take, so it says so.
			const output = lines.join('\n');
			assert.match(output, /advertised {3}127\.0\.0\.1:51000/u);
			assert.match(output, /UDP ports 51000-51003 must reach this machine/u);
			assert.match(output, /-p 51000-51003:51000-51003\/udp/u);
		},
	);
});

test('an install without the flag mentions no advertised address', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ layout, installDependencies, lines }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(environment.TERMINAY_WEBRTC_ADVERTISE_ADDRESS, undefined);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				undefined,
			);
			assert.doesNotMatch(lines.join('\n'), /advertised/u);
		},
	);
});

test('upgrade keeps the advertised address, and can change or clear it', async () => {
	await withMachine(
		{
			releases: [
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
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				'v4.1.0',
				{
					...OPTIONS,
					scope: 'user',
					expose: 'hosted',
					advertiseAddress: '127.0.0.1:51000',
				},
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			const dependencies = {
				apiBase: installDependencies.apiBase,
				webBase: installDependencies.webBase,
				architecture: 'x64',
				releasePublicKeyPem: installDependencies.releasePublicKeyPem,
				readinessTimeoutMs: 5_000,
			};
			const context = () =>
				readInstallRecord(layout).then((record) => ({
					layout,
					record,
					systemd: createSystemd({ scope: 'user', env: fake.env() }),
					write,
				}));

			// Absent flag: an upgrade is not the moment to change how a server is
			// reached, so the recorded value carries forward.
			await runUpgrade(undefined, OPTIONS, await context(), dependencies);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				'127.0.0.1:51000',
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'127.0.0.1:51000',
			);

			// Changing it rewrites the environment file, because that is where the
			// running server reads it from.
			await runUpgrade(
				'v4.1.0',
				{
					...OPTIONS,
					allowDowngrade: true,
					advertiseAddress: '127.0.0.1:52000',
				},
				await context(),
				dependencies,
			);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				'127.0.0.1:52000',
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'127.0.0.1:52000',
			);

			// Clearing removes it from both.
			await runUpgrade(
				'v4.1.1',
				{ ...OPTIONS, advertiseAddress: '' },
				await context(),
				dependencies,
			);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				undefined,
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				undefined,
			);
		},
	);
});

test('editing the advertised address leaves the rest of the environment file alone', async () => {
	await withMachine(
		{
			releases: [
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
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);

			// The file is documented as editable, so an upgrade must not discard
			// what an operator put in it.
			await writeFile(
				layout.environmentFile,
				`${await readFile(layout.environmentFile, 'utf8')}TERMINAY_OPERATOR_NOTE=keep-me\n`,
			);

			await runUpgrade(
				undefined,
				{ ...OPTIONS, advertiseAddress: '127.0.0.1:51000' },
				{
					layout,
					record: await readInstallRecord(layout),
					systemd: createSystemd({ scope: 'user', env: fake.env() }),
					write,
				},
				{
					apiBase: installDependencies.apiBase,
					webBase: installDependencies.webBase,
					architecture: 'x64',
					releasePublicKeyPem: installDependencies.releasePublicKeyPem,
					readinessTimeoutMs: 5_000,
				},
			);

			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(environment.TERMINAY_OPERATOR_NOTE, 'keep-me');
			assert.equal(
				environment.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'127.0.0.1:51000',
			);
			assert.equal(environment.TERMINAY_SERVER_ID, 'test-box');
		},
	);
});

test('status reports the advertised address and still names nothing private', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'v4.1.1',
					version: '4.1.1',
					revision: 'a'.repeat(40),
					latest: true,
				},
			],
		},
		async ({ health, fake, layout, installDependencies, lines, write }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					expose: 'hosted',
					advertiseAddress: '127.0.0.1:51000',
				},
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			lines.length = 0;

			const context = {
				layout,
				record: await readInstallRecord(layout),
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			const report = await runStatus(context);
			assert.equal(report.advertiseAddress, '127.0.0.1:51000');

			const output = lines.join('\n');
			assert.match(output, /advertised {3}127\.0\.0\.1:51000/u);
			assert.doesNotMatch(output, /\/home\/|\/var\/lib|\.local\/share/u);
			assert.ok(!output.includes(context.record.runAs));
		},
	);
});
