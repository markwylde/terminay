import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createInitialWorkspace,
	ServerUpgradeService,
	WorkspaceStore,
} from '@terminay/server-core';
import { createEmbeddedDesktopAuthority } from '../dist/embeddedAuthority.js';
import {
	createReleaseUpgrader,
	parseUpgradeCheckOutput,
	releaseUpgraderFromEnvironment,
	upgradeArguments,
} from '../dist/releaseUpgrader.js';

const answer = (overrides = {}) => ({
	schemaVersion: 1,
	environment: 'user',
	installed: { channel: 'tag', version: '5.1.1', revision: 'aaaa111' },
	available: {
		version: '5.2.0',
		revision: 'bbbb222',
		publishedAt: '2026-10-10T00:00:00.000Z',
	},
	canUpgrade: true,
	modes: ['in-place'],
	trigger: { kind: 'spawn' },
	unavailable: null,
	lastResult: null,
	...overrides,
});

/**
 * A stand-in for the release's `bin/terminay`: a script that records how it
 * was run and answers a check with the given shell fragment.
 */
async function fakeUpgrader(t, onCheck, { announce = false } = {}) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-fake-upgrader-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, 'terminay');
	const calls = join(directory, 'calls');
	// With `announce`, an upgrade run says so on a FIFO as it starts, so a
	// test can wait for a detached run it holds no handle to.
	const announcements = join(directory, 'announcements');
	if (announce) execFileSync('mkfifo', [announcements]);
	await writeFile(
		path,
		`#!/bin/sh
printf '%s\\n' "$*" >> '${calls}'
if [ "$3" = "--check" ]; then
${onCheck}
fi
${announce ? `printf '%s\\n' "$*" > '${announcements}'` : ''}
printf 'upgrading as pid %s in group %s\\n' "$$" "$(ps -o pgid= -p $$ | tr -d ' ')"
`,
	);
	await chmod(path, 0o755);
	return {
		path,
		directory,
		/** The next upgrade run to start, as it announces itself. */
		announced: async () => (await readFile(announcements, 'utf8')).trim(),
		calls: async () =>
			(await readFile(calls, 'utf8').catch(() => ''))
				.split('\n')
				.filter(Boolean),
	};
}

const print = (value) => `cat <<'JSON'\n${JSON.stringify(value)}\nJSON\nexit 0`;

test('a check answer is accepted exactly as the upgrader prints it', () => {
	const { schemaVersion: _schemaVersion, ...expected } = answer();
	assert.deepEqual(
		parseUpgradeCheckOutput(`${JSON.stringify(answer())}\n`),
		expected,
	);
	const system = answer({
		environment: 'system',
		canUpgrade: false,
		trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
		unavailable: {
			reason: 'the upgrade helper is not installed',
			command: 'sudo terminay daemon upgrade',
		},
		lastResult: {
			from: '5.1.0',
			to: '5.1.1',
			outcome: 'rolled-back',
			reason: 'not ready',
			at: '2026-10-11T09:30:00.000Z',
		},
		checkError: 'api.github.com: timed out',
	});
	assert.equal(
		parseUpgradeCheckOutput(JSON.stringify(system)).checkError,
		'api.github.com: timed out',
	);
	assert.deepEqual(
		parseUpgradeCheckOutput(
			JSON.stringify(
				answer({ environment: 'container', modes: ['in-place', 'recreate'] }),
			),
		).modes,
		['in-place', 'recreate'],
	);
});

