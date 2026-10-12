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
import { upgradeHelperInstalled } from '../dist/helper.js';
import { activeVersion, installedVersions } from '../dist/install.js';
import { installLayout, readInstallRecord } from '../dist/layout.js';
import { readUpgradeOutcome } from '../dist/outcome.js';
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
	// A machine with nothing installed yet: `is-active` answers "inactive" by
	// exiting non-zero, as the real tool does. A test that wants a running
	// service reinstalls this stub.
	fake.install(
		'systemctl',
		'case " $* " in *" is-active "*) echo inactive; exit 3;; esac',
	);
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

test('uninstall ends terminal sessions after stopping the service and before removing the server', async () => {
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
		async ({ home, fake, layout, installDependencies, write }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const record = await readInstallRecord(layout);
			const serverLog = join(home, 'server-invocations.log');
			const systemd = createSystemd({ scope: 'user', env: fake.env() });
			// Record what the fixture server is asked to do, and when systemd was
			// asked to stop, in one ordered list.
			const order = [];
			const context = {
				layout,
				record,
				systemd: {
					...systemd,
					stop: async () => {
						order.push('stop');
						return systemd.stop();
					},
					disable: async () => {
						order.push(
							...(await readFile(serverLog, 'utf8').catch(() => ''))
								.split('\n')
								.filter(Boolean)
								.map((line) => `server ${line}`),
						);
						order.push('disable');
						return systemd.disable();
					},
				},
				write,
			};

			const previous = process.env.TERMINAY_FIXTURE_SERVER_LOG;
			process.env.TERMINAY_FIXTURE_SERVER_LOG = serverLog;
			try {
				await runUninstall(OPTIONS, context, pipe());
			} finally {
				if (previous === undefined)
					delete process.env.TERMINAY_FIXTURE_SERVER_LOG;
				else process.env.TERMINAY_FIXTURE_SERVER_LOG = previous;
			}

			// A stopped server no longer holds the sessions, so they can be ended;
			// and it is ended while the server binary still exists to do it.
			assert.deepEqual(order, ['stop', 'server end-sessions', 'disable']);
			assert.deepEqual(await installedVersions(layout), []);
		},
	);
});

test('uninstall still completes when the installed server cannot end sessions', async () => {
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
		async ({ fake, layout, installDependencies, write, lines }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			const record = await readInstallRecord(layout);
			// A server from before the command existed, or one that is broken.
			await rm(layout.currentLink, { force: true });
			const context = {
				layout,
				record,
				systemd: createSystemd({ scope: 'user', env: fake.env() }),
				write,
			};
			const result = await runUninstall(OPTIONS, context, pipe());
			assert.equal(result.removedVersions, true);
			assert.equal(await readInstallRecord(layout), undefined);
			assert.ok(
				lines.some((line) =>
					/Could not end running terminal sessions/u.test(line),
				),
				'the operator must be told sessions may still be running',
			);
		},
	);
});

test('upgrade repairs a unit written before terminals outlived the server, before it stops it', async () => {
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

			// The unit as an earlier release wrote it: stopping it ends the whole
			// control group, and with it every held shell.
			const installed = await readFile(layout.unitPath, 'utf8');
			assert.match(installed, /^KillMode=process$/mu);
			await writeFile(
				layout.unitPath,
				installed.replace('KillMode=process\n', ''),
			);
			const before = fake.invocations().length;

			await runUpgrade(
				undefined,
				OPTIONS,
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

			assert.match(
				await readFile(layout.unitPath, 'utf8'),
				/^KillSignal=SIGTERM\nKillMode=process$/mu,
			);
			const calls = fake.invocations().slice(before);
			const reload = calls.indexOf('systemctl --user daemon-reload');
			const stop = calls.indexOf(
				'systemctl --user stop terminay-server.service',
			);
			assert.ok(reload >= 0, 'systemd must be told the unit changed');
			assert.ok(
				stop > reload,
				'the stop must already honour the new kill mode',
			);
			assert.ok(
				lines.some((line) =>
					/terminals keep running across restarts/u.test(line),
				),
			);
			assert.equal(await activeVersion(layout), '4.1.1');
		},
	);
});

