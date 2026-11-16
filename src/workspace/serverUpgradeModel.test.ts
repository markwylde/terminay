import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerUpgradeStatus } from '@terminay/client-core';
import {
	activeServerUpgradeVersion,
	createServerUpgradeMemory,
	isLocalConnection,
	preselectedUpgradeMode,
	requestServerUpgrade,
	SERVER_UPGRADE_MEMORY_MAX_AGE_MS,
	ServerUpgradeBoard,
	type ServerUpgradeSource,
	serverUpgradeRow,
	serverUpgradeRows,
	serverUpgradeSources,
	upgradeAvailableSuffix,
	upgradeConsequenceText,
} from './serverUpgradeModel.ts';

function status(
	overrides: Partial<ServerUpgradeStatus> = {},
): ServerUpgradeStatus {
	return {
		version: '5.1.1',
		channel: 'tag',
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: { state: 'none' },
		...overrides,
	};
}

const AVAILABLE = { available: { version: '5.2.0' } } as const;

/** One connection's client, as far as the board reads it. */
function fakeClient(initial?: ServerUpgradeStatus) {
	const listeners = new Set<(next: ServerUpgradeStatus | undefined) => void>();
	const store = {
		status: initial,
		subscribe(listener: (next: ServerUpgradeStatus | undefined) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return {
		store,
		listeners,
		publish(next: ServerUpgradeStatus) {
			store.status = next;
			for (const listener of [...listeners]) listener(next);
		},
	};
}

function source(
	profileId: string,
	client: ReturnType<typeof fakeClient> | undefined,
	overrides: Partial<ServerUpgradeSource> = {},
): ServerUpgradeSource {
	return {
		profileId,
		label: profileId,
		phase: 'ready',
		...(client === undefined ? {} : { client }),
		...overrides,
	};
}

/** A clock the test owns, so the deadline is one-shot and observable. */
function fakeTimers() {
	const pending = new Map<number, () => void>();
	let next = 0;
	return {
		pending,
		setTimer: (run: () => void) => {
			next += 1;
			pending.set(next, run);
			return next;
		},
		clearTimer: (handle: unknown) => {
			pending.delete(handle as number);
		},
		fire() {
			const runs = [...pending.values()];
			pending.clear();
			for (const run of runs) run();
		},
	};
}

test('one server’s status never describes another attached server', () => {
	const board = new ServerUpgradeBoard();
	const vps = fakeClient(status(AVAILABLE));
	const build = fakeClient(status({ version: '5.2.0' }));
	board.sync([source('vps', vps), source('build', build)]);
	assert.deepEqual(
		board.snapshot.entries.map((entry) => [
			entry.profileId,
			entry.status.available?.version,
		]),
		[
			['vps', '5.2.0'],
			['build', undefined],
		],
	);
	// The header names the active tab's server and no other attached one.
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'vps'),
		'5.2.0',
	);
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'build'),
		undefined,
	);
	// Each keeps its own row: one offers its upgrade, the other only a check.
	assert.deepEqual(
		serverUpgradeRows(board.snapshot.entries).map((row) => [
			row.profileId,
			row.action,
		]),
		[
			['vps', 'upgrade'],
			['build', 'none'],
		],
	);
	// A later publication from one changes only its own entry.
	build.publish(status({ version: '5.2.0', available: { version: '5.3.0' } }));
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'vps'),
		'5.2.0',
	);
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'build'),
		'5.3.0',
	);
	// Detaching one takes its status with it and leaves the other.
	board.sync([source('build', build)]);
	assert.deepEqual(
		board.snapshot.entries.map((entry) => entry.profileId),
		['build'],
	);
	assert.equal(vps.listeners.size, 0);
});

test('Local is never shown an upgrade, whatever its server reports', () => {
	const client = { store: fakeClient(status(AVAILABLE)).store };
	const local = {
		profileId: 'local',
		serverId: 'server-local',
		label: 'Local',
		phase: 'ready' as const,
		context: { serverUpgradeClient: client },
	};
	const remote = {
		...local,
		profileId: 'remote:vps',
		serverId: 'server-vps',
		label: 'VPS',
	};
	const profiles = [
		{ id: 'local', isLocal: true, serverId: 'server-local' },
		{ id: 'remote:vps' },
	];
	assert.equal(isLocalConnection(local, profiles), true);
	assert.equal(isLocalConnection(remote, profiles), false);
	// Recognised by the server it reaches too, and from the bootstrap context
	// before the host has listed its profiles.
	assert.equal(
		isLocalConnection(
			{ profileId: 'other', serverId: 'server-local' },
			profiles,
		),
		true,
	);
	// The window's own connection is described by Desktop, not by its id.
	assert.equal(
		isLocalConnection(
			{ profileId: 'primary', hostContext: { profile: { isLocal: true } } },
			[],
		),
		true,
	);
	assert.equal(
		isLocalConnection({ profileId: 'primary', hostContext: {} }, []),
		true,
	);
	assert.equal(
		isLocalConnection(
			{ profileId: 'primary', hostContext: { profile: { isLocal: false } } },
			profiles,
		),
		false,
	);
	// A browser session's connection has no Desktop behind it and is a server.
	assert.equal(isLocalConnection({ profileId: 'primary' }, []), false);
	const sources = serverUpgradeSources([local, remote], profiles);
	assert.deepEqual(
		sources.map((entry) => entry.profileId),
		['remote:vps'],
	);
	const board = new ServerUpgradeBoard();
	board.sync(sources);
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'local'),
		undefined,
	);
	assert.deepEqual(
		serverUpgradeRows(board.snapshot.entries).map((row) => row.label),
		['VPS'],
	);
});

