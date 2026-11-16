import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createFileServerUpgradeAttemptStore,
	SERVER_UPGRADE_ATTEMPT_FILE,
	SERVER_UPGRADE_BIND_DEADLINE_MS,
	SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS,
	ServerUpgradeService,
} from '../dist/index.js';

const LIFETIME = SERVER_UPGRADE_IN_PROGRESS_DEADLINE_MS;
const BIND = SERVER_UPGRADE_BIND_DEADLINE_MS;
const RECORD = '/opt/terminay/upgrade-result.json';
const REV_A = 'a'.repeat(40);
const REV_B = 'b'.repeat(40);
const settle = async () => {
	for (let i = 0; i < 5; i += 1)
		await new Promise((resolve) => setImmediate(resolve));
};

/** One host: a clock, the upgrader's record, and the server's data root. */
function host() {
	let now = Date.parse('2026-11-16T07:40:00.000Z');
	let nextId = 0;
	const timers = new Map();
	const clock = {
		now: () => now,
		setInterval(handler, ms) {
			const id = ++nextId;
			timers.set(id, { at: now + ms, handler, every: ms });
			return id;
		},
		clearInterval: (id) => timers.delete(id),
		setTimeout(handler, ms) {
			const id = ++nextId;
			timers.set(id, { at: now + ms, handler });
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
		async advance(ms) {
			const target = now + ms;
			for (;;) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= target)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (due === undefined) break;
				now = due[1].at;
				if (due[1].every === undefined) timers.delete(due[0]);
				else due[1].at += due[1].every;
				due[1].handler();
				await settle();
			}
			now = target;
			await settle();
		},
	};
	const iso = (offset = 0) => new Date(now + offset).toISOString();
	const watchers = new Set();
	const machine = {
		clock,
		iso,
		record: undefined,
		installedRevision: REV_A,
		available: { version: '6.10.0-main.3493.canary', revision: REV_B },
		kept: undefined,
		saveError: undefined,
		watchError: undefined,
		checks: 0,
		handovers: [],
		exits: [],
		write(record) {
			machine.record = record;
			for (const listener of watchers) listener('record');
		},
		rewriteInstall(revision) {
			machine.installedRevision = revision;
			for (const listener of watchers) listener('install');
		},
		get watching() {
			return watchers.size;
		},
		store: {
			load: async () =>
				machine.kept === undefined ? undefined : JSON.parse(machine.kept),
			save: async (attempt) => {
				if (machine.saveError !== undefined) throw machine.saveError;
				machine.kept = JSON.stringify(attempt);
			},
			restore: async (attempt) => {
				machine.kept =
					attempt === undefined ? undefined : JSON.stringify(attempt);
			},
		},
		upgrader: {
			async check() {
				machine.checks += 1;
				return {
					environment: 'system',
					installed: {
						channel: 'canary',
						version: '6.10.0-main.3493.canary',
						revision: machine.installedRevision,
					},
					available: machine.available,
					canUpgrade: true,
					modes: ['in-place'],
					trigger: { kind: 'request-file', path: '/var/lib/terminay-upgrade/request' },
					unavailable: null,
					recordPath: RECORD,
					lastResult: machine.record ?? null,
				};
			},
			async trigger(handover) {
				machine.handovers.push(handover);
				if (machine.spawn) {
					let exit;
					const ended = new Promise((resolve) => {
						exit = resolve;
					});
					machine.exits.push(exit);
					return { ended };
				}
				return undefined;
			},
			async readRecord(path) {
				assert.equal(path, RECORD);
				return machine.record;
			},
			watchRecord(path, listener) {
				assert.equal(path, RECORD);
				if (machine.watchError !== undefined) throw machine.watchError;
				watchers.add(listener);
				return { close: () => watchers.delete(listener) };
			},
		},
		/** A server process on this host, as the launcher starts it. */
		serve(t, revision = REV_A, options = {}) {
			const diagnostics = [];
			const service = new ServerUpgradeService({
				serverVersion: '6.10.0-main.3493.canary',
				serverRevision: revision,
				upgrader: machine.upgrader,
				attemptStore: machine.store,
				now: clock.now,
				setInterval: clock.setInterval,
				clearInterval: clock.clearInterval,
				setTimeout: clock.setTimeout,
				clearTimeout: clock.clearTimeout,
				randomId: () => `attempt-${++nextId}`,
				onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
				...options,
			});
			const attempts = [];
			service.subscribeAttempt((state) => attempts.push(state.attempt));
			t.after(() => service.dispose());
			return { service, attempts, diagnostics };
		},
	};
	return machine;
}