test('upgrade leaves a unit that already names a kill mode alone', async () => {
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
			const unit = await readFile(layout.unitPath, 'utf8');
			const before = fake.invocations().length;

			await runUpgrade(
				undefined,
				OPTIONS,
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

			assert.equal(await readFile(layout.unitPath, 'utf8'), unit);
			assert.equal(
				fake
					.invocations()
					.slice(before)
					.includes('systemctl --user daemon-reload'),
				false,
				'an unchanged unit needs no reload',
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
					advertiseAddress: '192.168.1.20:51000',
				},
				installDependencies,
			);

			const environment = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(
				environment.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'192.168.1.20:51000',
			);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				'192.168.1.20:51000',
			);

			// Forwarding the port is the one step the CLI cannot take, so it says so.
			const output = lines.join('\n');
			assert.match(output, /advertised {3}192\.168\.1\.20:51000/u);
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
					advertiseAddress: '192.168.1.20:51000',
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
				'192.168.1.20:51000',
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'192.168.1.20:51000',
			);

			// Changing it rewrites the environment file, because that is where the
			// running server reads it from.
			await runUpgrade(
				'v4.1.0',
				{
					...OPTIONS,
					allowDowngrade: true,
					advertiseAddress: '192.168.1.20:52000',
				},
				await context(),
				dependencies,
			);
			assert.equal(
				(await readInstallRecord(layout)).advertiseAddress,
				'192.168.1.20:52000',
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'192.168.1.20:52000',
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
				{ ...OPTIONS, advertiseAddress: '192.168.1.20:51000' },
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
				'192.168.1.20:51000',
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
					advertiseAddress: '192.168.1.20:51000',
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
			assert.equal(report.advertiseAddress, '192.168.1.20:51000');

			const output = lines.join('\n');
			assert.match(output, /advertised {3}192\.168\.1\.20:51000/u);
			assert.doesNotMatch(output, /\/home\/|\/var\/lib|\.local\/share/u);
			assert.ok(!output.includes(context.record.runAs));
		},
	);
});

test('upgrade repairs an install whose environment predates the renderer directory', async () => {
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

			// An environment written before this change: the local UI bundle only.
			// Such a server pairs a device and then serves a placeholder, and the
			// symptom gives no hint that an upgrade is the remedy.
			const original = await readFile(layout.environmentFile, 'utf8');
			await writeFile(
				layout.environmentFile,
				original
					.split('\n')
					.filter((line) => !line.startsWith('TERMINAY_UI_RENDERER_DIRECTORY='))
					.join('\n'),
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_UI_RENDERER_DIRECTORY,
				undefined,
			);

			lines.length = 0;
			await runUpgrade(
				undefined,
				OPTIONS,
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

			const repaired = parseEnvironmentFile(
				await readFile(layout.environmentFile, 'utf8'),
			);
			assert.equal(
				repaired.TERMINAY_UI_RENDERER_DIRECTORY,
				repaired.TERMINAY_UI_BUNDLE,
				'the upgrade must name the workspace UI the server reads',
			);
			assert.match(lines.join('\n'), /workspace UI directory/u);
		},
	);
});

test('upgrade leaves an already-correct environment alone', async () => {
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
			const before = await readFile(layout.environmentFile, 'utf8');

			lines.length = 0;
			await runUpgrade(
				undefined,
				OPTIONS,
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

			assert.equal(await readFile(layout.environmentFile, 'utf8'), before);
			assert.doesNotMatch(lines.join('\n'), /workspace UI directory/u);
		},
	);
});

test('re-installing over a running service restarts it onto what was just written', async () => {
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
		async ({ fake, layout, installDependencies }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					advertiseAddress: '192.168.1.20:51000',
				},
				installDependencies,
			);

			// The machine now has a running service. `enable --now` would start a
			// stopped unit and do nothing to this one, leaving the operator reading
			// a new advertised address in this command's output while the process
			// serves the old one.
			fake.install('systemctl', '');
			const before = fake.invocations().length;

			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					advertiseAddress: '192.168.1.20:52000',
				},
				installDependencies,
			);

			const second = fake.invocations().slice(before);
			assert.ok(
				second.includes('systemctl --user restart terminay-server.service'),
				'a running service must be restarted onto the new configuration',
			);
			assert.equal(
				parseEnvironmentFile(await readFile(layout.environmentFile, 'utf8'))
					.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
				'192.168.1.20:52000',
			);
		},
	);
});