test('each status shape gives the menu row its own content', () => {
	const row = (next: ServerUpgradeStatus, reachable = true) =>
		serverUpgradeRow({
			profileId: 'vps',
			label: 'VPS',
			status: next,
			reachable,
		});
	// A server without an upgrader has nothing to say and nothing to check.
	assert.equal(row(status({ channel: undefined })), undefined);
	// One with an upgrader keeps a row, so it can be asked to check now.
	assert.deepEqual(row(status()), {
		profileId: 'vps',
		label: 'VPS',
		version: '5.1.1',
		action: 'none',
		reachable: true,
		checkable: true,
	});
	assert.deepEqual(row(status(AVAILABLE)), {
		profileId: 'vps',
		label: 'VPS',
		version: '5.1.1',
		action: 'upgrade',
		reachable: true,
		checkable: true,
		available: '5.2.0',
	});
	const manual = row(
		status({
			...AVAILABLE,
			canUpgrade: false,
			modes: [],
			unavailable: {
				reason:
					'This server runs as a system service without the upgrade helper.',
				command: 'sudo terminay daemon upgrade',
			},
		}),
	);
	assert.equal(manual?.action, 'manual');
	assert.equal(manual?.command, 'sudo terminay daemon upgrade');
	assert.match(manual?.reason ?? '', /upgrade helper/);
	// Driven by the server's status, so every attached client sees it.
	const upgrading = row(
		status({
			...AVAILABLE,
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 },
		}),
	);
	assert.equal(upgrading?.action, 'upgrading');
	// A client that attaches after a rollback reads it from the row.
	const failed = row(
		status({
			...AVAILABLE,
			upgrade: {
				state: 'failed',
				from: '5.1.1',
				to: '5.2.0',
				reason: 'the new release did not become ready.',
				restored: true,
				at: 9,
			},
		}),
	);
	assert.equal(failed?.action, 'upgrade');
	assert.equal(
		failed?.failure,
		'Upgrading VPS failed: the new release did not become ready. 5.1.1 is running again.',
	);
	assert.equal(row(status(AVAILABLE), false)?.reachable, false);
	assert.equal(upgradeAvailableSuffix('5.2.0'), ', upgrade to 5.2.0 available');
	assert.equal(upgradeAvailableSuffix(undefined), '');
});

test('the outcome of a watched upgrade is told once, across the reconnect', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	let published = 0;
	board.subscribe(() => {
		published += 1;
	});
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	before.publish(
		status({
			...AVAILABLE,
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 },
		}),
	);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries)[0]?.action,
		'upgrading',
	);
	// The server restarts: the row keeps saying so through the gap.
	board.sync([source('vps', before, { phase: 'reconnecting' })]);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries)[0]?.action,
		'upgrading',
	);
	assert.equal(timers.pending.size, 1);
	const done = status({
		version: '5.2.0',
		upgrade: { state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 77 },
	});
	const after = fakeClient();
	board.sync([source('vps', after)]);
	after.publish(done);
	assert.deepEqual(
		board.snapshot.notices.map((notice) => [notice.tone, notice.text]),
		[['success', 'vps is now on 5.2.0.']],
	);
	assert.equal(timers.pending.size, 0);
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'vps'),
		undefined,
	);
	// Published again, re-rendered, and read again after another reconnect.
	const revisions = published;
	after.publish({ ...done });
	board.sync([source('vps', after)]);
	board.sync([source('vps', fakeClient(done))]);
	assert.equal(board.snapshot.notices.length, 1);
	board.dismiss(board.snapshot.notices[0]?.id ?? '');
	assert.equal(board.snapshot.notices.length, 0);
	board.sync([source('vps', fakeClient(done))]);
	assert.equal(board.snapshot.notices.length, 0);
	assert.ok(published > revisions);
});

test('a rollback is told with its reason and the restored version', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before, { label: 'VPS' })]);
	// This window began it; the server restarted before saying so.
	board.markStarted('vps');
	board.sync([
		source('vps', undefined, { label: 'VPS', phase: 'reconnecting' }),
	]);
	const after = fakeClient(
		status({
			...AVAILABLE,
			upgrade: {
				state: 'failed',
				from: '5.1.1',
				to: '5.2.0',
				reason: 'readiness timed out',
				restored: true,
				at: 80,
			},
		}),
	);
	board.sync([source('vps', after, { label: 'VPS' })]);
	assert.deepEqual(
		board.snapshot.notices.map((notice) => [notice.tone, notice.text]),
		[
			[
				'failure',
				'Upgrading VPS failed: readiness timed out. 5.1.1 is running again.',
			],
		],
	);
	// The warning stays: the upgrade is still there to take.
	assert.equal(
		activeServerUpgradeVersion(board.snapshot.entries, 'vps'),
		'5.2.0',
	);
});

test('a client that attaches after the outcome is not told about an upgrade it never watched', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const failed = status({
		...AVAILABLE,
		upgrade: {
			state: 'failed',
			from: '5.1.1',
			to: '5.2.0',
			restored: true,
			at: 80,
		},
	});
	board.sync([source('vps', fakeClient(failed))]);
	assert.equal(board.snapshot.notices.length, 0);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries)[0]?.failure,
		'Upgrading vps failed. 5.1.1 is running again.',
	);
	// Beginning another attempt does not turn the old outcome into news.
	const client = fakeClient(failed);
	board.sync([source('vps', client)]);
	board.markStarted('vps');
	client.publish({ ...failed });
	assert.equal(board.snapshot.notices.length, 0);
});

