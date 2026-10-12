import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SERVER_UPGRADE_CHECK_INTERVAL_MS,
	SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS,
	ServerUpgradeService,
} from '../dist/index.js';

const HOUR = SERVER_UPGRADE_CHECK_INTERVAL_MS;

/** A clock whose timers fire only when the test moves it. */
function fakeClock(start = 1_000_000) {
	let now = start;
	let nextId = 0;
	const timers = new Map();
	return {
		now: () => now,
		setInterval(handler, milliseconds) {
			const id = ++nextId;
			timers.set(id, { at: now + milliseconds, handler, every: milliseconds });
			return id;
		},
		clearInterval(id) {
			timers.delete(id);
		},
		setTimeout(handler, milliseconds) {
			const id = ++nextId;
			timers.set(id, { at: now + milliseconds, handler });
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		get armed() {
			return [...timers.values()].filter((timer) => timer.every !== undefined)
				.length;
		},
		get deadlines() {
			return [...timers.values()].filter((timer) => timer.every === undefined)
				.length;
		},
		advance(milliseconds) {
			const target = now + milliseconds;
			while (true) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (due === undefined) break;
				now = due[1].at;
				if (due[1].every === undefined) timers.delete(due[0]);
				else due[1].at += due[1].every;
				due[1].handler();
			}
			now = target;
		},
	};
}

const report = (overrides = {}) => ({
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

/** An upgrader that gives its current answer and records what it was asked. */
function fakeUpgrader([initial] = []) {
	let current = initial;
	const upgrader = {
		checks: 0,
		handovers: [],
		answer: (next) => {
			current = next;
		},
		triggerResult: undefined,
		async check() {
			upgrader.checks += 1;
			const next = current;
			if (next === undefined) throw new Error('no answer');
			if (next instanceof Error) throw next;
			return typeof next === 'function' ? next() : next;
		},
		async trigger(handover) {
			upgrader.handovers.push(handover);
			if (upgrader.triggerResult instanceof Error) throw upgrader.triggerResult;
			return upgrader.triggerResult;
		},
	};
	return upgrader;
}

function served(t, upgrader, options = {}) {
	const clock = fakeClock();
	const diagnostics = [];
	const service = new ServerUpgradeService({
		serverVersion: '5.1.1',
		...(upgrader === undefined ? {} : { upgrader }),
		now: clock.now,
		setInterval: clock.setInterval,
		clearInterval: clock.clearInterval,
		setTimeout: clock.setTimeout,
		clearTimeout: clock.clearTimeout,
		onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
		...options,
	});
	const published = [];
	service.subscribe((status) => published.push(status));
	t.after(() => service.dispose());
	return { clock, service, published, diagnostics };
}

const refused =
	(reason, code = 'conflict') =>
	(error) => {
		assert.equal(error.code, code);
		assert.equal(error.details.reason, reason);
		return true;
	};

test('a check that finds a newer release publishes it', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { service, published } = served(t, upgrader);
	assert.deepEqual(service.status, {
		version: '5.1.1',
		canUpgrade: false,
		modes: [],
		upgrade: { state: 'none' },
	});
	await service.check();
	assert.deepEqual(service.status, {
		version: '5.1.1',
		channel: 'tag',
		available: { version: '5.2.0' },
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: { state: 'none' },
	});
	assert.deepEqual(published, [service.status]);
	// Nothing changed, so nothing is published again.
	await service.check();
	assert.equal(published.length, 1);
});

test('a check that finds nothing newer offers nothing', async (t) => {
	const upgrader = fakeUpgrader([report({ available: null })]);
	const { service } = served(t, upgrader);
	await service.check();
	assert.equal(service.status.available, undefined);
	assert.equal(service.status.channel, 'tag');
	await assert.rejects(
		service.startUpgrade('in-place'),
		refused('none-available'),
	);
	assert.deepEqual(upgrader.handovers, []);
});

test('a source install reports its channel and nothing to upgrade to', async (t) => {
	const upgrader = fakeUpgrader([
		report({
			installed: { channel: 'source', version: '5.1.1', revision: '' },
			available: null,
			canUpgrade: false,
		}),
	]);
	const { service } = served(t, upgrader);
	await service.check();
	assert.deepEqual(service.status, {
		version: '5.1.1',
		channel: 'source',
		canUpgrade: false,
		modes: [],
		upgrade: { state: 'none' },
	});
});

test('unreachable release metadata keeps the last known availability and updates the rest', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { service, diagnostics } = served(t, upgrader);
	await service.check();
	upgrader.answer(
		report({
			available: null,
			canUpgrade: false,
			unavailable: {
				reason: 'the upgrade helper is not installed',
				command: 'sudo terminay daemon upgrade',
			},
			checkError: 'api.github.com: timed out',
		}),
	);
	await service.check();
	assert.deepEqual(service.status.available, { version: '5.2.0' });
	assert.equal(service.status.canUpgrade, false);
	assert.deepEqual(service.status.unavailable, {
		reason: 'the upgrade helper is not installed',
		command: 'sudo terminay daemon upgrade',
	});
	assert.deepEqual(diagnostics, [
		{ kind: 'check-error', message: 'api.github.com: timed out' },
	]);
});