test('a first install on a machine with no service starts it the usual way', async () => {
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
		async ({ fake, installDependencies }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user' },
				installDependencies,
			);

			const invocations = fake.invocations();
			assert.ok(
				invocations.includes(
					'systemctl --user enable --now terminay-server.service',
				),
			);
			assert.ok(
				!invocations.includes(
					'systemctl --user restart terminay-server.service',
				),
				'nothing is running yet, so there is nothing to restart',
			);
		},
	);
});

const PUBLIC_HOST_RELEASES = [
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

/** How the server is reached, as the service reads it and as the CLI recalls it. */
async function reachability(layout) {
	const environment = parseEnvironmentFile(
		await readFile(layout.environmentFile, 'utf8'),
	);
	const record = await readInstallRecord(layout);
	return {
		environment: {
			publicHost: environment.TERMINAY_PUBLIC_HOST,
			directOrigin: environment.TERMINAY_DIRECT_ORIGIN,
			advertiseAddress: environment.TERMINAY_WEBRTC_ADVERTISE_ADDRESS,
		},
		record: {
			publicHost: record.publicHost,
			directOrigin: record.directOrigin,
			advertiseAddress: record.advertiseAddress,
		},
	};
}

test('one public host configures the direct origin and the advertised address', async () => {
	await withMachine(
		{ releases: PUBLIC_HOST_RELEASES },
		async ({ layout, installDependencies, lines }) => {
			const result = await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', publicHost: '192.168.2.218' },
				installDependencies,
			);
			const expected = {
				publicHost: '192.168.2.218',
				directOrigin: 'https://192.168.2.218:8443',
				advertiseAddress: '192.168.2.218:51000',
			};
			assert.deepEqual(await reachability(layout), {
				environment: expected,
				record: expected,
			});
			assert.equal(result.publicHost, '192.168.2.218');

			// Both derived values are named, and so are the ports to open.
			const output = lines.join('\n');
			assert.match(output, /public host {2}192\.168\.2\.218/u);
			assert.match(output, /direct URL {3}https:\/\/192\.168\.2\.218:8443/u);
			assert.match(output, /advertised {3}192\.168\.2\.218:51000/u);
			assert.match(output, /UDP ports 51000-51003 must reach this machine/u);
			assert.doesNotMatch(output, /routable literal address/u);
		},
	);
});

test('a public host that is a name derives the direct origin only and says what is missing', async () => {
	await withMachine(
		{ releases: PUBLIC_HOST_RELEASES },
		async ({ layout, installDependencies, lines }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', publicHost: 'box.example.com' },
				installDependencies,
			);
			const expected = {
				publicHost: 'box.example.com',
				directOrigin: 'https://box.example.com:8443',
				advertiseAddress: undefined,
			};
			assert.deepEqual(await reachability(layout), {
				environment: expected,
				record: expected,
			});
			const output = lines.join('\n');
			assert.match(output, /direct URL {3}https:\/\/box\.example\.com:8443/u);
			assert.match(
				output,
				/Browsers and phones need a routable literal address/u,
			);
			assert.doesNotMatch(output, /advertised {3}|UDP ports/u);
		},
	);
});

test('a loopback public host derives the direct origin only', async () => {
	await withMachine(
		{ releases: PUBLIC_HOST_RELEASES },
		async ({ layout, installDependencies, lines }) => {
			await runInstall(
				undefined,
				{ ...OPTIONS, scope: 'user', publicHost: '127.0.0.1' },
				installDependencies,
			);
			const { environment } = await reachability(layout);
			assert.equal(environment.directOrigin, 'https://127.0.0.1:8443');
			assert.equal(environment.advertiseAddress, undefined);
			assert.match(
				lines.join('\n'),
				/Browsers and phones need a routable literal address/u,
			);
		},
	);
});