test('anything else an upgrader prints is refused', () => {
	for (const output of [
		'',
		'not json\n',
		`${JSON.stringify(answer())}\n${JSON.stringify(answer())}\n`,
		`warning: something\n${JSON.stringify(answer())}\n`,
		JSON.stringify([answer()]),
		JSON.stringify(answer({ schemaVersion: 2 })),
		JSON.stringify(answer({ environment: 'windows' })),
		JSON.stringify(
			answer({
				installed: { channel: 'nightly', version: '5.1.1', revision: '' },
			}),
		),
		JSON.stringify(
			answer({ installed: { channel: 'tag', version: '', revision: '' } }),
		),
		JSON.stringify(answer({ available: { version: 'x'.repeat(129) } })),
		JSON.stringify(
			answer({ available: { version: '5.2.0', url: 'https://example.test' } }),
		),
		JSON.stringify(answer({ canUpgrade: 'yes' })),
		JSON.stringify(answer({ modes: [] })),
		JSON.stringify(answer({ modes: ['recreate'] })),
		JSON.stringify(answer({ modes: ['in-place', 'in-place'] })),
		JSON.stringify(answer({ trigger: { kind: 'exec', command: 'rm -rf /' } })),
		JSON.stringify(
			answer({ trigger: { kind: 'request-file', path: 'relative/request' } }),
		),
		JSON.stringify(answer({ trigger: { kind: 'spawn', path: '/tmp/x' } })),
		JSON.stringify(answer({ unavailable: { reason: 'no helper' } })),
		JSON.stringify(
			answer({
				lastResult: {
					from: '5.1.0',
					to: '5.1.1',
					outcome: 'exploded',
					at: 'now',
				},
			}),
		),
		JSON.stringify(answer({ surprise: true })),
		JSON.stringify({ ...answer(), lastResult: undefined }),
	])
		assert.throws(
			() => parseUpgradeCheckOutput(output),
			Error,
			output.slice(0, 80),
		);
});

test('the argument vector is fixed by the environment and the mode alone', () => {
	assert.deepEqual(
		upgradeArguments({ environment: 'user', mode: 'in-place' }),
		['daemon', 'upgrade', '--user'],
	);
	assert.deepEqual(
		upgradeArguments({ environment: 'system', mode: 'in-place' }),
		['daemon', 'upgrade'],
	);
	assert.deepEqual(
		upgradeArguments({ environment: 'container', mode: 'in-place' }),
		['daemon', 'upgrade'],
	);
	assert.deepEqual(
		upgradeArguments({ environment: 'container', mode: 'recreate' }),
		['daemon', 'upgrade', '--recreate'],
	);
	// Nothing else a caller passes reaches it.
	assert.deepEqual(
		upgradeArguments({
			environment: 'user',
			mode: 'in-place',
			version: '9.9.9',
			url: 'https://example.test',
			flags: ['--force'],
		}),
		['daemon', 'upgrade', '--user'],
	);
});

test('a check runs the release upgrader and returns what it answered', async (t) => {
	const fake = await fakeUpgrader(t, print(answer()));
	const upgrader = createReleaseUpgrader({
		upgraderPath: fake.path,
		env: process.env,
	});
	const report = await upgrader.check();
	assert.deepEqual(report.available, {
		version: '5.2.0',
		revision: 'bbbb222',
		publishedAt: '2026-10-10T00:00:00.000Z',
	});
	assert.deepEqual(report.trigger, { kind: 'spawn' });
	assert.deepEqual(await fake.calls(), ['daemon upgrade --check']);
});

test('a check that exits non-zero, prints nonsense, or cannot be run is a failed check', async (t) => {
	const failing = await fakeUpgrader(
		t,
		`${print(answer()).replace('exit 0', 'exit 3')}`,
	);
	await assert.rejects(
		createReleaseUpgrader({
			upgraderPath: failing.path,
			env: process.env,
		}).check(),
		/status 3/u,
	);
	const nonsense = await fakeUpgrader(
		t,
		'echo "Usage: terminay daemon upgrade"; exit 0',
	);
	await assert.rejects(
		createReleaseUpgrader({
			upgraderPath: nonsense.path,
			env: process.env,
		}).check(),
		/JSON/u,
	);
	await assert.rejects(
		createReleaseUpgrader({
			upgraderPath: join(failing.directory, 'missing'),
			env: process.env,
		}).check(),
		/ENOENT/u,
	);
});