test('a check that fails outright leaves the last result in place and never rejects', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { service, published, diagnostics } = served(t, upgrader);
	await service.check();
	const before = service.status;
	upgrader.answer(new Error('spawn ENOENT'));
	await assert.doesNotReject(service.check());
	assert.equal(service.status, before);
	assert.equal(published.length, 1);
	assert.deepEqual(diagnostics, [
		{ kind: 'check-failed', message: 'spawn ENOENT' },
	]);
	// A report the status cannot carry is a failed check too.
	upgrader.answer(
		report({
			lastResult: {
				from: '5.1.0',
				to: '5.1.1',
				outcome: 'succeeded',
				at: 'yesterday',
			},
		}),
	);
	await service.check();
	assert.equal(service.status, before);
	upgrader.answer(report({ available: { version: 'x'.repeat(200) } }));
	await service.check();
	assert.equal(service.status, before);
	// The next occasion tries again and succeeds.
	upgrader.answer(report({ available: { version: '5.3.0' } }));
	await service.check();
	assert.deepEqual(service.status.available, { version: '5.3.0' });
});

test('a server with no upgrader checks nothing, arms nothing, and offers nothing', async (t) => {
	const { clock, service, published } = served(t, undefined);
	assert.equal(service.enabled, false);
	service.start();
	service.clientAttached('c1');
	clock.advance(HOUR * 5);
	await service.check();
	assert.equal(clock.armed, 0);
	assert.deepEqual(service.status, {
		version: '5.1.1',
		canUpgrade: false,
		modes: [],
		upgrade: { state: 'none' },
	});
	assert.deepEqual(published, []);
	await assert.rejects(
		service.startUpgrade('in-place'),
		refused('none-available'),
	);
});

test('the check runs at start, on a stale attach, and hourly only while a client is attached', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { clock, service } = served(t, upgrader);
	// Lets a check that was started finish, without starting one.
	const settle = () => new Promise((resolve) => setImmediate(resolve));

	// Server start: one check, with nobody attached and no timer armed.
	service.start();
	await settle();
	assert.equal(upgrader.checks, 1);
	assert.equal(clock.armed, 0);

	// Nobody attached: however long passes, nothing is asked.
	clock.advance(HOUR * 30);
	await settle();
	assert.equal(upgrader.checks, 1, 'a check ran while no client was attached');

	// First attach: the last check is stale, so it runs now, and the poll arms.
	service.clientAttached('c1');
	assert.equal(clock.armed, 1);
	await settle();
	assert.equal(upgrader.checks, 2);

	// A second client, and the first one again, arm nothing more and, with a
	// fresh result, ask nothing.
	service.clientAttached('c2');
	service.clientAttached('c1');
	assert.equal(clock.armed, 1);
	await settle();
	assert.equal(upgrader.checks, 2);

	// Each hour attached is one check.
	clock.advance(HOUR);
	await settle();
	assert.equal(upgrader.checks, 3);
	clock.advance(HOUR);
	await settle();
	clock.advance(HOUR);
	await settle();
	assert.equal(upgrader.checks, 5);

	// One client leaving changes nothing; the last one leaving clears the poll.
	service.clientDetached('c2');
	assert.equal(clock.armed, 1);
	service.clientDetached('c1');
	service.clientDetached('c1');
	assert.equal(clock.armed, 0);
	clock.advance(HOUR * 30);
	await settle();
	assert.equal(
		upgrader.checks,
		5,
		'a check ran after the last client detached',
	);

	// Attaching within the hour of a check asks nothing, but arms the poll.
	service.clientAttached('c3');
	await settle();
	assert.equal(upgrader.checks, 6);
	service.clientDetached('c3');
	clock.advance(HOUR / 2);
	service.clientAttached('c4');
	await settle();
	assert.equal(upgrader.checks, 6);
	assert.equal(clock.armed, 1);
});