test('an explicit direct origin or advertised address wins over the one a public host derives', async () => {
	await withMachine(
		{ releases: PUBLIC_HOST_RELEASES },
		async ({ layout, installDependencies }) => {
			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					publicHost: '192.168.2.218',
					directOrigin: 'https://box.example.com:8443',
				},
				installDependencies,
			);
			const origin = {
				publicHost: '192.168.2.218',
				directOrigin: 'https://box.example.com:8443',
				advertiseAddress: '192.168.2.218:51000',
			};
			assert.deepEqual(await reachability(layout), {
				environment: origin,
				record: origin,
			});

			await runInstall(
				undefined,
				{
					...OPTIONS,
					scope: 'user',
					publicHost: '192.168.2.218',
					advertiseAddress: '203.0.113.7:52000',
				},
				installDependencies,
			);
			const advertised = {
				publicHost: '192.168.2.218',
				directOrigin: 'https://192.168.2.218:8443',
				advertiseAddress: '203.0.113.7:52000',
			};
			assert.deepEqual(await reachability(layout), {
				environment: advertised,
				record: advertised,
			});
		},
	);
});

test('upgrade keeps the recorded public host, and can be given a new one', async () => {
	await withMachine(
		{ releases: PUBLIC_HOST_RELEASES },
		async ({ health, fake, layout, installDependencies, write, lines }) => {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'user', publicHost: '192.168.2.218' },
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
			const restarts = () =>
				fake.invocations().filter((line) => line.includes(' restart ')).length;

			// Absent flag: the host and everything it derived carry forward.
			const before = restarts();
			await runUpgrade(undefined, OPTIONS, await context(), dependencies);
			const kept = {
				publicHost: '192.168.2.218',
				directOrigin: 'https://192.168.2.218:8443',
				advertiseAddress: '192.168.2.218:51000',
			};
			assert.equal((await readInstallRecord(layout)).version, '4.1.1');
			assert.deepEqual(await reachability(layout), {
				environment: kept,
				record: kept,
			});
			assert.equal(restarts(), before, 'nothing changed, so no extra restart');

			// A new host re-derives both, and the service is restarted onto them.
			lines.length = 0;
			await runUpgrade(
				'v4.1.0',
				{ ...OPTIONS, allowDowngrade: true, publicHost: '10.0.0.5' },
				await context(),
				dependencies,
			);
			const moved = {
				publicHost: '10.0.0.5',
				directOrigin: 'https://10.0.0.5:8443',
				advertiseAddress: '10.0.0.5:51000',
			};
			assert.deepEqual(await reachability(layout), {
				environment: moved,
				record: moved,
			});
			assert.equal(restarts(), before + 1);
			const output = lines.join('\n');
			assert.match(output, /public host {2}10\.0\.0\.5/u);
			assert.match(output, /direct URL {3}https:\/\/10\.0\.0\.5:8443/u);
			assert.match(output, /advertised {3}10\.0\.0\.5:51000/u);
			assert.match(output, /UDP ports 51000-51003 must reach this machine/u);

			// An advertised address given beside it wins for that one setting.
			await runUpgrade(
				'v4.1.1',
				{
					...OPTIONS,
					publicHost: '10.0.0.6',
					advertiseAddress: '203.0.113.7:52000',
				},
				await context(),
				dependencies,
			);
			const explicit = {
				publicHost: '10.0.0.6',
				directOrigin: 'https://10.0.0.6:8443',
				advertiseAddress: '203.0.113.7:52000',
			};
			assert.deepEqual(await reachability(layout), {
				environment: explicit,
				record: explicit,
			});

			// A name derives the direct origin only and says what is missing.
			lines.length = 0;
			await runUpgrade(
				'v4.1.0',
				{ ...OPTIONS, allowDowngrade: true, publicHost: 'box.example.com' },
				await context(),
				dependencies,
			);
			const named = await reachability(layout);
			assert.equal(named.record.publicHost, 'box.example.com');
			assert.equal(
				named.environment.directOrigin,
				'https://box.example.com:8443',
			);
			assert.match(
				lines.join('\n'),
				/Browsers and phones need a routable literal address/u,
			);
		},
	);
});

