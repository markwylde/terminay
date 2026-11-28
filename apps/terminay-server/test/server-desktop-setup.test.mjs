import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createServerDesktopSetup,
	parseDesktopSetupRecord,
	SETUP_START_WAIT_MS,
} from '../dist/serverDesktopSetup.js';

const ROOT = { uid: 0, mode: 0o755, directory: false };
const ROOT_DIRECTORY = { uid: 0, mode: 0o755, directory: true };

/**
 * A machine with a fake root side. `helper(machine)` is called when the
 * trigger is touched or the image CLI's install is run; it returns the
 * statuses the run writes, one each time the server waits, ending with `'exit'` when the
 * process ends.
 */
function machine(options = {}) {
	const m = {
		clock: 0,
		status: options.status,
		alive: new Set(options.alive ?? []),
		touches: [],
		execs: [],
		script: [],
		runs: 0,
		paths: options.paths ?? {
			'/var/lib/terminay-upgrade/desktop-setup': { uid: 1000, mode: 0o600, directory: false },
		},
	};
	const start = () => {
		m.runs += 1;
		const steps = options.helper?.(m) ?? [];
		m.script.push(...steps);
	};
	m.host = {
		env: options.env ?? { TERMINAY_UPGRADER: '/opt/terminay/current/bin/terminay' },
		upgradeRequestFile: async () =>
			'upgrade' in options ? options.upgrade : '/var/lib/terminay-upgrade/request',
		stat: async (path) => m.paths[path],
		touch: async (path) => {
			if (options.touchFails) throw new Error('EACCES: permission denied');
			m.touches.push([m.clock, path]);
			if (m.touches.length > (options.ignoredTouches ?? 0) && m.script.length === 0 && !m.started) {
				m.started = true;
				start();
			}
		},
		readStatus: async () => m.status,
		processAlive: (pid) => m.alive.has(pid),
		exec: async (file, args, env) => {
			m.execs.push({ file, args: [...args], env: { ...env } });
			const result = (options.sudo ?? (() => ({ code: 0, output: '{"install":1}' })))(args);
			if (args.at(-1) === 'install' && result.code === 0) {
				start();
				// The command returns when the install ends.
				while (m.script.length > 0) await new Promise((resolve) => setImmediate(resolve));
			}
			return result;
		},
		hostname: () => 'c0ffee',
		sleep: async (ms) => {
			m.clock += ms;
			// The run moves on as time passes.
			const next = m.script.shift();
			if (next === 'exit') m.alive.clear();
			else if (next !== undefined) {
				m.status = JSON.stringify({ version: 1, ...next });
				if (next.outcome === undefined) m.alive.add(next.pid);
			}
			await new Promise((resolve) => setImmediate(resolve));
		},
		now: () => m.clock,
	};
	m.setup = createServerDesktopSetup(m.host);
	return m;
}

const at = (run, step, fraction, extra = {}) => ({ run, pid: 4242, step, fraction, ...extra });

test('a system-scope install sets up through the helper: one touch of the trigger, steps and fraction as they are recorded, then success', async () => {
	const m = machine({
		helper: () => [
			at('r1', 'waiting', 0),
			at('r1', 'preparing', 0.05),
			at('r1', 'downloading', 0.3),
			at('r1', 'downloading', 0.3),
			at('r1', 'installing', 0.8),
			at('r1', 'installing', 1, { outcome: { ok: true } }),
		],
	});
	assert.deepEqual(await m.setup.describe(), {
		means: 'server',
		command: 'sudo /opt/terminay/current/bin/terminay daemon desktop install',
	});
	const seen = [];
	assert.deepEqual(await m.setup.run((progress) => seen.push([progress.step, progress.fraction])), { ok: true });
	assert.deepEqual(seen, [
		['waiting', 0],
		['preparing', 0.05],
		['downloading', 0.3],
		['installing', 0.8],
	]);
	// The trigger is the helper's own file, and nothing is written into it by
	// anyone but a touch; the server ran no program at all.
	assert.deepEqual(m.touches, [[0, '/var/lib/terminay-upgrade/desktop-setup']]);
	assert.deepEqual(m.execs, []);
});