const started = (machine, run, offset = 0) => ({
	run,
	runStartedAt: machine.iso(offset),
	from: 'canary-aaaaaaaaaaaa',
	to: 'canary-aaaaaaaaaaaa',
	fromRelease: { channel: 'canary', version: '6.10.0-main.3493.canary', revision: REV_A },
	outcome: 'started',
	at: machine.iso(offset),
});

const ended = (machine, run, outcome, runStartedAt, extra = {}) => ({
	run,
	runStartedAt,
	from: 'canary-aaaaaaaaaaaa',
	to: outcome === 'unchanged' ? 'canary-aaaaaaaaaaaa' : 'canary-bbbbbbbbbbbb',
	fromRelease: { channel: 'canary', version: '6.10.0-main.3493.canary', revision: REV_A },
	toRelease: {
		channel: 'canary',
		version: '6.10.0-main.3493.canary',
		revision: outcome === 'unchanged' ? REV_A : REV_B,
	},
	outcome,
	at: machine.iso(),
	...extra,
});

test('a start creates, keeps, and publishes an attempt before the handover, one at a time', async (t) => {
	const machine = host();
	const { service, attempts } = machine.serve(t);
	await service.check();
	let keptAtHandover;
	const trigger = machine.upgrader.trigger;
	machine.upgrader.trigger = async (handover) => {
		keptAtHandover = machine.kept;
		return trigger(handover);
	};
	const first = service.startUpgrade('in-place', { requestId: 'req-1' });
	// A second start, from any device, while the first is being handed over.
	await assert.rejects(service.startUpgrade('in-place'), (error) => {
		assert.equal(error.details.reason, 'in-progress');
		return true;
	});
	const status = await first;
	assert.equal(status.upgrade.state, 'in-progress');
	assert.equal(machine.handovers.length, 1);
	const kept = JSON.parse(keptAtHandover);
	assert.equal(kept.requestId, 'req-1');
	assert.equal(kept.expiresAt, kept.startedAt + LIFETIME);
	assert.deepEqual(kept.from, {
		channel: 'canary',
		version: '6.10.0-main.3493.canary',
		revision: REV_A,
	});
	assert.deepEqual(service.attemptState.attempt, {
		id: kept.id,
		requestId: 'req-1',
		mode: 'in-place',
		kind: 'upgrade',
		startedAt: kept.startedAt,
		expiresAt: kept.expiresAt,
		stage: 'requested',
	});
	assert.equal(attempts.at(-1).id, kept.id);
	// The record is watched while the attempt is pending.
	assert.equal(machine.watching, 1);
});

test('an attempt that cannot be kept is refused, and nothing is handed over', async (t) => {
	const machine = host();
	machine.saveError = new Error('EROFS');
	const { service, diagnostics } = machine.serve(t);
	await service.check();
	await assert.rejects(service.startUpgrade('in-place'), (error) => {
		assert.equal(error.code, 'unavailable');
		return true;
	});
	assert.equal(machine.handovers.length, 0);
	assert.equal(service.attemptState.attempt, null);
	assert.equal(service.status.upgrade.state, 'none');
	assert.deepEqual(diagnostics.map((d) => d.kind), ['attempt-store']);
});

test('a handover that fails leaves no attempt behind', async (t) => {
	const machine = host();
	const { service } = machine.serve(t);
	await service.check();
	machine.upgrader.trigger = async () => {
		throw new Error('EACCES');
	};
	await assert.rejects(service.startUpgrade('in-place'));
	assert.equal(service.attemptState.attempt, null);
	assert.equal(machine.kept, undefined);
	assert.equal(machine.watching, 0);
});