const TWO_TAGS = [
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

/**
 * A system-scope install on the faked machine. `/` is relocated under the
 * temporary home, the caller is root as far as the CLI can tell, and the
 * account tools on the process PATH are the stubs.
 */
async function withSystemInstall(run) {
	await withMachine({ releases: TWO_TAGS }, async (machine) => {
		const { home, fake, health, installDependencies } = machine;
		const systemRoot = join(home, 'root');
		fake.install('chown', '');
		const originalPath = process.env.PATH;
		process.env.PATH = `${fake.directory}:${originalPath}`;
		try {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'system', runAs: 'ada', expose: 'hosted' },
				{ ...installDependencies, systemRoot, uid: 0 },
			);
			const layout = installLayout('system', home, systemRoot);
			await pointHealthAtFixture(layout, health.port);
			await run({
				...machine,
				layout,
				systemRoot,
				context: async () => ({
					layout,
					record: await readInstallRecord(layout),
					systemd: createSystemd({ scope: 'system', env: fake.env() }),
					write: machine.write,
				}),
				upgradeDependencies: {
					apiBase: installDependencies.apiBase,
					webBase: installDependencies.webBase,
					architecture: 'x64',
					releasePublicKeyPem: installDependencies.releasePublicKeyPem,
					readinessTimeoutMs: 5_000,
					uid: 0,
					env: {},
				},
			});
		} finally {
			process.env.PATH = originalPath;
		}
	});
}

test('a system-scope install writes the upgrade helper and arms it', async () => {
	await withSystemInstall(async ({ layout, fake }) => {
		const helper = layout.upgradeHelper;
		assert.equal(await upgradeHelperInstalled(layout), true);
		assert.match(
			await readFile(helper.serviceUnitPath, 'utf8'),
			new RegExp(
				`^ExecStart=${layout.currentLink}/bin/terminay daemon upgrade --system$`,
				'mu',
			),
		);
		assert.match(
			await readFile(helper.pathUnitPath, 'utf8'),
			new RegExp(`^PathChanged=${helper.requestFile}$`, 'mu'),
		);
		// Root-owned units the run-as account cannot write; a request directory
		// that account alone can.
		assert.equal((await stat(helper.pathUnitPath)).mode & 0o777, 0o644);
		assert.equal((await stat(helper.serviceUnitPath)).mode & 0o777, 0o644);
		assert.equal((await stat(helper.requestDirectory)).mode & 0o777, 0o700);
		const calls = fake.invocations();
		assert.ok(calls.includes(`chown -R ada:ada ${helper.requestDirectory}`));
		assert.ok(calls.includes('systemctl enable --now terminay-upgrade.path'));
		assert.ok(
			!calls.some((line) => /chown .*systemd\/system/u.test(line)),
			'the units must stay root-owned',
		);
	});
});