test('a failure is reported with its step and the package manager\'s reason', async () => {
	const m = machine({
		helper: () => [
			at('r1', 'downloading', 0.2),
			at('r1', 'downloading', 0.2, { outcome: { ok: false, step: 'downloading', reason: 'E: Failed to fetch' } }),
		],
	});
	assert.deepEqual(await m.setup.run(() => {}), { ok: false, step: 'downloading', reason: 'E: Failed to fetch' });
});

test('an old run\'s outcome is never taken for the new run', async () => {
	const m = machine({
		status: JSON.stringify({ version: 1, ...at('old', 'installing', 1, { outcome: { ok: true } }) }),
		helper: () => [
			at('new', 'preparing', 0.05),
			at('new', 'preparing', 0.05, { outcome: { ok: false, step: 'preparing', reason: 'no network' } }),
		],
	});
	assert.deepEqual(await m.setup.run(() => {}), { ok: false, step: 'preparing', reason: 'no network' });
});

test('a setup already running is joined, by a second request and by a server that restarted mid-setup: nothing is triggered', async () => {
	const m = machine({
		status: JSON.stringify({ version: 1, ...at('r1', 'downloading', 0.4) }),
		alive: [4242],
	});
	// What a server that has just started asks.
	assert.deepEqual(await m.setup.running(), { step: 'downloading', fraction: 0.4 });
	m.script.push(at('r1', 'installing', 0.9), at('r1', 'installing', 1, { outcome: { ok: true } }));
	const seen = [];
	assert.deepEqual(await m.setup.run((progress) => seen.push(progress.step)), { ok: true });
	assert.deepEqual(seen, ['downloading', 'installing']);
	assert.deepEqual(m.touches, []);
	assert.deepEqual(m.execs, []);
	// With no run going, there is nothing to join.
	assert.equal(await m.setup.running(), undefined);
});

test('a helper killed without an outcome is a failure at the step it had reached', async () => {
	const m = machine({ helper: () => [at('r1', 'installing', 0.7), 'exit'] });
	const outcome = await m.setup.run(() => {});
	assert.equal(outcome.ok, false);
	assert.equal(outcome.step, 'installing');
	assert.match(outcome.reason, /stopped before it finished/);
	// And a record left by a dead run is not a setup in progress.
	assert.equal(await m.setup.running(), undefined);
});

test('a trigger lost while the helper\'s last run is ending is repeated; a helper that never starts is a failure', async () => {
	const repeated = machine({
		ignoredTouches: 2,
		helper: () => [at('r1', 'waiting', 0, { outcome: { ok: true } })],
	});
	assert.deepEqual(await repeated.setup.run(() => {}), { ok: true });
	assert.deepEqual(repeated.touches.map(([time]) => time), [0, 5000, 10000]);

	const never = machine({ ignoredTouches: Number.POSITIVE_INFINITY });
	const outcome = await never.setup.run(() => {});
	assert.deepEqual(outcome.ok, false);
	assert.equal(outcome.step, 'waiting');
	assert.match(outcome.reason, /did not start/);
	assert.ok(never.clock >= SETUP_START_WAIT_MS && never.clock < SETUP_START_WAIT_MS + 5000);

	const refused = machine({ touchFails: true });
	assert.match((await refused.setup.run(() => {})).reason, /could not be asked/);
});

const IMAGE = {
	env: { TERMINAY_MANAGED_BY: 'container', TERMINAY_UPGRADER: '/var/lib/terminay/releases/9.9.9/bin/terminay', PATH: '/evil', LD_PRELOAD: '/evil.so' },
	upgrade: undefined,
	paths: { '/opt/terminay': ROOT_DIRECTORY, '/opt/terminay/bin/terminay': ROOT },
};