test('the run that finds nothing to do ends the attempt at once, as unchanged', async (t) => {
	// The sequence that left a phone on Installing: the helper ran, found the
	// build already installed, and said nothing.
	const machine = host();
	const { service, attempts } = machine.serve(t);
	await service.check();
	await service.startUpgrade('in-place', { requestId: 'req-1' });
	const startedAt = machine.iso(500);
	await machine.clock.advance(500);
	machine.write(started(machine, 'run-1'));
	await settle();
	assert.equal(service.attemptState.attempt.stage, 'installing');
	assert.equal(JSON.parse(machine.kept).run.id, 'run-1');
	await machine.clock.advance(2_000);
	const checks = machine.checks;
	machine.write(ended(machine, 'run-1', 'unchanged', startedAt));
	await settle();
	const { attempt } = service.attemptState;
	assert.equal(attempt.stage, undefined);
	assert.deepEqual(
		{ ...attempt.ending, at: undefined },
		{
			kind: 'unchanged',
			from: '6.10.0-main.3493.canary',
			to: '6.10.0-main.3493.canary',
			at: undefined,
		},
	);
	// A client that predates attempts reads it through the unchanged status.
	assert.deepEqual(
		{ ...service.status.upgrade, at: undefined },
		{
			state: 'succeeded',
			from: '6.10.0-main.3493.canary',
			to: '6.10.0-main.3493.canary',
			at: undefined,
		},
	);
	// The channel is looked at again, and the watch let go.
	assert.ok(machine.checks > checks);
	assert.equal(machine.watching, 0);
	assert.deepEqual(
		attempts.map((a) => a?.stage ?? a?.ending.kind),
		['requested', 'installing', 'unchanged'],
	);
	// Kept as the last attempt.
	assert.equal(JSON.parse(machine.kept).ending.kind, 'unchanged');
});

test("another run's records, and records from before the attempt, change nothing", async (t) => {
	const machine = host();
	const { service } = machine.serve(t);
	await service.check();
	// An operator's run that started before the attempt.
	const before = machine.iso(-60_000);
	await service.startUpgrade('in-place');
	machine.write(started(machine, 'operator', -60_000));
	await settle();
	assert.equal(service.attemptState.attempt.stage, 'requested');
	machine.write(ended(machine, 'operator', 'succeeded', before));
	await settle();
	assert.equal(service.attemptState.attempt.stage, 'requested');
	// The attempt's own run is bound, and a different run's ending ignored.
	await machine.clock.advance(1_000);
	const mine = machine.iso();
	machine.write(started(machine, 'mine'));
	await settle();
	machine.write(ended(machine, 'other', 'failed', mine, { reason: 'x' }));
	await settle();
	assert.equal(service.attemptState.attempt.stage, 'installing');
	machine.write(
		ended(machine, 'mine', 'rolled-back', mine, { reason: 'did not become ready' }),
	);
	await settle();
	assert.equal(service.attemptState.attempt.ending.kind, 'rolled-back');
	assert.equal(service.attemptState.attempt.ending.reason, 'did not become ready');
	// A build named by its commit when the version string is shared.
	assert.equal(
		service.attemptState.attempt.ending.to,
		'6.10.0-main.3493.canary (bbbbbbb)',
	);
});

test('an ending read without its start record still binds by when its run began', async (t) => {
	const machine = host();
	const { service } = machine.serve(t);
	await service.check();
	await service.startUpgrade('in-place');
	await machine.clock.advance(1_000);
	// The start and the ending were replaced faster than the watch reported.
	machine.write(ended(machine, 'quick', 'failed', machine.iso(-500), { reason: 'nothing was changed: offline' }));
	await settle();
	assert.equal(service.attemptState.attempt.ending.kind, 'failed');
	assert.equal(service.status.upgrade.state, 'failed');
	assert.equal(service.status.upgrade.reason, 'nothing was changed: offline');
});