test('a check that prints too much or takes too long is killed', async (t) => {
	// No deadline comes due unless the test fires it, so the noisy check can
	// only be ended by what it prints.
	const neverDue = { setTimeout: () => undefined, clearTimeout: () => undefined };
	const noisy = await fakeUpgrader(
		t,
		'while :; do echo "0123456789012345678901234567890123456789"; done',
	);
	await assert.rejects(
		createReleaseUpgrader({
			upgraderPath: noisy.path,
			env: process.env,
			maxOutputBytes: 4096,
			timers: neverDue,
		}).check(),
		/more than a check answers with/u,
	);
	const slow = await fakeUpgrader(t, 'exec sleep 30');
	let deadline;
	let started;
	const ran = new Promise((resolve) => {
		started = resolve;
	});
	const checking = createReleaseUpgrader({
		upgraderPath: slow.path,
		env: process.env,
		checkTimeoutMs: 200,
		timers: {
			setTimeout: (handler, ms) => {
				assert.equal(ms, 200);
				deadline = handler;
				return 1;
			},
			clearTimeout: () => undefined,
		},
		spawn: (...args) => {
			const child = spawn(...args);
			started(child);
			return child;
		},
	}).check();
	const child = await ran;
	const exited = new Promise((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
	// Its deadline comes; the check is answered for and the run is ended.
	deadline();
	await assert.rejects(checking, /did not answer in time/u);
	assert.equal(await exited, 'SIGKILL', 'the slow check was not killed at its deadline');
});

test('a spawned upgrade runs detached in its own session with its output in a log', async (t) => {
	const fake = await fakeUpgrader(t, print(answer()));
	const logPath = join(fake.directory, 'upgrade.log');
	const upgrader = createReleaseUpgrader({
		upgraderPath: fake.path,
		env: process.env,
		logPath: () => logPath,
	});
	const handed = await upgrader.trigger({
		environment: 'user',
		mode: 'in-place',
		trigger: { kind: 'spawn' },
	});
	await handed.ended;
	assert.deepEqual(await fake.calls(), ['daemon upgrade --user']);
	const log = await readFile(logPath, 'utf8');
	const [, pid, group] =
		/upgrading as pid (\d+) in group (\d+)/u.exec(log) ?? [];
	assert.ok(pid, `no process recorded in: ${log}`);
	// A process started in its own session leads its own process group, so
	// nothing aimed at the server's group reaches it.
	assert.equal(group, pid, 'the upgrader does not lead its own session');
	const ownGroup = execFileSync(
		'ps',
		['-o', 'pgid=', '-p', String(process.pid)],
		{ encoding: 'utf8' },
	).trim();
	assert.notEqual(
		group,
		ownGroup,
		'the upgrader shares the server process group',
	);

	const container = await upgrader.trigger({
		environment: 'container',
		mode: 'recreate',
		trigger: { kind: 'spawn' },
	});
	await container.ended;
	assert.deepEqual((await fake.calls()).at(-1), 'daemon upgrade --recreate');
});

test('an upgrader that cannot be started rejects the handover', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-fake-upgrader-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const upgrader = createReleaseUpgrader({
		upgraderPath: join(directory, 'missing'),
		env: process.env,
		logPath: () => join(directory, 'upgrade.log'),
	});
	await assert.rejects(
		upgrader.trigger({
			environment: 'user',
			mode: 'in-place',
			trigger: { kind: 'spawn' },
		}),
		/ENOENT/u,
	);
});

test('a request-file upgrade replaces the file and runs nothing', async (t) => {
	const fake = await fakeUpgrader(t, print(answer()));
	const request = join(fake.directory, 'request');
	let now = 1_000;
	const upgrader = createReleaseUpgrader({
		upgraderPath: fake.path,
		env: process.env,
		now: () => now,
	});
	const handover = {
		environment: 'system',
		mode: 'in-place',
		trigger: { kind: 'request-file', path: request },
	};
	assert.equal(await upgrader.trigger(handover), undefined);
	assert.equal(await readFile(request, 'utf8'), '1000\n');
	now = 2_000;
	await upgrader.trigger(handover);
	assert.equal(
		await readFile(request, 'utf8'),
		'2000\n',
		'the request file did not change',
	);
	assert.deepEqual(
		await fake.calls(),
		[],
		'the server ran the upgrader itself',
	);
	// The helper's command is fixed, so no other mode can be asked of it.
	await assert.rejects(
		upgrader.trigger({ ...handover, mode: 'recreate' }),
		/in-place upgrade only/u,
	);
	// A request file that cannot be written is a failed handover.
	await assert.rejects(
		upgrader.trigger({
			...handover,
			trigger: {
				kind: 'request-file',
				path: join(fake.directory, 'absent', 'request'),
			},
		}),
		/ENOENT/u,
	);
});

test('only a release launcher names an upgrader', async (t) => {
	assert.equal(releaseUpgraderFromEnvironment({}), undefined);
	assert.equal(
		releaseUpgraderFromEnvironment({ TERMINAY_UPGRADER: '' }),
		undefined,
	);
	assert.equal(
		releaseUpgraderFromEnvironment({ TERMINAY_UPGRADER: '   ' }),
		undefined,
	);
	assert.equal(
		releaseUpgraderFromEnvironment({ TERMINAY_UPGRADER: 'bin/terminay' }),
		undefined,
	);
	const fake = await fakeUpgrader(t, print(answer()));
	const upgrader = releaseUpgraderFromEnvironment({
		...process.env,
		TERMINAY_UPGRADER: fake.path,
	});
	assert.equal((await upgrader.check()).installed.version, '5.1.1');
});

test('the release upgrader drives the upgrade service end to end', async (t) => {
	const fake = await fakeUpgrader(t, print(answer()), { announce: true });
	const service = new ServerUpgradeService({
		serverVersion: '5.1.1',
		upgrader: createReleaseUpgrader({
			upgraderPath: fake.path,
			env: process.env,
			logPath: () => join(fake.directory, 'upgrade.log'),
		}),
	});
	t.after(() => service.dispose());
	await service.check();
	assert.deepEqual(service.status.available, { version: '5.2.0' });
	const announced = fake.announced();
	const status = await service.startUpgrade('in-place');
	assert.equal(status.upgrade.state, 'in-progress');
	// The upgrader is detached; it says when it has started.
	assert.equal(await announced, 'daemon upgrade --user');
	// This stand-in exits while the server is still running, which the
	// service answers by looking again; a real upgrade ends the server first.
	assert.deepEqual((await fake.calls()).slice(0, 2), [
		'daemon upgrade --check',
		'daemon upgrade --user',
	]);
});

test('the embedded server never checks, even when an upgrader leaks into it', async (t) => {
	const fake = await fakeUpgrader(t, print(answer()));
	const previous = process.env.TERMINAY_UPGRADER;
	process.env.TERMINAY_UPGRADER = fake.path;
	t.after(() => {
		if (previous === undefined) delete process.env.TERMINAY_UPGRADER;
		else process.env.TERMINAY_UPGRADER = previous;
	});
	const leaked = new ServerUpgradeService({
		serverVersion: '5.1.1',
		upgrader: createReleaseUpgrader({
			upgraderPath: fake.path,
			env: process.env,
		}),
	});
	t.after(() => leaked.dispose());
	const composition = createEmbeddedDesktopAuthority({
		allowUnresolvedTestSessions: true,
		serverId: 'embedded',
		serverVersion: '5.1.1',
		capabilities: ['desktop'],
		ptyFactory: {
			spawn: () => ({
				pid: 1,
				write() {},
				resize() {},
				kill() {},
				onData: () => () => {},
				onExit: () => () => {},
			}),
		},
		workspace: new WorkspaceStore(createInitialWorkspace('embedded')),
		authenticate: ({ hello }) => ({
			clientId: hello.clientId,
			authScope: 'admin',
		}),
		serverUpgrade: leaked,
	});
	t.after(() => composition.shutdown());
	await composition.start();
	assert.notEqual(composition.serverUpgrade, leaked);
	assert.equal(composition.serverUpgrade.enabled, false);
	composition.serverUpgrade.clientAttached('window');
	await composition.serverUpgrade.check();
	// The embedded composition is never given an upgrader, so there is
	// nothing that could run one later.
	assert.deepEqual(
		await fake.calls(),
		[],
		'the embedded server ran an upgrader',
	);
	assert.deepEqual(composition.serverUpgrade.status, {
		version: '5.1.1',
		canUpgrade: false,
		modes: [],
		upgrade: { state: 'none' },
	});
	await assert.rejects(
		composition.serverUpgrade.startUpgrade('in-place'),
		(error) => error.details.reason === 'none-available',
	);
});