test('the official image runs its own release directory\'s CLI through sudo -n with a cleared environment, never the wrapper or releases/running', async () => {
	const m = machine({
		...IMAGE,
		helper: () => [at('r1', 'installing', 0.6), at('r1', 'installing', 1, { outcome: { ok: true } })],
	});
	assert.deepEqual(await m.setup.describe(), {
		means: 'server',
		command: 'docker exec -u root c0ffee terminay daemon desktop install',
	});
	assert.deepEqual(await m.setup.run(() => {}), { ok: true });
	const prefix = ['-n', '/usr/bin/env', '-i', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '/opt/terminay/bin/terminay', 'daemon', 'desktop'];
	assert.ok(m.execs.length >= 2);
	for (const call of m.execs) {
		assert.equal(call.file, '/usr/bin/sudo');
		assert.deepEqual(call.args.slice(0, -1), prefix);
		assert.deepEqual(call.env, { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' });
		assert.doesNotMatch(JSON.stringify(call), /releases|usr\/local\/bin\/terminay|evil/);
	}
	assert.deepEqual(m.execs.map((call) => call.args.at(-1)).filter((name) => name === 'install'), ['install']);
	assert.deepEqual(m.touches, []);
});

test('an image run that ends without recording anything fails with what it printed', async () => {
	const m = machine({
		...IMAGE,
		sudo: (args) => (args.at(-1) === 'check' ? { code: 0, output: '{"install":1}' } : { code: 1, output: 'apt is broken\n' }),
	});
	const outcome = await m.setup.run(() => {});
	assert.deepEqual(outcome, { ok: false, step: 'waiting', reason: 'apt is broken' });
});

test('where no elevation path works the manual command is reported and setup is refused', async (t) => {
	const cases = {
		'a user-scope install': {
			options: { upgrade: undefined },
			command: 'sudo /opt/terminay/current/bin/terminay daemon desktop install',
		},
		'a system-scope install made before the helper existed': {
			options: { paths: {} },
			command: 'sudo /opt/terminay/current/bin/terminay daemon desktop install',
		},
		'a server started by hand': {
			options: { env: {}, upgrade: undefined },
			command: 'sudo terminay daemon desktop install',
		},
		'a container without sudo': {
			options: { ...IMAGE, sudo: () => ({ code: undefined, output: 'spawn /usr/bin/sudo ENOENT' }) },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
		'sudo that refuses without a password': {
			options: { ...IMAGE, sudo: () => ({ code: 1, output: 'sudo: a password is required' }) },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
		'an image whose CLI predates the command': {
			options: { ...IMAGE, sudo: () => ({ code: 2, output: 'unknown command: desktop' }) },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
		'an image CLI that answers something else': {
			options: { ...IMAGE, sudo: () => ({ code: 0, output: 'Terminay 1.0' }) },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
		'a release directory the account could have written': {
			options: { ...IMAGE, paths: { '/opt/terminay': { uid: 10001, mode: 0o755, directory: true }, '/opt/terminay/bin/terminay': ROOT } },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
		'a CLI others can write': {
			options: { ...IMAGE, paths: { '/opt/terminay': ROOT_DIRECTORY, '/opt/terminay/bin/terminay': { uid: 0, mode: 0o777, directory: false } } },
			command: 'docker exec -u root c0ffee terminay daemon desktop install',
		},
	};
	for (const [name, { options, command }] of Object.entries(cases))
		await t.test(name, async () => {
			const m = machine(options);
			assert.deepEqual(await m.setup.describe(), { means: 'command', command });
			const outcome = await m.setup.run(() => {});
			assert.equal(outcome.ok, false);
			assert.match(outcome.reason, /run by an operator/);
			assert.deepEqual(m.touches, []);
			assert.equal(m.execs.some((call) => call.args.at(-1) === 'install'), false);
		});
});

test('a status file is read strictly: anything malformed is no record', () => {
	assert.equal(parseDesktopSetupRecord(undefined), undefined);
	assert.equal(parseDesktopSetupRecord('{'), undefined);
	assert.equal(parseDesktopSetupRecord('{"version":2,"run":"r","pid":1,"step":"waiting","fraction":0}'), undefined);
	assert.equal(parseDesktopSetupRecord('{"version":1,"run":"","pid":1,"step":"waiting","fraction":0}'), undefined);
	assert.equal(parseDesktopSetupRecord('{"version":1,"run":"r","pid":"1","step":"waiting","fraction":0}'), undefined);
	assert.equal(parseDesktopSetupRecord('{"version":1,"run":"r","pid":1,"step":"rm -rf","fraction":0}'), undefined);
	assert.deepEqual(parseDesktopSetupRecord('{"version":1,"run":"r","pid":1,"step":"installing","fraction":7,"outcome":{"ok":false,"step":"nope","reason":""}}'), {
		run: 'r',
		pid: 1,
		step: 'installing',
		fraction: 1,
		outcome: { ok: false, reason: 'Setup failed.' },
	});
});