test('a failed check is not repeated on every attach, and is retried at the next occasion', async (t) => {
	const upgrader = fakeUpgrader([new Error('no network')]);
	const { clock, service } = served(t, upgrader);
	service.start();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(upgrader.checks, 1);
	service.clientAttached('c1');
	service.clientDetached('c1');
	service.clientAttached('c2');
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(upgrader.checks, 1);
	clock.advance(HOUR);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(upgrader.checks, 2);
});

test('concurrent checks share one run', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const upgrader = fakeUpgrader([
		async () => {
			await gate;
			return report();
		},
	]);
	const { service } = served(t, upgrader);
	service.start();
	const first = service.check();
	service.clientAttached('c1');
	const second = service.check();
	assert.equal(first, second);
	release();
	await first;
	assert.equal(upgrader.checks, 1);
});

test('disposal clears the poll and drops a late answer', async (t) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const upgrader = fakeUpgrader([
		async () => {
			await gate;
			return report();
		},
	]);
	const { clock, service, published } = served(t, upgrader);
	service.clientAttached('c1');
	const running = service.check();
	assert.equal(clock.armed, 1);
	service.dispose();
	assert.equal(clock.armed, 0);
	release();
	await running;
	assert.equal(service.status.available, undefined);
	assert.deepEqual(published, []);
});

test('the outcome the upgrader recorded is reported from the first check on', async (t) => {
	const at = '2026-10-11T09:30:00.000Z';
	const succeeded = fakeUpgrader([
		report({
			installed: { channel: 'tag', version: '5.2.0', revision: 'bbbb222' },
			available: null,
			lastResult: { from: '5.1.1', to: '5.2.0', outcome: 'succeeded', at },
		}),
	]);
	const first = served(t, succeeded, { serverVersion: '5.2.0' });
	first.service.start();
	await first.service.check();
	assert.deepEqual(first.service.status, {
		version: '5.2.0',
		channel: 'tag',
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: {
			state: 'succeeded',
			from: '5.1.1',
			to: '5.2.0',
			at: Date.parse(at),
		},
	});

	const rolledBack = fakeUpgrader([
		report({
			lastResult: {
				from: '5.1.1',
				to: '5.2.0',
				outcome: 'rolled-back',
				reason: 'the new release did not report ready',
				at,
			},
		}),
	]);
	const second = served(t, rolledBack);
	second.service.start();
	await second.service.check();
	assert.deepEqual(second.service.status.upgrade, {
		state: 'failed',
		from: '5.1.1',
		to: '5.2.0',
		reason: 'the new release did not report ready',
		restored: true,
		at: Date.parse(at),
	});
	// The failure leaves the upgrade on offer.
	assert.deepEqual(second.service.status.available, { version: '5.2.0' });
	// A later check with no record replaces the outcome.
	rolledBack.answer(report());
	await second.service.check();
	assert.deepEqual(second.service.status.upgrade, { state: 'none' });

	const absent = served(t, fakeUpgrader([report()]));
	absent.service.start();
	await absent.service.check();
	assert.deepEqual(absent.service.status.upgrade, { state: 'none' });
});

