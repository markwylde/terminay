import assert from 'node:assert/strict';
import test from 'node:test';

import { runDoctor } from '../dist/commands/doctor.js';
import { installLayout } from '../dist/layout.js';
import { startFakeHealthServer } from './fake-server.mjs';

async function machine(t, overrides = {}) {
	const health = await startFakeHealthServer([{ status: 'ok', ready: true, version: '6.9.0' }]);
	t.after(() => health.close());
	const lines = [];
	const calls = [];
	const scope = overrides.scope ?? 'system';
	const context = {
		layout: installLayout(scope, '/home/ada', '/'),
		record: {
			runAs: scope === 'system' ? 'terminay' : 'ada',
			dataRoot: '/var/lib/terminay',
			healthPort: health.port,
			port: 8443,
			...overrides.record,
		},
		systemd: {
			state: async () => overrides.state ?? 'active',
			isEnabled: async () => true,
		},
		write: (line) => lines.push(line),
	};
	const dependencies = {
		uid: overrides.uid ?? (scope === 'system' ? 0 : 1000),
		serviceNode: '/opt/terminay/current/bin/node',
		exec: async (file, args) => {
			calls.push([file, ...args]);
			if (file === 'id') return { stdout: '999\n' };
			return { stdout: '' };
		},
		stat: async () => ({ uid: 999, mode: 0o40700 }),
		shellOf: async () => overrides.shell ?? '/bin/bash',
		portOpen: async () => true,
		send: async (request) =>
			request.op === 'status'
				? { ok: true, status: { ready: true } }
				: { ok: true, terminal: overrides.probe ?? { ok: true, shell: '/bin/bash' } },
		...overrides.dependencies,
	};
	return { context, dependencies, lines, calls };
}

test('doctor passes a working install, check by check', async (t) => {
	const { context, dependencies, lines, calls } = await machine(t);
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, true);
	assert.deepEqual(
		report.checks.map((check) => check.name),
		['unit', 'runtime', 'shell', 'data root', 'health', 'socket', 'terminal', 'port'],
	);
	assert.match(lines.at(-1), /Everything checks out/u);
	// Root checks the runtime as the account, on the release's own Node.js.
	assert.deepEqual(calls[0], ['sudo', '-n', '-u', 'terminay', '/opt/terminay/current/bin/node', '-e', '0']);
});

test('a nologin service account fails the shell check with the usermod fix', async (t) => {
	const { context, dependencies, lines } = await machine(t, { shell: '/usr/sbin/nologin' });
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, false);
	assert.equal(report.checks.find((c) => c.name === 'shell').ok, false);
	const output = lines.join('\n');
	assert.match(output, /\[FAIL\] shell\s+terminay has the login shell \/usr\/sbin\/nologin/u);
	assert.match(output, /fix: sudo usermod -s \/bin\/bash terminay/u);
});

test('a terminal that cannot start, an unreadable runtime, and a wrong data root are each named', async (t) => {
	const { context, dependencies, lines } = await machine(t, {
		probe: { ok: false, shell: '/bin/zsh', reason: 'exit', exitCode: 127 },
		dependencies: {
			stat: async () => ({ uid: 0, mode: 0o40755 }),
			exec: async (file) => {
				if (file === 'id') return { stdout: '999\n' };
				throw Object.assign(new Error('Command failed'), {
					stderr: 'sudo: /opt/terminay/current/bin/node: command not found\n',
				});
			},
		},
	});
	const report = await runDoctor(context, dependencies);
	const failed = report.checks.filter((c) => !c.ok && !c.skipped).map((c) => c.name);
	assert.deepEqual(failed, ['runtime', 'data root', 'terminal']);
	const output = lines.join('\n');
	assert.match(output, /cannot run Node\.js at \/opt\/terminay\/current\/bin\/node/u);
	assert.match(output, /owned by uid 0 and mode 755/u);
	assert.match(output, /\/bin\/zsh exited with status 127/u);
});

test('doctor runs only read-only programs', async (t) => {
	const { context, dependencies, calls } = await machine(t, { shell: '/usr/sbin/nologin', state: 'failed' });
	await runDoctor(context, dependencies);
	for (const [file, ...args] of calls) {
		assert.ok(
			file === 'id' || (file === 'sudo' && args.at(-2) === '-e' && args.at(-1) === '0'),
			`unexpected program: ${file} ${args.join(' ')}`,
		);
	}
});

test('doctor works for a user install without sudo', async (t) => {
	const { context, dependencies, calls, lines } = await machine(t, { scope: 'user', state: 'inactive' });
	const report = await runDoctor(context, dependencies);
	assert.ok(!calls.some(([file]) => file === 'sudo'));
	assert.deepEqual(calls[0], ['/opt/terminay/current/bin/node', '-e', '0']);
	assert.equal(report.checks[0].ok, false);
	assert.match(lines.join('\n'), /fix: systemctl --user enable --now terminay-server/u);
});