test('a server that does not come back by the deadline is reported once', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	const before = fakeClient(
		status({
			...AVAILABLE,
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 },
		}),
	);
	board.sync([source('vps', before)]);
	// Nothing is armed while the connection is up: a deadline, not a poll.
	assert.equal(timers.pending.size, 0);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	board.sync([source('vps', undefined, { phase: 'connecting' })]);
	assert.equal(timers.pending.size, 1);
	timers.fire();
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['vps did not come back after the upgrade.'],
	);
	assert.equal(board.snapshot.entries.length, 0);
	assert.equal(timers.pending.size, 0);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(timers.pending.size, 0);
	assert.equal(board.snapshot.notices.length, 1);
});

test('a server that returns in time is not reported lost', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	const running = status({
		...AVAILABLE,
		upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 },
	});
	board.sync([source('vps', fakeClient(running))]);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	// Back mid-upgrade: still running, and no longer gone. It still has the
	// one deadline to say how the upgrade ended.
	board.sync([source('vps', fakeClient(running))]);
	assert.equal(timers.pending.size, 1);
	assert.equal(board.snapshot.notices.length, 0);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries)[0]?.action,
		'upgrading',
	);
});

test('an upgrade that ends without a restart is told, and a later disconnect is not a lost server', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('vps', client)]);
	client.publish(
		status({
			...AVAILABLE,
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1 },
		}),
	);
	// The upgrader finished while the server stayed up; the outcome follows,
	// within the deadline.
	client.publish(status(AVAILABLE));
	board.sync([source('vps', client, { phase: 'reconnecting' })]);
	assert.equal(timers.pending.size, 1);
	const back = fakeClient();
	board.sync([source('vps', back)]);
	back.publish(
		status({
			...AVAILABLE,
			upgrade: {
				state: 'failed',
				from: '5.1.1',
				to: '5.2.0',
				restored: true,
				at: 5,
			},
		}),
	);
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['Upgrading vps failed. 5.1.1 is running again.'],
	);
	// Nothing is followed any more: an ordinary drop arms nothing.
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(timers.pending.size, 0);
	assert.equal(board.snapshot.notices.length, 1);
});

/** This origin's storage, as far as the memory uses it. */
function fakeStorage() {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
	};
}

const RUNNING = status({
	...AVAILABLE,
	upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 1_000 },
});

test('an upgrade followed in one document is told by the next, once', () => {
	const storage = fakeStorage();
	const remote = (client: ReturnType<typeof fakeClient> | undefined) =>
		source('primary', client, { serverId: 'build-box', label: 'Build box' });
	// The window watches the upgrade begin, and the workspace goes away with
	// the server: nothing of this board survives.
	const first = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	const before = fakeClient(status(AVAILABLE));
	first.sync([remote(before)]);
	before.publish(RUNNING);
	first.dispose();

	const rolledBack = status({
		...AVAILABLE,
		upgrade: {
			state: 'failed',
			from: '5.1.1',
			to: '5.2.0',
			reason: 'the new release did not become ready',
			restored: true,
			at: 2_000,
		},
	});
	// The workspace is mounted again once the server answers.
	const second = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	const after = fakeClient();
	second.sync([remote(after)]);
	assert.equal(second.snapshot.notices.length, 0);
	after.publish(rolledBack);
	assert.deepEqual(
		second.snapshot.notices.map((notice) => notice.text),
		[
			'Upgrading Build box failed: the new release did not become ready. 5.1.1 is running again.',
		],
	);
	second.dispose();

	// A later reload reads the same outcome and says nothing more.
	const third = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	third.sync([remote(fakeClient(rolledBack))]);
	assert.equal(third.snapshot.notices.length, 0);
	// And another server on this device was never following anything.
	third.sync([
		remote(fakeClient(rolledBack)),
		source(
			'other',
			fakeClient(
				status({
					version: '5.2.0',
					upgrade: {
						state: 'succeeded',
						from: '5.1.1',
						to: '5.2.0',
						at: 3_000,
					},
				}),
			),
			{ serverId: 'vps' },
		),
	]);
	assert.equal(third.snapshot.notices.length, 0);
});

test('an upgrade begun here is remembered even when the server never said it started', () => {
	const storage = fakeStorage();
	const first = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	first.sync([
		source('primary', fakeClient(status(AVAILABLE)), { serverId: 'build-box' }),
	]);
	first.markStarted('primary');
	first.dispose();
	const second = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	// The outcome record was replaced before this window came back; the
	// version the server runs still says how it ended.
	second.sync([
		source('primary', fakeClient(status({ version: '5.2.0' })), {
			serverId: 'build-box',
			label: 'Build box',
		}),
	]);
	assert.deepEqual(
		second.snapshot.notices.map((notice) => notice.text),
		['Build box is now on 5.2.0.'],
	);
});

test('a remembered upgrade expires, and never claims an older outcome', () => {
	const storage = fakeStorage();
	let now = 10_000;
	const memory = () => createServerUpgradeMemory(storage, () => now);
	const follow = () => {
		const board = new ServerUpgradeBoard({ ...fakeTimers(), memory: memory() });
		const client = fakeClient(status(AVAILABLE));
		board.sync([source('primary', client, { serverId: 'build-box' })]);
		client.publish(RUNNING);
		board.dispose();
	};
	const returnWith = (at: number, version = '5.2.0') => {
		const board = new ServerUpgradeBoard({ ...fakeTimers(), memory: memory() });
		board.sync([
			source(
				'primary',
				fakeClient(
					status({
						version,
						upgrade: { state: 'succeeded', from: '5.1.0', to: version, at },
					}),
				),
				{ serverId: 'build-box' },
			),
		]);
		return board.snapshot.notices.length;
	};
	follow();
	assert.deepEqual(memory().read('build-box').following, {
		startedAt: 1_000,
		from: '5.1.1',
		to: '5.2.0',
		mode: 'in-place',
	});
	// An outcome from before this upgrade began belongs to an earlier one.
	assert.equal(returnWith(999, '5.1.1'), 0);
	follow();
	// A day on, the marker is dropped: a later outcome is someone else's.
	now += SERVER_UPGRADE_MEMORY_MAX_AGE_MS;
	assert.equal(memory().read('build-box').following, undefined);
	assert.equal(returnWith(5_000), 0);
});