test('an upgrade that restarts the server is finished by the server it started', async (t) => {
	const machine = host();
	const first = machine.serve(t);
	await first.service.check();
	await first.service.startUpgrade('in-place', { requestId: 'req-1' });
	const runStartedAt = machine.iso(1_000);
	await machine.clock.advance(1_000);
	machine.write(started(machine, 'run-1'));
	await settle();
	const id = first.service.attemptState.attempt.id;
	// The upgrader stops this server and starts the new build.
	first.service.dispose();
	await machine.clock.advance(5_000);
	const second = machine.serve(t, REV_B);
	second.service.start();
	await settle();
	assert.deepEqual(
		{ id: second.service.attemptState.attempt.id, stage: second.service.attemptState.attempt.stage },
		{ id, stage: 'finishing' },
	);
	// The install record still names the build replaced: nothing is offered.
	assert.equal(second.service.status.available, undefined);
	assert.equal(second.service.status.upgrade.state, 'in-progress');
	machine.write(ended(machine, 'run-1', 'succeeded', runStartedAt));
	machine.rewriteInstall(REV_B);
	await settle();
	assert.equal(second.service.attemptState.attempt.ending.kind, 'succeeded');
	assert.equal(second.service.status.upgrade.state, 'succeeded');

	// A second restart reads the outcome, and touches nothing.
	second.service.dispose();
	const third = machine.serve(t, REV_B);
	third.service.start();
	await settle();
	assert.equal(third.service.attemptState.attempt.id, id);
	assert.equal(third.service.attemptState.attempt.ending.kind, 'succeeded');
	assert.equal(machine.watching, 0);
});

test('a server restarted before the helper started keeps waiting on the same deadline', async (t) => {
	const machine = host();
	const first = machine.serve(t);
	await first.service.check();
	await first.service.startUpgrade('in-place');
	first.service.dispose();
	await machine.clock.advance(60_000);
	const second = machine.serve(t);
	second.service.start();
	await settle();
	assert.equal(second.service.attemptState.attempt.stage, 'requested');
	// One minute was spent: the bind deadline is a minute away, not two.
	await machine.clock.advance(BIND - 60_000 - 1);
	assert.equal(second.service.attemptState.attempt.stage, 'requested');
	await machine.clock.advance(1);
	const { ending } = second.service.attemptState.attempt;
	assert.equal(ending.kind, 'failed');
	assert.match(ending.reason, /the upgrader did not start/u);
	assert.match(ending.reason, /sudo terminay daemon upgrade --system/u);
});

test('an attempt that outlives its expiry ends as unknown, never as success, across restarts', async (t) => {
	const machine = host();
	const first = machine.serve(t);
	await first.service.check();
	await first.service.startUpgrade('in-place');
	await machine.clock.advance(1_000);
	machine.write(started(machine, 'run-1'));
	await settle();
	for (let restart = 0; restart < 3; restart += 1) {
		await machine.clock.advance(5 * 60_000);
		first.service.dispose();
	}
	// A new build runs, but its run never said how it ended.
	const later = machine.serve(t, REV_B);
	later.service.start();
	await settle();
	assert.equal(later.service.attemptState.attempt.stage, 'finishing');
	await machine.clock.advance(LIFETIME);
	const { ending } = later.service.attemptState.attempt;
	assert.equal(ending.kind, 'failed');
	assert.match(ending.reason, /did not report how it ended; the server now runs 6\.10\.0-main\.3493\.canary \(bbbbbbb\)/u);
	assert.notEqual(later.service.status.upgrade.state, 'succeeded');

	// Already expired when a server takes it up: ended at once, nothing armed.
	const machine2 = host();
	const early = machine2.serve(t);
	await early.service.check();
	await early.service.startUpgrade('in-place');
	early.service.dispose();
	await machine2.clock.advance(LIFETIME + 1);
	const late = machine2.serve(t);
	late.service.start();
	await settle();
	assert.equal(late.service.attemptState.attempt.ending.kind, 'failed');
});

