import assert from 'node:assert/strict';
import test from 'node:test';

import { createSystemd } from '../dist/systemd.js';
import { createFakeBin } from './fake-bin.mjs';

async function withFakeSystemd(scripts, run) {
	const fake = await createFakeBin();
	fake.install('systemctl', scripts.systemctl ?? '');
	fake.install('journalctl', scripts.journalctl ?? '');
	fake.install('loginctl', scripts.loginctl ?? '');
	try {
		await run(fake);
	} finally {
		await fake.close();
	}
}

test('system scope drives systemctl without --user', async () => {
	await withFakeSystemd({}, async (fake) => {
		const systemd = createSystemd({ scope: 'system', env: fake.env() });
		await systemd.daemonReload();
		await systemd.enableNow();
		await systemd.start();
		await systemd.stop();
		await systemd.disable();
		assert.deepEqual(fake.invocations(), [
			'systemctl daemon-reload',
			'systemctl enable --now terminay-server.service',
			'systemctl start terminay-server.service',
			'systemctl stop terminay-server.service',
			'systemctl disable terminay-server.service',
		]);
	});
});

test('user scope passes --user to every call', async () => {
	await withFakeSystemd({}, async (fake) => {
		const systemd = createSystemd({ scope: 'user', env: fake.env() });
		await systemd.daemonReload();
		await systemd.enableNow();
		await systemd.journal(5);
		assert.deepEqual(fake.invocations(), [
			'systemctl --user daemon-reload',
			'systemctl --user enable --now terminay-server.service',
			'journalctl --user -u terminay-server.service --no-pager -n 5',
		]);
	});
});

test('is-active answers the question rather than throwing', async () => {
	await withFakeSystemd({ systemctl: 'echo active' }, async (fake) => {
		const systemd = createSystemd({ scope: 'system', env: fake.env() });
		assert.equal(await systemd.isActive(), true);
		assert.equal(await systemd.state(), 'active');
	});
	await withFakeSystemd(
		{ systemctl: 'echo inactive; exit 3' },
		async (fake) => {
			const systemd = createSystemd({ scope: 'system', env: fake.env() });
			assert.equal(await systemd.isActive(), false);
			assert.equal(await systemd.state(), 'inactive');
		},
	);
});

test('a failing systemctl call reports what systemd said', async () => {
	await withFakeSystemd(
		{ systemctl: 'echo "Unit not found." >&2; exit 5' },
		async (fake) => {
			const systemd = createSystemd({ scope: 'system', env: fake.env() });
			await assert.rejects(
				() => systemd.start(),
				/systemctl start terminay-server\.service failed: Unit not found\./u,
			);
		},
	);
});

test('the journal is read for the failing unit only', async () => {
	await withFakeSystemd(
		{ journalctl: 'echo "line one"; echo "line two"' },
		async (fake) => {
			const systemd = createSystemd({ scope: 'system', env: fake.env() });
			assert.equal(await systemd.journal(), 'line one\nline two');
			assert.deepEqual(fake.invocations(), [
				'journalctl -u terminay-server.service --no-pager -n 20',
			]);
		},
	);
});

test('user scope enables lingering so the service survives logout', async () => {
	await withFakeSystemd({}, async (fake) => {
		const systemd = createSystemd({ scope: 'user', env: fake.env() });
		await systemd.enableLinger('ada');
		assert.deepEqual(fake.invocations(), ['loginctl enable-linger ada']);
	});
});

test('the upgrade helper units are enabled, started, stopped, and removed by name', async () => {
	await withFakeSystemd({}, async (fake) => {
		const systemd = createSystemd({ scope: 'system', env: fake.env() });
		await systemd.enableNowUnit('terminay-upgrade.path');
		await systemd.stopUnit('terminay-upgrade.path');
		await systemd.disableNowUnit('terminay-upgrade.path');
		await systemd.resetFailedUnit('terminay-upgrade.service');
		assert.deepEqual(fake.invocations(), [
			'systemctl enable --now terminay-upgrade.path',
			'systemctl stop terminay-upgrade.path',
			'systemctl disable --now terminay-upgrade.path',
			'systemctl reset-failed terminay-upgrade.service',
		]);
	});
});