test('memory is bounded, and storage that fails costs only the telling', () => {
	const storage = fakeStorage();
	const memory = createServerUpgradeMemory(storage);
	for (let index = 0; index < 40; index += 1)
		memory.write(`server-${index}`, {
			seen: Array.from({ length: 12 }, (_, at) => at),
		});
	const stored = JSON.parse([...storage.values.values()][0] ?? '{}');
	assert.equal(Object.keys(stored).length, 32);
	assert.equal(memory.read('server-0').seen.length, 0);
	assert.deepEqual(memory.read('server-39').seen, [4, 5, 6, 7, 8, 9, 10, 11]);
	// Nothing left to remember leaves nothing behind.
	memory.write('server-39', { seen: [] });
	assert.equal(
		'server-39' in JSON.parse([...storage.values.values()][0] ?? '{}'),
		false,
	);
	storage.values.set([...storage.values.keys()][0] ?? '', 'not json');
	assert.deepEqual(memory.read('server-1'), { seen: [] });

	const broken = createServerUpgradeMemory({
		getItem: () => {
			throw new Error('storage is disabled');
		},
		setItem: () => {
			throw new Error('storage is full');
		},
	});
	const board = new ServerUpgradeBoard({ ...fakeTimers(), memory: broken });
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('primary', client, { serverId: 'build-box' })]);
	client.publish(RUNNING);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries)[0]?.action,
		'upgrading',
	);
	assert.deepEqual(createServerUpgradeMemory(undefined).read('build-box'), {
		seen: [],
	});
});

test('nothing is sent until asked, and a refusal is put into words', async () => {
	const sent: string[] = [];
	const refusing = (reason: string) => ({
		startServerUpgrade: async (mode: string) => {
			sent.push(mode);
			// A feature client wraps the protocol error it was refused with.
			throw Object.assign(new Error('refused'), {
				cause: Object.assign(new Error('refused'), { details: { reason } }),
			});
		},
	});
	assert.equal(
		await requestServerUpgrade(refusing('in-progress'), 'in-place'),
		'An upgrade is already running.',
	);
	assert.equal(
		await requestServerUpgrade(refusing('none-available'), 'in-place'),
		'This server is already up to date.',
	);
	assert.equal(
		await requestServerUpgrade(refusing('something-new'), 'recreate'),
		'The upgrade could not be started.',
	);
	assert.deepEqual(sent, ['in-place', 'in-place', 'recreate']);
	assert.equal(
		await requestServerUpgrade(refusing('already-latest'), 'in-place', {
			allowOlder: true,
		}),
		'This server already runs the latest release on its channel.',
	);
	const options: unknown[] = [];
	await requestServerUpgrade(
		{
			startServerUpgrade: async (_mode: string, given?: unknown) => {
				options.push(given);
				return status();
			},
		},
		'in-place',
		{ allowOlder: true },
	);
	await requestServerUpgrade(
		{
			startServerUpgrade: async (_mode: string, given?: unknown) => {
				options.push(given);
				return status();
			},
		},
		'in-place',
	);
	assert.deepEqual(options, [{ allowOlder: true }, undefined]);
	assert.equal(
		await requestServerUpgrade(undefined, 'in-place'),
		'This server is not connected.',
	);
	// Accepted, or the reply lost to the restart the request caused.
	assert.equal(
		await requestServerUpgrade(
			{ startServerUpgrade: async () => status() },
			'in-place',
		),
		undefined,
	);
	assert.equal(
		await requestServerUpgrade(
			{
				startServerUpgrade: async () => {
					throw Object.assign(new Error('gone'), {
						cause: { code: 'unknown_command_outcome' },
					});
				},
			},
			'in-place',
		),
		undefined,
	);
});

test('in place is preselected, and each mode says what it costs', () => {
	assert.equal(preselectedUpgradeMode(['in-place', 'recreate']), 'in-place');
	assert.equal(preselectedUpgradeMode(['recreate', 'in-place']), 'in-place');
	assert.equal(preselectedUpgradeMode(['recreate']), 'recreate');
	assert.match(
		upgradeConsequenceText('in-place'),
		/drops briefly.*terminals keep running/,
	);
	assert.match(
		upgradeConsequenceText('recreate'),
		/Every terminal on this server ends/,
	);
	assert.doesNotMatch(upgradeConsequenceText('recreate'), /keep running/);
});

/** The ticklist's states, in order, for one server. */
function ticks(board: ServerUpgradeBoard, profileId = 'vps') {
	return board.snapshot.progress
		.find((progress) => progress.profileId === profileId)
		?.steps.map((step) => step.state)
		.join(' ');
}

function failedDetail(board: ServerUpgradeBoard, profileId = 'vps') {
	return board.snapshot.progress
		.find((progress) => progress.profileId === profileId)
		?.steps.find((step) => step.state === 'failed')?.detail;
}

const SUCCEEDED = status({
	version: '5.2.0',
	upgrade: { state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 5_000 },
});

/** Start an upgrade from this device and see the server restart for it. */
function startedAndRestarting(timers = fakeTimers()) {
	const board = new ServerUpgradeBoard(timers);
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	before.publish(RUNNING);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	return { board, timers };
}

