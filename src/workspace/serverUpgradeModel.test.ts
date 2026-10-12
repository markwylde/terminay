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
	assert.deepEqual(
		serverUpgradeRows(board.snapshot.entries).map((row) => row.profileId),
		['vps'],
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
	assert.equal(row(status()), undefined);
	assert.deepEqual(row(status(AVAILABLE)), {
		profileId: 'vps',
		label: 'VPS',
		version: '5.1.1',
		action: 'upgrade',
		reachable: true,
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
	// Back mid-upgrade: still running, and no longer gone.
	board.sync([source('vps', fakeClient(running))]);
	assert.equal(timers.pending.size, 0);
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
	// The upgrader finished while the server stayed up; the outcome follows.
	client.publish(status(AVAILABLE));
	board.sync([source('vps', client, { phase: 'reconnecting' })]);
	assert.equal(timers.pending.size, 0);
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
	const returnWith = (at: number) => {
		const board = new ServerUpgradeBoard({ ...fakeTimers(), memory: memory() });
		board.sync([
			source(
				'primary',
				fakeClient(
					status({
						version: '5.2.0',
						upgrade: { state: 'succeeded', from: '5.1.1', to: '5.2.0', at },
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
	});
	// An outcome from before this upgrade began belongs to an earlier one.
	assert.equal(returnWith(999), 0);
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