test('a user-scope install has no upgrade helper', async () => {
	await withMachine(
		{ releases: TWO_TAGS },
		async ({ fake, layout, installDependencies }) => {
			await runInstall(
				'v4.1.0',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			assert.equal(layout.upgradeHelper, undefined);
			assert.equal(await upgradeHelperInstalled(layout), false);
			assert.ok(
				!fake.invocations().some((line) => /terminay-upgrade/u.test(line)),
			);
		},
	);
});

test('a system-scope upgrade run as root adds a helper that is missing', async () => {
	await withSystemInstall(
		async ({ layout, fake, context, upgradeDependencies, lines }) => {
			// An install from before the helper existed.
			const helper = layout.upgradeHelper;
			await rm(helper.pathUnitPath);
			await rm(helper.serviceUnitPath);
			await rm(helper.requestDirectory, { recursive: true });
			assert.equal(await upgradeHelperInstalled(layout), false);
			const before = fake.invocations().length;

			const result = await runUpgrade(
				undefined,
				OPTIONS,
				await context(),
				upgradeDependencies,
			);
			assert.equal(result.to, '4.1.1');
			assert.equal(await upgradeHelperInstalled(layout), true);
			assert.equal((await stat(helper.requestDirectory)).mode & 0o777, 0o700);
			assert.ok(
				fake
					.invocations()
					.slice(before)
					.includes('systemctl enable --now terminay-upgrade.path'),
			);
			assert.match(lines.join('\n'), /Installed the upgrade helper/u);
		},
	);
});

test('the helper is added even when there is nothing newer to move to', async () => {
	await withSystemInstall(async ({ layout, context, upgradeDependencies }) => {
		await runUpgrade(undefined, OPTIONS, await context(), upgradeDependencies);
		const helper = layout.upgradeHelper;
		await rm(helper.pathUnitPath);
		await rm(helper.serviceUnitPath);

		// Already on the newest release: the one manual upgrade an older
		// install needs must still leave the helper behind.
		const result = await runUpgrade(
			undefined,
			OPTIONS,
			await context(),
			upgradeDependencies,
		);
		assert.equal(result.upToDate, true);
		assert.equal(await upgradeHelperInstalled(layout), true);
	});
});

test('an upgrade that is not root, or is the helper itself, leaves the helper units alone', async () => {
	await withSystemInstall(
		async ({ layout, fake, context, upgradeDependencies }) => {
			const helper = layout.upgradeHelper;
			await rm(helper.pathUnitPath);
			const untouched = async (dependencies) => {
				const before = fake.invocations().length;
				await runUpgrade(
					undefined,
					OPTIONS,
					await context(),
					dependencies,
				).catch(() => undefined);
				assert.equal(await upgradeHelperInstalled(layout), false);
				assert.ok(
					!fake
						.invocations()
						.slice(before)
						.some((line) => /terminay-upgrade/u.test(line)),
				);
			};
			await untouched({ ...upgradeDependencies, uid: 1000 });
		},
	);

	await withSystemInstall(
		async ({ layout, fake, context, upgradeDependencies }) => {
			// Inside the oneshot the helper's own units are running. The upgrade
			// stops and starts the server's unit and touches no other.
			const before = fake.invocations().length;
			const result = await runUpgrade(undefined, OPTIONS, await context(), {
				...upgradeDependencies,
				env: { TERMINAY_UPGRADE_HELPER: '1' },
			});
			assert.equal(result.to, '4.1.1');
			const calls = fake.invocations().slice(before);
			assert.deepEqual(
				calls.filter((line) => line.startsWith('systemctl')),
				[
					'systemctl stop terminay-server.service',
					'systemctl start terminay-server.service',
				],
			);
			assert.equal(await upgradeHelperInstalled(layout), true);
		},
	);
});

test('uninstall removes the helper units and the request directory', async () => {
	await withSystemInstall(async ({ layout, fake, context }) => {
		const helper = layout.upgradeHelper;
		await runUninstall({ ...OPTIONS, yes: true }, await context(), pipe());
		await assert.rejects(() => stat(helper.pathUnitPath));
		await assert.rejects(() => stat(helper.serviceUnitPath));
		await assert.rejects(() => stat(helper.requestDirectory));
		const calls = fake.invocations();
		const disabled = calls.indexOf(
			'systemctl disable --now terminay-upgrade.path',
		);
		assert.ok(disabled >= 0, 'the path unit must be disabled and stopped');
		assert.ok(
			disabled < calls.lastIndexOf('systemctl daemon-reload'),
			'systemd is reloaded after the units are gone',
		);
	});
});

test('a successful upgrade records where it moved from and to', async () => {
	await withSystemInstall(async ({ layout, context, upgradeDependencies }) => {
		assert.equal(await readUpgradeOutcome(layout.resultPath), undefined);
		const before = Date.now();
		await runUpgrade(undefined, OPTIONS, await context(), upgradeDependencies);

		const outcome = JSON.parse(await readFile(layout.resultPath, 'utf8'));
		assert.deepEqual(Object.keys(outcome), [
			'schemaVersion',
			'from',
			'to',
			'outcome',
			'at',
		]);
		assert.equal(outcome.schemaVersion, 1);
		assert.equal(outcome.from, '4.1.0');
		assert.equal(outcome.to, '4.1.1');
		assert.equal(outcome.outcome, 'succeeded');
		assert.ok(Date.parse(outcome.at) >= before - 1000);
		// Beside versions/, readable by the account the server runs as, and
		// written whole.
		assert.equal(layout.resultPath, join(layout.prefix, 'upgrade-result.json'));
		assert.equal((await stat(layout.resultPath)).mode & 0o777, 0o644);
		await assert.rejects(() => stat(`${layout.resultPath}.tmp`));
	});
});

test('a rollback records the attempted version, the restored one, and the reason', async () => {
	await withSystemInstall(async ({ layout, context, upgradeDependencies }) => {
		// No health server answers on this port, so readiness never arrives.
		await pointHealthAtFixture(layout, 1);
		await assert.rejects(
			async () =>
				runUpgrade(undefined, OPTIONS, await context(), {
					...upgradeDependencies,
					readinessTimeoutMs: 200,
				}),
			UpgradeError,
		);
		const outcome = await readUpgradeOutcome(layout.resultPath);
		assert.equal(outcome.from, '4.1.0');
		assert.equal(outcome.to, '4.1.1');
		assert.equal(outcome.outcome, 'rolled-back');
		assert.match(outcome.reason, /did not become ready/u);
		assert.match(outcome.reason, /4\.1\.0 was restored/u);
		assert.equal(await activeVersion(layout), '4.1.0');

		// No secret, account, path, or device belongs in it.
		const raw = await readFile(layout.resultPath, 'utf8');
		assert.doesNotMatch(raw, /ada|dataRoot|\/var\/lib|serverId|test-box/u);
	});
});

test('each attempt replaces the record of the one before', async () => {
	await withSystemInstall(
		async ({ layout, health, context, upgradeDependencies }) => {
			await pointHealthAtFixture(layout, 1);
			await runUpgrade(undefined, OPTIONS, await context(), {
				...upgradeDependencies,
				readinessTimeoutMs: 200,
			}).catch(() => undefined);
			assert.equal(
				(await readUpgradeOutcome(layout.resultPath)).outcome,
				'rolled-back',
			);

			await pointHealthAtFixture(layout, health.port);
			await runUpgrade(
				undefined,
				OPTIONS,
				await context(),
				upgradeDependencies,
			);
			const outcome = await readUpgradeOutcome(layout.resultPath);
			assert.equal(outcome.outcome, 'succeeded');
			assert.equal(outcome.reason, undefined);
		},
	);
});

test('an upgrade with nothing to do leaves no outcome, and one that cannot be staged says nothing moved', async () => {
	await withSystemInstall(
		async ({ layout, context, upgradeDependencies, releases }) => {
			await runUpgrade(
				undefined,
				OPTIONS,
				await context(),
				upgradeDependencies,
			);
			await rm(layout.resultPath);
			const again = await runUpgrade(
				undefined,
				OPTIONS,
				await context(),
				upgradeDependencies,
			);
			assert.equal(again.upToDate, true);
			assert.equal(await readUpgradeOutcome(layout.resultPath), undefined);
			void releases;
		},
	);

	await withSystemInstall(async ({ layout, context, upgradeDependencies }) => {
		// A release signed by a key this CLI does not trust never reaches disk.
		const { generateKeyPairSync } = await import('node:crypto');
		const other = generateKeyPairSync('ed25519')
			.publicKey.export({ type: 'spki', format: 'pem' })
			.toString();
		await assert.rejects(async () =>
			runUpgrade(undefined, OPTIONS, await context(), {
				...upgradeDependencies,
				releasePublicKeyPem: other,
			}),
		);
		const outcome = await readUpgradeOutcome(layout.resultPath);
		assert.equal(outcome.outcome, 'rolled-back');
		assert.equal(outcome.from, '4.1.0');
		assert.equal(outcome.to, '4.1.1');
		assert.match(outcome.reason, /nothing was changed/u);
		assert.equal(await activeVersion(layout), '4.1.0');
	});
});

test('a rolling install is labelled by its commit, and learns when its build was published', async () => {
	await withMachine(
		{
			releases: [
				{
					tag: 'main-latest',
					version: '0.0.0',
					assetVersion: 'main',
					channel: 'main',
					revision: 'd'.repeat(40),
					latest: true,
					publishedAt: '2026-10-02T00:00:00Z',
				},
			],
		},
		async ({ health, fake, layout, installDependencies, write }) => {
			await runInstall(
				'main',
				{ ...OPTIONS, scope: 'user', expose: 'hosted' },
				installDependencies,
			);
			await pointHealthAtFixture(layout, health.port);
			// The record of an install made when the release's own, never-moving
			// publication time was what got recorded.
			const record = await readInstallRecord(layout);
			assert.equal(record.publishedAt, '2026-10-02T00:00:00Z');
			await writeFile(
				layout.recordPath,
				JSON.stringify({ ...record, publishedAt: '2026-09-08T13:32:38Z' }),
			);

			const result = await runUpgrade(
				undefined,
				OPTIONS,
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
				},
			);
			// The same build, so nothing moves — but the record now knows the
			// build's time, and the next check need not download anything.
			assert.equal(result.upToDate, true);
			assert.equal(
				(await readInstallRecord(layout)).publishedAt,
				'2026-10-02T00:00:00Z',
			);
			assert.equal(await readUpgradeOutcome(layout.resultPath), undefined);
		},
	);
});