test('a started upgrade is a ticklist from install, through the restart, to running', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	assert.equal(board.snapshot.progress.length, 0);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	const [progress] = board.snapshot.progress;
	assert.deepEqual(
		progress?.steps.map((step) => step.label),
		[
			'Starting the upgrade',
			'Installing 5.2.0',
			'Restarting the server',
			'Running 5.2.0',
		],
	);
	assert.equal(progress?.initiatedHere, true);
	assert.equal(ticks(board), 'done running waiting waiting');
	before.publish(RUNNING);
	assert.equal(ticks(board), 'done running waiting waiting');
	assert.equal(
		serverUpgradeRows(board.snapshot.entries, board.snapshot.progress)[0]?.step,
		'Installing 5.2.0',
	);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(ticks(board), 'done done running waiting');
	assert.equal(board.snapshot.progress[0]?.restarting, true);
	assert.equal(
		serverUpgradeRows(board.snapshot.entries, board.snapshot.progress)[0]?.step,
		'Restarting the server',
	);
	const back = fakeClient();
	board.sync([source('vps', back)]);
	assert.equal(board.snapshot.progress[0]?.restarting, false);
	back.publish(SUCCEEDED);
	assert.equal(ticks(board), 'done done done done');
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['vps is now on 5.2.0.'],
	);
	assert.equal(timers.pending.size, 0);
	// Kept until closed; closing takes the ticklist and leaves the notice.
	board.closeProgress('vps');
	assert.equal(board.snapshot.progress.length, 0);
	assert.equal(board.snapshot.notices.length, 1);
});

test('the recreate mode names its third step', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	board.sync([source('vps', fakeClient(status(AVAILABLE)))]);
	board.markStarted('vps', { mode: 'recreate', to: '5.2.0' });
	assert.equal(
		board.snapshot.progress[0]?.steps[2]?.label,
		'Recreating the container',
	);
});

test('every ending of a followed upgrade is a final ticklist state', () => {
	// Rolled back.
	{
		const { board } = startedAndRestarting();
		const back = fakeClient();
		board.sync([source('vps', back)]);
		back.publish(
			status({
				...AVAILABLE,
				upgrade: {
					state: 'failed',
					from: '5.1.1',
					to: '5.2.0',
					reason: 'not ready',
					restored: true,
					at: 5_000,
				},
			}),
		);
		assert.equal(ticks(board), 'done done done failed');
		assert.equal(
			failedDetail(board),
			'Upgrading vps failed: not ready. 5.1.1 is running again.',
		);
		assert.equal(board.snapshot.progress[0]?.outcome, 'failure');
	}
	// Back on the old version, saying nothing of an outcome.
	{
		const { board } = startedAndRestarting();
		board.sync([source('vps', fakeClient(status(AVAILABLE)))]);
		assert.equal(ticks(board), 'done done done failed');
		assert.equal(failedDetail(board), 'vps is still on 5.1.1.');
		assert.equal(board.snapshot.notices.length, 0);
	}
	// Back on the target version, saying nothing of an outcome.
	{
		const { board } = startedAndRestarting();
		board.sync([source('vps', fakeClient(status({ version: '5.2.0' })))]);
		assert.equal(ticks(board), 'done done done done');
		assert.equal(board.snapshot.notices.length, 1);
	}
	// Back, but silent about its upgrade until the deadline.
	{
		const { board, timers } = startedAndRestarting();
		board.sync([source('vps', fakeClient())]);
		assert.equal(ticks(board), 'done done running waiting');
		timers.fire();
		assert.equal(ticks(board), 'done done done failed');
		assert.equal(
			failedDetail(board),
			'vps came back but did not say how the upgrade ended.',
		);
		assert.equal(board.snapshot.notices.length, 0);
	}
	// Back as a server this client cannot speak to.
	{
		const { board } = startedAndRestarting();
		board.sync([
			source('vps', undefined, {
				phase: 'incompatible',
				error: 'Update Terminay Desktop to connect.',
			}),
		]);
		assert.equal(ticks(board), 'done done done failed');
		assert.equal(failedDetail(board), 'Update Terminay Desktop to connect.');
	}
	// Never back within the deadline; a later return changes nothing.
	{
		const { board, timers } = startedAndRestarting();
		timers.fire();
		assert.equal(ticks(board), 'done done failed waiting');
		assert.equal(
			failedDetail(board),
			'vps did not come back after the upgrade.',
		);
		board.sync([source('vps', fakeClient(SUCCEEDED))]);
		assert.equal(ticks(board), 'done done failed waiting');
	}
	// The connection layer gives up.
	{
		const { board } = startedAndRestarting();
		board.sync([source('vps', undefined, { phase: 'unreachable' })]);
		assert.equal(ticks(board), 'done done failed waiting');
		assert.equal(board.snapshot.notices.length, 1);
	}
});

test('an upgrader that finishes without a restart moves straight to running', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('vps', client)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	client.publish(RUNNING);
	client.publish(status(AVAILABLE));
	assert.equal(ticks(board), 'done done done running');
	client.publish(SUCCEEDED);
	assert.equal(ticks(board), 'done done done done');
});

test('another device follows from the status, and keeps nothing once it ends', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	before.publish(RUNNING);
	const [progress] = board.snapshot.progress;
	assert.equal(progress?.initiatedHere, false);
	assert.equal(progress?.to, '5.2.0');
	assert.equal(progress?.mode, 'in-place');
	assert.equal(ticks(board), 'done running waiting waiting');
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(board.snapshot.progress[0]?.restarting, true);
	board.sync([source('vps', fakeClient(SUCCEEDED))]);
	assert.equal(board.snapshot.progress.length, 0);
	assert.equal(board.snapshot.notices.length, 1);
});