test('installing the helper hands only the request directory to the run-as account', async () => {
	const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const { installLayout } = await import('../dist/layout.js');
	const { installUpgradeHelper, removeUpgradeHelper, upgradeHelperInstalled } =
		await import('../dist/helper.js');

	const root = await mkdtemp(join(tmpdir(), 'terminay-helper-'));
	const fake = await createFakeBin();
	fake.install('systemctl', '');
	fake.install('chown', '');
	// The stub `chown` changes nothing, so the directory stays this test's
	// own: `ada` is given this account's uid and `eve` another.
	fake.install(
		'id',
		`case "$2" in ada) echo ${process.getuid()};; *) echo 4242;; esac`,
	);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const layout = installLayout('system', root, root);
		const systemd = createSystemd({ scope: 'system', env: fake.env() });
		const helper = layout.upgradeHelper;
		assert.equal(await upgradeHelperInstalled(layout), false);

		assert.equal(
			await installUpgradeHelper({ layout, runAs: 'ada', systemd }),
			true,
		);
		assert.equal(await upgradeHelperInstalled(layout), true);

		// Writable by the run-as account alone, and by nobody else at all.
		assert.equal((await stat(helper.requestDirectory)).mode & 0o777, 0o700);
		assert.equal((await stat(helper.requestFile)).mode & 0o777, 0o600);
		assert.equal((await readFile(helper.requestFile, 'utf8')).length, 0);
		// The units are root's: nothing chowns them, and their mode keeps the
		// run-as account from writing them.
		for (const unit of [helper.pathUnitPath, helper.serviceUnitPath]) {
			assert.equal((await stat(unit)).mode & 0o777, 0o644);
		}
		assert.deepEqual(fake.invocations(), [
			`chown -R ada:ada ${helper.requestDirectory}`,
			'systemctl daemon-reload',
			'systemctl enable --now terminay-upgrade.path',
		]);

		// A second pass finds everything as it should be. Touching the request
		// file would itself be a request, so it is not touched: its timestamps
		// are what they were, and the armed watch is neither stopped nor
		// restarted.
		const stamp = async () => {
			const info = await stat(helper.requestFile);
			return [info.mtimeMs, info.ctimeMs];
		};
		const stamped = await stamp();
		const before = fake.invocations().length;
		assert.equal(
			await installUpgradeHelper({ layout, runAs: 'ada', systemd }),
			false,
		);
		assert.deepEqual(fake.invocations().slice(before), [
			'id -u ada',
			'systemctl enable --now terminay-upgrade.path',
		]);
		assert.deepEqual(await stamp(), stamped);

		// A different run-as account does need the directory handed over, which
		// changes the watched file — so the watch is stopped first and armed
		// again afterwards, and no upgrade is asked for by accident.
		const rearm = fake.invocations().length;
		await installUpgradeHelper({ layout, runAs: 'eve', systemd });
		assert.deepEqual(fake.invocations().slice(rearm), [
			'id -u eve',
			'systemctl stop terminay-upgrade.path',
			`chown -R eve:eve ${helper.requestDirectory}`,
			'systemctl enable --now terminay-upgrade.path',
		]);

		await removeUpgradeHelper({ layout, systemd });
		assert.equal(await upgradeHelperInstalled(layout), false);
		await assert.rejects(() => stat(helper.pathUnitPath));
		await assert.rejects(() => stat(helper.serviceUnitPath));
		await assert.rejects(() => stat(helper.requestDirectory));
		assert.ok(
			fake
				.invocations()
				.includes('systemctl disable --now terminay-upgrade.path'),
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
		await rm(root, { recursive: true, force: true });
	}
});