test('what the server can do is reported for each kind of install', async (t) => {
	const cases = [
		['user scope', report(), { canUpgrade: true, modes: ['in-place'] }],
		[
			'system scope with the helper',
			report({
				environment: 'system',
				trigger: {
					kind: 'request-file',
					path: '/run/terminay-upgrade/request',
				},
			}),
			{ canUpgrade: true, modes: ['in-place'] },
		],
		[
			'system scope without the helper',
			report({
				environment: 'system',
				canUpgrade: false,
				unavailable: {
					reason: 'the upgrade helper is not installed',
					command: 'sudo terminay daemon upgrade',
				},
			}),
			{
				canUpgrade: false,
				modes: [],
				unavailable: {
					reason: 'the upgrade helper is not installed',
					command: 'sudo terminay daemon upgrade',
				},
			},
		],
		[
			'container without the socket',
			report({ environment: 'container' }),
			{ canUpgrade: true, modes: ['in-place'] },
		],
		[
			'container with the socket',
			report({ environment: 'container', modes: ['in-place', 'recreate'] }),
			{
				canUpgrade: true,
				modes: ['in-place', 'recreate'],
				recreateEndsTerminals: true,
			},
		],
	];
	for (const [name, answer, expected] of cases) {
		const { service } = served(t, fakeUpgrader([answer]));
		await service.check();
		const { canUpgrade, modes, recreateEndsTerminals, unavailable } =
			service.status;
		assert.deepEqual(
			{
				canUpgrade,
				modes,
				...(recreateEndsTerminals === undefined
					? {}
					: { recreateEndsTerminals }),
				...(unavailable === undefined ? {} : { unavailable }),
			},
			expected,
			name,
		);
		assert.deepEqual(service.status.available, { version: '5.2.0' }, name);
	}
	// A request file starts one fixed command, so it never offers recreate.
	const { service } = served(
		t,
		fakeUpgrader([
			report({
				environment: 'system',
				modes: ['in-place', 'recreate'],
				trigger: {
					kind: 'request-file',
					path: '/run/terminay-upgrade/request',
				},
			}),
		]),
	);
	await service.check();
	assert.deepEqual(service.status.modes, ['in-place']);
	await assert.rejects(
		service.startUpgrade('recreate'),
		refused('mode-not-offered'),
	);
});

test('starting an upgrade marks it in progress, tells clients, then hands it over', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { clock, service, published } = served(t, upgrader);
	await service.check();
	published.length = 0;
	const seenAtHandover = [];
	const original = upgrader.trigger;
	upgrader.trigger = async (handover) => {
		seenAtHandover.push(service.status.upgrade.state, published.length);
		return original(handover);
	};
	const status = await service.startUpgrade('in-place');
	assert.deepEqual(
		seenAtHandover,
		['in-progress', 1],
		'clients were told before the handover',
	);
	assert.deepEqual(status.upgrade, {
		state: 'in-progress',
		mode: 'in-place',
		startedAt: clock.now(),
	});
	assert.deepEqual(upgrader.handovers, [
		{ environment: 'user', mode: 'in-place', trigger: { kind: 'spawn' } },
	]);
	// One at a time, whoever asks, and the running one is unaffected.
	await assert.rejects(
		service.startUpgrade('in-place'),
		refused('in-progress'),
	);
	assert.equal(upgrader.handovers.length, 1);
	assert.equal(service.status.upgrade.state, 'in-progress');
	// The upgrader is busy: it is not asked anything while it works.
	const checks = upgrader.checks;
	service.clientAttached('c1');
	clock.advance(HOUR / 4);
	await service.check();
	assert.equal(upgrader.checks, checks);
});