test('a status that says it began before the reply makes one ticklist, this device’s', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('vps', client)]);
	client.publish(RUNNING);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	assert.equal(board.snapshot.progress.length, 1);
	assert.equal(board.snapshot.progress[0]?.initiatedHere, true);
});

test('nothing puts the ticklist away before the upgrade ends', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	board.closeProgress('vps');
	assert.equal(board.snapshot.progress.length, 1);
	before.publish(RUNNING);
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	assert.equal(board.snapshot.progress[0]?.restarting, true);
	board.closeProgress('vps');
	assert.equal(board.snapshot.progress.length, 1);
	board.sync([source('vps', fakeClient(SUCCEEDED))]);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	board.closeProgress('vps');
	assert.equal(board.snapshot.progress.length, 0);
});

test('a reload mid-upgrade restores this device’s ticklist with its target and mode', () => {
	const storage = fakeStorage();
	const first = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	first.sync([
		source('primary', fakeClient(status(AVAILABLE)), { serverId: 'build-box' }),
	]);
	first.markStarted('primary', { mode: 'recreate', to: '5.2.0' });
	first.dispose();
	const second = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	second.sync([
		source('primary', undefined, {
			serverId: 'build-box',
			phase: 'reconnecting',
		}),
	]);
	const [progress] = second.snapshot.progress;
	assert.equal(progress?.initiatedHere, true);
	assert.equal(progress?.to, '5.2.0');
	assert.equal(progress?.mode, 'recreate');
	assert.equal(progress?.restarting, true);
	assert.equal(ticks(second, 'primary'), 'done done running waiting');

	// An entry written before targets were remembered restores as watched.
	const older = fakeStorage();
	older.setItem(
		'terminay.view.server-upgrades.v1',
		JSON.stringify({
			'build-box': {
				seen: [],
				following: { from: '5.1.1', notedAt: Date.now() },
			},
		}),
	);
	const third = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(older),
	});
	third.sync([
		source('primary', undefined, {
			serverId: 'build-box',
			phase: 'reconnecting',
		}),
	]);
	assert.equal(third.snapshot.progress[0]?.initiatedHere, false);
});

test('a restarted server that says it is still upgrading does not move the start', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const before = fakeClient(status(AVAILABLE));
	board.sync([source('vps', before)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	board.sync([source('vps', undefined, { phase: 'reconnecting' })]);
	// The new process reports the upgrade in progress, stamped after the
	// outcome it goes on to report.
	const after = fakeClient(
		status({
			...AVAILABLE,
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: 200 },
		}),
	);
	board.sync([source('vps', after)]);
	after.publish(
		status({
			version: '5.2.0',
			upgrade: { state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 150 },
		}),
	);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.equal(ticks(board, 'vps'), 'done done done done');
});

test('an outcome already seen still ends a followed upgrade by the version it runs', () => {
	const storage = fakeStorage();
	storage.setItem(
		'terminay.view.server-upgrades.v1',
		JSON.stringify({
			s: {
				seen: [400],
				following: {
					from: '5.1.1',
					to: '5.2.0',
					mode: 'in-place',
					initiated: true,
					startedAt: 500,
					notedAt: Date.now(),
				},
			},
		}),
	);
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	board.sync([
		source(
			'p',
			fakeClient(
				status({
					version: '5.2.0',
					upgrade: { state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 400 },
				}),
			),
			{ serverId: 's' },
		),
	]);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	// Still on the old version, the same outcome ends it as not upgraded.
	const still = fakeStorage();
	still.setItem(
		'terminay.view.server-upgrades.v1',
		JSON.stringify({
			s: {
				seen: [400],
				following: {
					from: '5.1.1',
					to: '5.2.0',
					initiated: true,
					notedAt: Date.now(),
				},
			},
		}),
	);
	const other = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(still),
	});
	other.sync([
		source(
			'p',
			fakeClient(
				status({
					upgrade: { state: 'succeeded', from: '5.1.0', to: '5.1.1', at: 400 },
				}),
			),
			{ serverId: 's' },
		),
	]);
	assert.equal(other.snapshot.progress[0]?.outcome, 'failure');
});

test('a server that moves version without a restart or an outcome is upgraded', () => {
	const board = new ServerUpgradeBoard(fakeTimers());
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('vps', client)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	client.publish(status({ version: '5.2.0' }));
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
});

test('a followed upgrade can never wait for ever once the server is back', () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard(timers);
	const client = fakeClient(status(AVAILABLE));
	board.sync([source('vps', client)]);
	board.markStarted('vps', { mode: 'in-place', to: '5.2.0' });
	// Finished without a restart, on the same version, and then silent.
	client.publish(status(AVAILABLE));
	assert.equal(board.snapshot.progress[0]?.outcome, undefined);
	timers.fire();
	assert.equal(board.snapshot.progress[0]?.outcome, 'failure');
	assert.equal(ticks(board, 'vps'), 'done done done failed');
	board.closeProgress('vps');
	assert.equal(board.snapshot.progress.length, 0);
});

// ---------------------------------------------------------------------------
// Servers that publish their attempts (ADR-0125).

type Attempt = NonNullable<
	import('@terminay/client-core').ServerUpgradeAttempt
>;

