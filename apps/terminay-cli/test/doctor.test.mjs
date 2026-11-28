import assert from 'node:assert/strict';
import test from 'node:test';

import { runDoctor } from '../dist/commands/doctor.js';
import { installLayout } from '../dist/layout.js';
import { startFakeHealthServer } from './fake-server.mjs';

async function machine(t, overrides = {}) {
	const health = await startFakeHealthServer([
		{ status: 'ok', ready: true, version: '6.9.0' },
	]);
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
			if (file === 'ss') {
				if (overrides.noSs) throw new Error('spawn ss ENOENT');
				return { stdout: overrides.listeners ?? '' };
			}
			if (file === 'env' && overrides.cookieRefused)
				throw new Error('Authorization required');
			return { stdout: '' };
		},
		stat: async () => ({ uid: 999, mode: 0o40700 }),
		shellOf: async () => overrides.shell ?? '/bin/bash',
		portOpen: async () => true,
		desktop: {
			debian: async () => true,
			missing: async () => overrides.desktopMissing ?? ['Xtigervnc'],
			processes: async () => overrides.processes ?? [],
			readable: async () => overrides.cookieReadable ?? true,
			helperInstalled: async () =>
				'helper' in overrides ? overrides.helper : true,
		},
		send: async (request) =>
			request.op === 'status'
				? { ok: true, status: { ready: true } }
				: {
						ok: true,
						terminal: overrides.probe ?? { ok: true, shell: '/bin/bash' },
					},
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
		[
			'unit',
			'runtime',
			'shell',
			'data root',
			'health',
			'socket',
			'terminal',
			'port',
			'desktop',
		],
	);
	assert.match(lines.at(-1), /Everything checks out/u);
	// Root checks the runtime as the account, on the release's own Node.js.
	assert.deepEqual(calls[0], [
		'sudo',
		'-n',
		'-u',
		'terminay',
		'/opt/terminay/current/bin/node',
		'-e',
		'0',
	]);
});

test('a nologin service account fails the shell check with the usermod fix', async (t) => {
	const { context, dependencies, lines } = await machine(t, {
		shell: '/usr/sbin/nologin',
	});
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, false);
	assert.equal(report.checks.find((c) => c.name === 'shell').ok, false);
	const output = lines.join('\n');
	assert.match(
		output,
		/\[FAIL\] shell\s+terminay has the login shell \/usr\/sbin\/nologin/u,
	);
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
	const failed = report.checks
		.filter((c) => !c.ok && !c.skipped)
		.map((c) => c.name);
	assert.deepEqual(failed, ['runtime', 'data root', 'terminal']);
	const output = lines.join('\n');
	assert.match(
		output,
		/cannot run Node\.js at \/opt\/terminay\/current\/bin\/node/u,
	);
	assert.match(output, /owned by uid 0 and mode 755/u);
	assert.match(output, /\/bin\/zsh exited with status 127/u);
});

test('doctor runs only read-only programs', async (t) => {
	const { context, dependencies, calls } = await machine(t, {
		shell: '/usr/sbin/nologin',
		state: 'failed',
	});
	await runDoctor(context, dependencies);
	for (const [file, ...args] of calls) {
		assert.ok(
			file === 'id' ||
				(file === 'ss' && args.join(' ') === '-H -lntup') ||
				(file === 'env' && args.slice(-2).join(' ') === 'xset q') ||
				(file === 'sudo' && args.at(-2) === '-e' && args.at(-1) === '0'),
			`unexpected program: ${file} ${args.join(' ')}`,
		);
	}
});

test('doctor works for a user install without sudo', async (t) => {
	const { context, dependencies, calls, lines } = await machine(t, {
		scope: 'user',
		state: 'inactive',
	});
	const report = await runDoctor(context, dependencies);
	assert.ok(!calls.some(([file]) => file === 'sudo'));
	assert.deepEqual(calls[0], ['/opt/terminay/current/bin/node', '-e', '0']);
	assert.equal(report.checks[0].ok, false);
	assert.match(
		lines.join('\n'),
		/fix: systemctl --user enable --now terminay-server/u,
	);
});

const DISPLAY_SERVER = (seccomp = '2') => ({
	pid: 4242,
	argv: [
		'/usr/bin/Xtigervnc',
		':765',
		'-rfbport',
		'-1',
		'-rfbunixpath',
		'/var/lib/terminay/desktop/rfb.sock',
		'-nolisten',
		'tcp',
		'-auth',
		'/var/lib/terminay/desktop/cookie',
	],
	seccomp,
});

test('a desktop that is not set up is informational and leaves the result alone', async (t) => {
	const { context, dependencies, lines } = await machine(t);
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, true);
	assert.deepEqual(report.checks.at(-1), {
		name: 'desktop',
		ok: true,
		skipped: true,
		detail:
			'not set up: missing Xtigervnc; setup helper installed; to set it up: sudo terminay daemon desktop install',
	});
	assert.ok(lines.some((line) => /^\[skip\] desktop\s+not set up/u.test(line)));
	assert.match(lines.at(-1), /Everything checks out/u);

	// Where the desktop is not offered at all, the same.
	const other = await machine(t, {
		dependencies: {
			desktop: {
				debian: async () => false,
				missing: async () => [],
				processes: async () => [],
				readable: async () => true,
			},
		},
	});
	const elsewhere = await runDoctor(other.context, other.dependencies);
	assert.equal(elsewhere.ok, true);
	assert.equal(elsewhere.checks.at(-1).skipped, true);
});

