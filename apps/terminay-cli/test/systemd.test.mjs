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