test('an upgrade is refused when unavailable, not self-serviceable, or in an unoffered mode', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	const { service, published } = served(t, upgrader);
	// Before any check there is nothing to upgrade to.
	await assert.rejects(
		service.startUpgrade('in-place'),
		refused('none-available'),
	);
	await service.check();
	published.length = 0;
	await assert.rejects(
		service.startUpgrade('recreate'),
		refused('mode-not-offered'),
	);
	upgrader.answer(
		report({
			canUpgrade: false,
			unavailable: {
				reason: 'no helper',
				command: 'sudo terminay daemon upgrade',
			},
		}),
	);
	await service.check();
	published.length = 0;
	await assert.rejects(
		service.startUpgrade('in-place'),
		refused('cannot-upgrade'),
	);
	assert.deepEqual(upgrader.handovers, []);
	assert.deepEqual(published, [], 'a refusal changes nothing');
});

test("the handover carries the server's own facts and the chosen mode only", async (t) => {
	const upgrader = fakeUpgrader([
		report({
			environment: 'container',
			modes: ['in-place', 'recreate'],
		}),
	]);
	const { service } = served(t, upgrader);
	await service.check();
	await service.startUpgrade('recreate');
	assert.deepEqual(upgrader.handovers, [
		{ environment: 'container', mode: 'recreate', trigger: { kind: 'spawn' } },
	]);

	const system = fakeUpgrader([
		report({
			environment: 'system',
			trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
		}),
	]);
	const second = served(t, system);
	await second.service.check();
	await second.service.startUpgrade('in-place');
	assert.deepEqual(system.handovers, [
		{
			environment: 'system',
			mode: 'in-place',
			trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
		},
	]);
});

test('a handover that fails reverts to not in progress and reports a structured error', async (t) => {
	const upgrader = fakeUpgrader([report()]);
	upgrader.triggerResult = new Error('EACCES: /run/terminay-upgrade/request');
	const { service, published, diagnostics } = served(t, upgrader);
	await service.check();
	published.length = 0;
	await assert.rejects(service.startUpgrade('in-place'), (error) => {
		assert.equal(error.code, 'unavailable');
		assert.equal(error.details.reason, 'trigger-failed');
		assert.doesNotMatch(
			error.message,
			/EACCES|\/run/u,
			"host detail stays in the server's log",
		);
		return true;
	});
	assert.deepEqual(
		published.map((status) => status.upgrade.state),
		['in-progress', 'none'],
	);
	assert.deepEqual(diagnostics, [
		{
			kind: 'trigger-failed',
			message: 'EACCES: /run/terminay-upgrade/request',
		},
	]);
	// It can be asked for again.
	upgrader.triggerResult = undefined;
	assert.equal(
		(await service.startUpgrade('in-place')).upgrade.state,
		'in-progress',
	);
});

test('an upgrade that ends while the server is still running stops being in progress', async (t) => {
	// The upgrader exits without having replaced the server.
	let finish;
	const upgrader = fakeUpgrader([report()]);
	upgrader.triggerResult = {
		ended: new Promise((resolve) => {
			finish = resolve;
		}),
	};
	const { clock, service } = served(t, upgrader);
	await service.check();
	await service.startUpgrade('in-place');
	assert.equal(clock.deadlines, 1);
	upgrader.answer(
		report({
			lastResult: {
				from: '5.1.1',
				to: '5.2.0',
				outcome: 'rolled-back',
				reason: 'download failed',
				at: '2026-10-11T10:00:00.000Z',
			},
		}),
	);
	finish();
	await new Promise((resolve) => setImmediate(resolve));
	await service.check();
	assert.equal(clock.deadlines, 0);
	assert.equal(service.status.upgrade.state, 'failed');
	assert.equal(service.status.upgrade.reason, 'download failed');

	// A request file gives nothing to watch, so a deadline ends the wait.
	const system = fakeUpgrader([
		report({
			environment: 'system',
			trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
		}),
	]);
	const second = served(t, system);
	await second.service.check();
	await second.service.startUpgrade('in-place');
	second.clock.advance(SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS - 1);
	assert.equal(second.service.status.upgrade.state, 'in-progress');
	second.clock.advance(1);
	await second.service.check();
	assert.equal(second.service.status.upgrade.state, 'none');
	assert.equal(system.checks, 2);
});