/** A connection's client on a server that publishes attempts. */
function attemptClient(initial: ServerUpgradeStatus = status(AVAILABLE)) {
	const base = fakeClient(initial);
	const listeners = new Set<(next: Attempt | null | undefined) => void>();
	const sent: { mode: string; options: unknown }[] = [];
	let reply: (() => Promise<unknown>) | undefined;
	const attempts = {
		attempt: null as Attempt | null | undefined,
		subscribe(listener: (next: Attempt | null | undefined) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return {
		...base,
		attempts,
		sent,
		/** What the next start replies with. */
		replyWith(next: () => Promise<unknown>) {
			reply = next;
		},
		async startServerUpgrade(mode: string, options?: unknown) {
			sent.push({ mode, options });
			return reply === undefined ? base.store.status : reply();
		},
		publishAttempt(next: Attempt | null) {
			attempts.attempt = next;
			for (const listener of [...listeners]) listener(next);
		},
	};
}

const pendingAttempt = (overrides: Partial<Attempt> = {}): Attempt => ({
	id: 'attempt-1',
	requestId: 'req-1',
	mode: 'in-place',
	kind: 'upgrade',
	startedAt: 1_000,
	expiresAt: 1_801_000,
	stage: 'requested',
	...overrides,
});

const endedAttempt = (
	ending: Attempt['ending'],
	overrides: Partial<Attempt> = {},
): Attempt => {
	const { stage: _stage, ...rest } = pendingAttempt(overrides);
	return { ...rest, ending };
};

const stepStates = (board: ServerUpgradeBoard) =>
	board.snapshot.progress[0]?.steps.map((step) => `${step.id}:${step.state}`);

test('the attempt that finds nothing to install ends the ticklist at once', async () => {
	// What left a phone on Installing: the helper ran, found the build already
	// installed, and the card waited for an ending nobody would send.
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	const refusal = await board.startUpgrade('pop', client, 'in-place', {
		to: '5.2.0',
	});
	assert.equal(refusal, undefined);
	assert.deepEqual(client.sent, [
		{ mode: 'in-place', options: { requestId: 'req-1' } },
	]);
	assert.deepEqual(stepStates(board), [
		'start:running',
		'install:waiting',
		'restart:waiting',
		'running:waiting',
	]);
	client.publishAttempt(pendingAttempt());
	client.publishAttempt(pendingAttempt({ stage: 'installing' }));
	assert.deepEqual(stepStates(board), [
		'start:done',
		'install:running',
		'restart:waiting',
		'running:waiting',
	]);
	client.publishAttempt(
		endedAttempt({ kind: 'unchanged', from: '5.1.1', to: '5.1.1', at: 2_000 }),
	);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['Pop was already on 5.1.1. Nothing was installed.'],
	);
	// The status a released client would read changes nothing here.
	client.publish(status(AVAILABLE));
	assert.equal(board.snapshot.notices.length, 1);
});

test('a reply lost to the restart loses nothing: the attempt is found by its request id', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const before = attemptClient();
	board.sync([source('pop', before, { serverId: 'pop', label: 'Pop' })]);
	before.replyWith(async () => {
		throw Object.assign(new Error('gone'), { code: 'disconnected' });
	});
	assert.equal(
		await board.startUpgrade('pop', before, 'in-place', { to: '5.2.0' }),
		undefined,
	);
	// The connection drops before any attempt was read.
	board.sync([
		source('pop', undefined, {
			serverId: 'pop',
			label: 'Pop',
			phase: 'reconnecting',
		}),
	]);
	assert.equal(board.snapshot.progress[0]?.restarting, true);
	// The server that comes back has the attempt, already over.
	const after = attemptClient(status({ version: '5.2.0' }));
	after.attempts.attempt = endedAttempt({
		kind: 'succeeded',
		from: '5.1.1',
		to: '5.2.0',
		at: 3_000,
	});
	board.sync([source('pop', after, { serverId: 'pop', label: 'Pop' })]);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['Pop is now on 5.2.0.'],
	);
});

test('a reload while the restarted server finishes keeps the same attempt', () => {
	const storage = fakeStorage();
	const first = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	first.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	void first.startUpgrade('pop', client, 'in-place', { to: '5.2.0' });
	client.publishAttempt(pendingAttempt({ stage: 'installing' }));
	first.dispose();

	const second = new ServerUpgradeBoard({
		...fakeTimers(),
		memory: createServerUpgradeMemory(storage),
	});
	const back = attemptClient(status({ version: '5.2.0' }));
	back.attempts.attempt = pendingAttempt({ stage: 'finishing' });
	second.sync([source('pop', back, { serverId: 'pop', label: 'Pop' })]);
	assert.deepEqual(stepStates(second), [
		'start:done',
		'install:done',
		'restart:done',
		'running:running',
	]);
	assert.equal(second.snapshot.progress[0]?.initiatedHere, true);
	assert.equal(second.snapshot.progress[0]?.to, '5.2.0');
	back.publishAttempt(
		endedAttempt({ kind: 'succeeded', from: '5.1.1', to: '5.2.0', at: 3_000 }),
	);
	assert.equal(second.snapshot.progress[0]?.outcome, 'success');
	assert.equal(second.snapshot.notices.length, 1);
});

test("another attempt's ending does not end the one followed", async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place');
	client.publishAttempt(pendingAttempt({ stage: 'installing' }));
	client.publishAttempt(
		endedAttempt(
			{ kind: 'failed', from: '5.1.1', to: '5.1.1', reason: 'x', at: 2_000 },
			{ id: 'attempt-0', requestId: 'someone-else' },
		),
	);
	assert.equal(board.snapshot.progress[0]?.outcome, undefined);
	assert.equal(board.snapshot.notices.length, 0);
});

test('an upgrader that never starts fails the first step, with what to run', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place');
	client.publishAttempt(pendingAttempt());
	client.publishAttempt(
		endedAttempt({
			kind: 'failed',
			from: '5.1.1',
			to: '5.1.1',
			reason:
				'the upgrader did not start. Run `sudo terminay daemon upgrade --system` on the server\'s host to upgrade it.',
			at: 121_000,
		}),
	);
	const view = board.snapshot.progress[0];
	assert.equal(view?.outcome, 'failure');
	assert.equal(view?.steps[0]?.state, 'failed');
	assert.match(view?.steps[0]?.detail ?? '', /sudo terminay daemon upgrade --system/u);
});