test('a desktop that is set up passes, running or not', async (t) => {
	const idle = await machine(t, { desktopMissing: [] });
	assert.deepEqual(
		(await runDoctor(idle.context, idle.dependencies)).checks.at(-1),
		{
			name: 'desktop',
			ok: true,
			detail:
				'set up, every program present; setup helper installed; no desktop is running',
		},
	);
	const running = await machine(t, {
		desktopMissing: [],
		processes: [
			DISPLAY_SERVER(),
			{ pid: 7, argv: ['/bin/bash'], seccomp: '0' },
		],
		// Someone else's listeners are not the desktop's.
		listeners:
			'tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=880,fd=3))\n',
	});
	const report = await runDoctor(running.context, running.dependencies);
	assert.equal(report.ok, true);
	assert.equal(
		report.checks.at(-1).detail,
		"running, with no network listener and no network access; its display accepts the server's cookie; setup helper installed",
	);
	// The display was asked one read-only question, with the server's cookie.
	assert.deepEqual(running.calls.at(-1), [
		'env',
		'DISPLAY=:765',
		'XAUTHORITY=/var/lib/terminay/desktop/cookie',
		'xset',
		'q',
	]);
});

test('a display server with a network listener fails', async (t) => {
	const { context, dependencies, lines } = await machine(t, {
		desktopMissing: [],
		processes: [DISPLAY_SERVER()],
		listeners:
			'tcp LISTEN 0 5 0.0.0.0:6665 0.0.0.0:* users:(("Xtigervnc",pid=4242,fd=7))\n',
	});
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, false);
	assert.equal(
		report.checks.at(-1).detail,
		'the display server (pid 4242) is listening on the network: tcp 0.0.0.0:6665',
	);
	assert.ok(
		lines.some((line) => /fix: turn the desktop off and on/u.test(line)),
	);
	assert.match(lines.at(-1), /Some checks failed/u);
});

test('a display server able to open a network connection fails', async (t) => {
	for (const seccomp of ['0', undefined]) {
		const { context, dependencies } = await machine(t, {
			desktopMissing: [],
			processes: [{ ...DISPLAY_SERVER(), seccomp }],
		});
		const report = await runDoctor(context, dependencies);
		assert.equal(report.ok, false);
		assert.match(
			report.checks.at(-1).detail,
			/without its network filter and can open network connections/u,
		);
	}
});

test('a display server the operator runs for themselves is not examined', async (t) => {
	const { context, dependencies } = await machine(t, {
		desktopMissing: [],
		processes: [
			{
				pid: 900,
				argv: ['/usr/bin/Xtigervnc', ':1', '-rfbport', '5901'],
				seccomp: '0',
			},
		],
		listeners:
			'tcp LISTEN 0 5 0.0.0.0:5901 0.0.0.0:* users:(("Xtigervnc",pid=900,fd=7))\n',
	});
	const report = await runDoctor(context, dependencies);
	assert.equal(report.ok, true);
	assert.match(report.checks.at(-1).detail, /no desktop is running$/u);
});

test("a display that refuses the server's cookie fails; a cookie doctor cannot read is said, not failed", async (t) => {
	const refused = await machine(t, {
		desktopMissing: [],
		processes: [DISPLAY_SERVER()],
		cookieRefused: true,
	});
	const report = await runDoctor(refused.context, refused.dependencies);
	assert.equal(report.ok, false);
	assert.equal(
		report.checks.at(-1).detail,
		"display :765 does not accept the server's cookie",
	);

	const unread = await machine(t, {
		desktopMissing: [],
		processes: [DISPLAY_SERVER()],
		cookieReadable: false,
	});
	const other = await runDoctor(unread.context, unread.dependencies);
	assert.equal(other.ok, true);
	assert.match(
		other.checks.at(-1).detail,
		/cookie not checked \(run as root\)/u,
	);
	assert.equal(
		unread.calls.some(([file]) => file === 'env'),
		false,
	);
});

test('doctor says whether the setup helper is installed, and says nothing of one a user install never has', async (t) => {
	const without = await machine(t, { helper: false });
	assert.match(
		(await runDoctor(without.context, without.dependencies)).checks.at(-1)
			.detail,
		/setup helper not installed \(sudo terminay daemon upgrade adds it\)/u,
	);
	const user = await machine(t, { scope: 'user', helper: undefined });
	const report = await runDoctor(user.context, user.dependencies);
	assert.equal(report.ok, true);
	assert.doesNotMatch(report.checks.at(-1).detail, /helper/u);
});

test('a host without ss is told its listeners were not checked', async (t) => {
	const m = await machine(t, {
		desktopMissing: [],
		processes: [DISPLAY_SERVER()],
		noSs: true,
	});
	const report = await runDoctor(m.context, m.dependencies);
	assert.equal(report.ok, true);
	assert.match(
		report.checks.at(-1).detail,
		/^running, with no network access; listeners not checked \(ss is not installed\)/u,
	);
});