test('a spawned upgrader that exits without an ending ends the attempt as failed', async (t) => {
	const machine = host();
	machine.spawn = true;
	const { service } = machine.serve(t);
	await service.check();
	await service.startUpgrade('in-place');
	machine.exits[0]();
	await settle();
	const { ending } = service.attemptState.attempt;
	assert.equal(ending.kind, 'failed');
	assert.match(ending.reason, /exited without recording how it ended/u);

	// One that recorded its ending just before it exited is read at the exit,
	// even when the watch never reported it.
	const other = host();
	other.spawn = true;
	other.watchError = new Error('ENOSPC');
	const second = other.serve(t);
	await second.service.check();
	await second.service.startUpgrade('in-place');
	await other.clock.advance(100);
	other.record = ended(other, 'run-9', 'unchanged', other.iso());
	other.exits[0]();
	await settle();
	assert.equal(second.service.attemptState.attempt.ending.kind, 'unchanged');
	assert.ok(second.diagnostics.some((d) => d.kind === 'record-watch'));
});

test('a run already under way on the host refuses a start', async (t) => {
	const machine = host();
	machine.record = started(machine, 'operator', -60_000);
	const { service } = machine.serve(t);
	await service.check();
	await assert.rejects(service.startUpgrade('in-place'), (error) => {
		assert.equal(error.details.reason, 'in-progress');
		return true;
	});
	assert.equal(machine.handovers.length, 0);
	// Once it is old enough to be abandoned, it no longer holds the server.
	await machine.clock.advance(LIFETIME);
	await service.startUpgrade('in-place');
	assert.equal(machine.handovers.length, 1);
});

test('builds are compared by revision', async (t) => {
	const machine = host();
	// The install record names another build: just restarted by an upgrade.
	machine.installedRevision = REV_B;
	const stale = machine.serve(t, REV_A);
	stale.service.clientAttached('c1');
	await settle();
	assert.equal(stale.service.status.available, undefined);
	assert.equal(stale.service.status.latest, undefined);
	assert.equal(machine.watching, 1, 'a stale record is watched');
	// Attaching while stale checks again, whatever the hourly gate says.
	const checks = machine.checks;
	stale.service.clientAttached('c2');
	await settle();
	assert.equal(machine.checks, checks + 1);
	// The record is rewritten: offers return, the watch is let go.
	machine.rewriteInstall(REV_A);
	await settle();
	assert.equal(stale.service.status.available.version, '6.10.0-main.3493.canary');
	assert.equal(machine.watching, 0);
	stale.service.dispose();

	// The channel's newest build is the one this server runs: not an upgrade,
	// whatever the record says.
	const own = host();
	own.available = { version: '6.10.0-main.3493.canary', revision: REV_A };
	const current = own.serve(t, REV_A);
	await current.service.check();
	assert.equal(current.service.status.available, undefined);
	await assert.rejects(current.service.startUpgrade('in-place'));
});

test('a kept attempt that is not one is ignored', async (t) => {
	const machine = host();
	machine.kept = JSON.stringify({ schemaVersion: 1, id: 'x' });
	const { service, diagnostics } = machine.serve(t);
	service.start();
	await settle();
	assert.equal(service.attemptState.attempt, null);
	assert.ok(diagnostics.some((d) => d.kind === 'attempt-store'));
});

test('the file store keeps an attempt in the data root, durably, and ignores garbage', async () => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-attempt-'));
	try {
		const store = createFileServerUpgradeAttemptStore(dataRoot);
		assert.equal(await store.load(), undefined);
		const attempt = {
			schemaVersion: 1,
			id: 'a1',
			mode: 'in-place',
			kind: 'upgrade',
			startedAt: 1,
			expiresAt: 2,
			from: { channel: 'tag', version: '5.1.1' },
		};
		await store.save(attempt);
		assert.deepEqual(await store.load(), attempt);
		assert.deepEqual(
			JSON.parse(await readFile(join(dataRoot, SERVER_UPGRADE_ATTEMPT_FILE), 'utf8')),
			attempt,
		);
		await store.restore(undefined);
		assert.equal(await store.load(), undefined);
		await writeFile(join(dataRoot, SERVER_UPGRADE_ATTEMPT_FILE), '{ not json');
		assert.equal(await store.load(), undefined);
	} finally {
		await rm(dataRoot, { recursive: true, force: true });
	}
});