test('a late reply for an attempt that has ended changes nothing', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	let answer: (value: unknown) => void = () => {};
	client.replyWith(
		() =>
			new Promise((resolve) => {
				answer = resolve;
			}),
	);
	const started = board.startUpgrade('pop', client, 'in-place');
	client.publishAttempt(pendingAttempt());
	client.publishAttempt(
		endedAttempt({ kind: 'unchanged', from: '5.1.1', to: '5.1.1', at: 2_000 }),
	);
	const before = board.snapshot;
	answer(status(AVAILABLE));
	assert.equal(await started, undefined);
	assert.equal(board.snapshot, before);
});

test('a refused start leaves nothing followed, and says why', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	client.replyWith(async () => {
		throw Object.assign(new Error('busy'), {
			code: 'conflict',
			details: { reason: 'in-progress' },
		});
	});
	assert.equal(
		await board.startUpgrade('pop', client, 'in-place'),
		'An upgrade is already running.',
	);
	assert.deepEqual(board.snapshot.progress, []);
});

test('Install latest goes through the board with its consent and request id', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-7',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place', {
		to: '5.0.9',
		allowOlder: true,
	});
	assert.deepEqual(client.sent, [
		{ mode: 'in-place', options: { allowOlder: true, requestId: 'req-7' } },
	]);
	assert.equal(board.snapshot.progress[0]?.to, '5.0.9');
	// A server without attempts is sent no request id, and followed as before.
	const legacy = fakeClient(status(AVAILABLE));
	const sent: unknown[] = [];
	const plain = {
		...legacy,
		startServerUpgrade: async (_mode: string, options?: unknown) => {
			sent.push(options);
			return legacy.store.status;
		},
	};
	const other = new ServerUpgradeBoard({ ...fakeTimers() });
	other.sync([source('old', plain, { serverId: 'old', label: 'Old' })]);
	await other.startUpgrade('old', plain, 'in-place', { to: '5.2.0' });
	assert.deepEqual(sent, [undefined]);
	assert.equal(other.snapshot.progress[0]?.initiatedHere, true);
});

test('a server that comes back without attempts is followed by the old rules', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place', { to: '5.2.0' });
	client.publishAttempt(pendingAttempt({ stage: 'installing' }));
	board.sync([
		source('pop', undefined, {
			serverId: 'pop',
			label: 'Pop',
			phase: 'reconnecting',
		}),
	]);
	// Install latest moved it to a release that predates attempts.
	const older = fakeClient(
		status({
			version: '5.0.9',
			upgrade: {
				state: 'succeeded',
				from: '5.1.1',
				to: '5.0.9',
				at: 2_000,
			},
		}),
	);
	board.sync([source('pop', older, { serverId: 'pop', label: 'Pop' })]);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		['Pop is now on 5.0.9.'],
	);
});

test('another device follows a pending attempt it reads, and opens nothing for an ending', () => {
	const board = new ServerUpgradeBoard({ ...fakeTimers() });
	const client = attemptClient();
	client.attempts.attempt = endedAttempt({
		kind: 'succeeded',
		from: '5.1.0',
		to: '5.1.1',
		at: 500,
	});
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	assert.equal(board.snapshot.progress.length, 0);
	client.publishAttempt(pendingAttempt({ requestId: 'phone' }));
	assert.equal(board.snapshot.progress[0]?.initiatedHere, false);
	client.publishAttempt(
		endedAttempt(
			{ kind: 'succeeded', from: '5.1.1', to: '5.2.0', at: 3_000 },
			{ requestId: 'phone' },
		),
	);
	// A device that only watched keeps no ticklist, and is told once.
	assert.deepEqual(board.snapshot.progress, []);
	assert.equal(board.snapshot.notices.length, 1);
});

test('a rolled-back attempt fails the last step with its reason', async () => {
	const board = new ServerUpgradeBoard({
		...fakeTimers(),
		randomId: () => 'req-1',
	});
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place', { to: '5.2.0' });
	client.publishAttempt(pendingAttempt({ stage: 'finishing' }));
	client.publishAttempt(
		endedAttempt({
			kind: 'rolled-back',
			from: '5.1.1',
			to: '5.2.0',
			reason: 'the new release did not become ready',
			at: 3_000,
		}),
	);
	const view = board.snapshot.progress[0];
	assert.equal(view?.outcome, 'failure');
	assert.equal(view?.steps[3]?.state, 'failed');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		[
			'Upgrading Pop failed: the new release did not become ready. 5.1.1 is running again.',
		],
	);
});

test('an attempt server that does not come back fails the restart once', async () => {
	const timers = fakeTimers();
	const board = new ServerUpgradeBoard({ ...timers, randomId: () => 'req-1' });
	const client = attemptClient();
	board.sync([source('pop', client, { serverId: 'pop', label: 'Pop' })]);
	await board.startUpgrade('pop', client, 'in-place', { to: '5.2.0' });
	client.publishAttempt(pendingAttempt({ stage: 'installing' }));
	board.sync([
		source('pop', undefined, {
			serverId: 'pop',
			label: 'Pop',
			phase: 'reconnecting',
		}),
	]);
	timers.fire();
	const view = board.snapshot.progress[0];
	assert.equal(view?.outcome, 'failure');
	assert.equal(view?.steps[2]?.state, 'failed');
	assert.equal(board.snapshot.notices.length, 1);
});
