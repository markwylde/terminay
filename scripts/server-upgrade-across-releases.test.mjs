/**
 * A server upgrade that crosses releases, followed by today's client: the
 * upgrade begins on one server build and ends on another, which is what every
 * upgrade does (ADR-0125). Each case runs the real server-core of both builds
 * over the real protocol, with the real client and the window's board, and an
 * upgrader that writes the record its release's CLI writes.
 *
 * The board's deadlines never fire here, so a card can only end on what the
 * servers report, never by running out of time.
 *
 * The release before attempts is read from TERMINAY_OLD_RELEASE when that is
 * set: a tree from a commit before #608 with `packages/server-core` and
 * `packages/client-core` built and `src/workspace/serverUpgradeModel.ts`.
 * Without it, that release's server is today's with its attempts hidden from
 * the client, which is how a client sees a server whose hello does not
 * advertise them, and the old client's cases are skipped.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
	ServerUpgradeClient,
	serverPublishesUpgradeAttempts,
	TerminayClient,
} from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import * as current from '@terminay/server-core';
import {
	createServerUpgradeMemory,
	ServerUpgradeBoard,
} from '../src/workspace/serverUpgradeModel.ts';

const OLD_RELEASE = process.env.TERMINAY_OLD_RELEASE;
const oldModule = (path) =>
	import(pathToFileURL(resolve(OLD_RELEASE, path)).href);
const before =
	OLD_RELEASE === undefined
		? undefined
		: await oldModule('packages/server-core/dist/index.js');
const oldClient =
	OLD_RELEASE === undefined
		? undefined
		: {
				core: await oldModule('packages/client-core/dist/index.js'),
				board: await oldModule('src/workspace/serverUpgradeModel.ts'),
			};

const FROM = '6.10.0-main.3493.canary';
const TO = '6.10.0-main.3509.canary';
const REV_FROM = 'b2fd47fbecdd'.padEnd(40, '0');
const REV_TO = '455d63a1e6e5'.padEnd(40, '0');
const NEXT = '6.10.0-main.3510.canary';
const REV_NEXT = 'c'.repeat(40);

const quietPty = {
	spawn: () => ({
		pid: 4242,
		write() {},
		resize() {},
		kill() {},
		onData: () => () => {},
		onExit: () => () => {},
		onForegroundProcess: () => () => {},
		async refreshForegroundProcess() {},
	}),
};

/** The machine: what the install says, and the record the upgrader left. */
function host() {
	return {
		installed: { channel: 'canary', version: FROM, revision: REV_FROM },
		available: { version: TO, revision: REV_TO },
		record: null,
		handovers: 0,
		/** What `daemon upgrade --check` prints, as the given release's CLI. */
		report(withRecordPath) {
			return {
				environment: 'system',
				installed: this.installed,
				available: this.available,
				canUpgrade: true,
				modes: ['in-place'],
				trigger: { kind: 'request-file', path: '/var/lib/terminay-upgrade/request' },
				unavailable: null,
				...(withRecordPath ? { recordPath: '/opt/terminay/upgrade-result.json' } : {}),
				lastResult: this.record,
			};
		},
	};
}

/** A server process on that machine, from the given server-core build. */
async function serve(
	t,
	core,
	machine,
	{ revision, version, dataRoot, newCli, keepsAttempts = true, upgrader: given },
) {
	const upgrader = given ?? {
		check: async () => machine.report(newCli),
		trigger: async () => {
			machine.handovers += 1;
			return undefined;
		},
		...(newCli
			? {
					readRecord: async () => machine.record ?? undefined,
					watchRecord: () => ({ close() {} }),
				}
			: {}),
	};
	const service = new core.ServerUpgradeService({
		serverVersion: version,
		upgrader,
		...(core.createFileServerUpgradeAttemptStore === undefined || !keepsAttempts
			? {}
			: {
					serverRevision: revision,
					attemptStore: core.createFileServerUpgradeAttemptStore(dataRoot),
				}),
	});
	const composition = core.createServerCoreComposition({
		allowUnresolvedTestSessions: true,
		serverId: 'pop',
		serverVersion: version,
		capabilities: ['desktop'],
		ptyFactory: quietPty,
		serverUpgrade: service,
		authenticate: ({ hello }) => ({ clientId: hello.clientId, authScope: 'admin' }),
	});
	const checked = new Promise((resolve) => {
		const off = service.subscribe(() => {
			off();
			resolve();
		});
	});
	await composition.start();
	await checked;
	const clients = [];
	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		for (const client of clients) await client.close().catch(() => undefined);
		await composition.shutdown();
	};
	t.after(stop);
	return {
		service,
		stop,
		/** Attach today's client, built as the app builds it. */
		async connect({ hideAttempts = false, clientCore } = {}) {
			const pair = createInMemoryTransportPair();
			void composition.core.accept(pair.server).start().catch(() => undefined);
			const Client = clientCore?.TerminayClient ?? TerminayClient;
			const Upgrade = clientCore?.ServerUpgradeClient ?? ServerUpgradeClient;
			const client = new Client({
				transport: pair.client,
				clientId: `phone-${clients.length}`,
				capabilities: ['events.resync'],
			});
			clients.push(client);
			await pair.open();
			const hello = await client.connect();
			const upgrade = new Upgrade(
				{
					query: async (operation, payload, options) =>
						(await client.query(operation, payload, options)).result,
					command: async (operation, payload, options) =>
						(await client.command(operation, payload, options)).result,
					subscribe: async (event, listener, onResync) => {
						const subscription = await client.subscribe(event);
						subscription.onEvent(listener);
						if (onResync !== undefined) subscription.onResync(onResync);
						return () => void subscription.unsubscribe().catch(() => undefined);
					},
				},
				undefined,
				{
					attempts:
						!hideAttempts && serverPublishesUpgradeAttempts(hello.capabilities),
				},
			);
			await upgrade.subscribe();
			return upgrade;
		},
	};
}

/** Deadlines that never fire: an ending must come from the servers. */
const noDeadlines = { setTimer: () => 0, clearTimer: () => {} };

function storage() {
	const values = new Map();
	return {
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => void values.set(key, value),
	};
}

const settled = async (board, predicate, what) => {
	const deadline = Date.now() + 10_000;
	while (!predicate(board.snapshot)) {
		if (Date.now() > deadline)
			assert.fail(`${what}: ${JSON.stringify(board.snapshot.progress)}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
};

const pop = (client, phase = 'ready') => ({
	profileId: 'pop',
	serverId: 'pop',
	label: 'Pop',
	phase,
	...(client === undefined ? {} : { client }),
});

/** The two builds an upgrade crosses, as each case runs them. */
const builds = [
	{
		name: before === undefined
			? 'a server without attempts (today’s, its attempts hidden)'
			: 'the release before attempts',
		core: before ?? current,
		hideAttempts: before === undefined,
	},
];

for (const old of builds) {
	for (const reload of [false, true]) {
		test(`an upgrade begun on ${old.name} ends when the release it installs comes back${reload ? ', across a reload' : ''}`, async (t) => {
			const root = await mkdtemp(join(tmpdir(), 'terminay-across-'));
			t.after(() => rm(root, { recursive: true, force: true }));
			const machine = host();
			const memory = storage();
			const board = () =>
				new ServerUpgradeBoard({
					...noDeadlines,
					randomId: () => 'req-1',
					memory: createServerUpgradeMemory(memory),
				});

			// Pop runs the old release; the phone asks it to upgrade.
			const first = await serve(t, old.core, machine, {
				revision: REV_FROM,
				version: FROM,
				dataRoot: root,
				newCli: false,
				// A server without attempts keeps none for the next to take up.
				keepsAttempts: !old.hideAttempts,
			});
			let window = board();
			t.after(() => window.dispose());
			const before = await first.connect({ hideAttempts: old.hideAttempts });
			assert.equal(before.attempts, undefined, 'the old server publishes no attempts');
			window.sync([pop(before)]);
			assert.equal(
				await window.startUpgrade('pop', before, 'in-place', { to: TO }),
				undefined,
			);
			assert.equal(machine.handovers, 1);
			await settled(
				window,
				(s) => s.progress[0]?.steps[1]?.state === 'running',
				'installing',
			);

			// The old upgrader stops the server, installs, and records success
			// the way its release does: no run id.
			await first.stop();
			window.sync([pop(undefined, 'reconnecting')]);
			if (reload) {
				window.dispose();
				window = board();
				window.sync([pop(undefined, 'reconnecting')]);
			}
			machine.installed = { channel: 'canary', version: TO, revision: REV_TO };
			machine.available = null;
			machine.record = {
				schemaVersion: 1,
				from: 'canary-b2fd47fbecdd',
				to: 'canary-455d63a1e6e5',
				outcome: 'succeeded',
				at: new Date(Date.now() + 1_000).toISOString(),
			};

			// The new release comes back, publishing attempts it has none of.
			const second = await serve(t, current, machine, {
				revision: REV_TO,
				version: TO,
				dataRoot: root,
				newCli: true,
			});
			const after = await second.connect();
			assert.notEqual(after.attempts, undefined, 'the new server publishes attempts');
			window.sync([pop(after)]);

			await settled(
				window,
				(s) => s.progress[0]?.outcome !== undefined,
				'the card to end',
			);
			assert.equal(window.snapshot.progress[0].outcome, 'success');
			assert.deepEqual(
				window.snapshot.progress[0].steps.map((step) => step.state),
				['done', 'done', 'done', 'done'],
			);
			// Named as the old upgrader's record names it.
			assert.deepEqual(
				window.snapshot.notices.map((notice) => notice.text),
				['Pop is now on canary-455d63a1e6e5.'],
			);

			// The next upgrade of that server is followed by its attempt.
			window.closeProgress('pop');
			machine.available = { version: '6.10.0-main.3510.canary', revision: 'c'.repeat(40) };
			await second.service.check();
			assert.equal(
				await window.startUpgrade('pop', after, 'in-place', {
					to: '6.10.0-main.3510.canary',
				}),
				undefined,
			);
			await settled(
				window,
				(s) => s.progress[0]?.steps[0]?.state !== undefined,
				'the next card',
			);
			assert.equal(after.attempts.attempt?.requestId, 'req-1');
		});
	}
}

test(
	'an app from before attempts follows an upgrade carried out by servers that keep them',
	{
		skip:
			oldClient === undefined &&
			'needs TERMINAY_OLD_RELEASE: a phone or desktop app from before #608',
	},
	async (t) => {
		// Today's servers and today's CLI, with its run records in a real
		// install prefix, watched by the server for real. The app that follows
		// it predates attempts: a phone whose PWA is cached, or a desktop app
		// not yet updated.
		const { UpgradeRun } = await import('../apps/terminay-cli/dist/outcome.js');
		const { readUpgradeRunRecord, watchUpgradeRunRecord } = await import(
			'../apps/terminay-server/dist/releaseUpgrader.js'
		);
		const root = await mkdtemp(join(tmpdir(), 'terminay-across-'));
		t.after(() => rm(root, { recursive: true, force: true }));
		const resultPath = join(root, 'upgrade-result.json');
		const machine = host();
		machine.installed = { channel: 'canary', version: TO, revision: REV_TO };
		machine.available = { version: NEXT, revision: REV_NEXT };
		const upgrader = {
			check: async () => ({
				...machine.report(true),
				recordPath: resultPath,
				lastResult: (await readUpgradeRunRecord(resultPath)) ?? null,
			}),
			trigger: async () => {
				machine.handovers += 1;
				return undefined;
			},
			readRecord: readUpgradeRunRecord,
			watchRecord: watchUpgradeRunRecord,
		};
		const first = await serve(t, current, machine, {
			revision: REV_TO,
			version: TO,
			dataRoot: root,
			newCli: true,
			upgrader,
		});
		const window = new oldClient.board.ServerUpgradeBoard(noDeadlines);
		t.after(() => window.dispose());
		const app = await first.connect({ clientCore: oldClient.core });
		window.sync([pop(app)]);
		assert.equal(
			await oldClient.board.requestServerUpgrade(app, 'in-place'),
			undefined,
		);
		window.markStarted('pop', { mode: 'in-place', to: NEXT });
		assert.equal(machine.handovers, 1);

		// The helper's run starts, and the server stops for the new release.
		const run = await UpgradeRun.begin({
			resultPath,
			from: { channel: 'canary', version: TO, revision: REV_TO },
		});
		await settled(
			window,
			(s) => s.progress[0]?.steps[1]?.state === 'running',
			'installing',
		);
		await first.stop();
		window.sync([pop(undefined, 'reconnecting')]);

		// The new release is up before the run has recorded how it ended.
		machine.installed = { channel: 'canary', version: NEXT, revision: REV_NEXT };
		machine.available = null;
		const second = await serve(t, current, machine, {
			revision: REV_NEXT,
			version: NEXT,
			dataRoot: root,
			newCli: true,
			upgrader,
		});
		second.service.start();
		const back = await second.connect({ clientCore: oldClient.core });
		window.sync([pop(back)]);
		assert.equal(window.snapshot.progress[0]?.outcome, undefined);

		// Ready: the run records success, and the server ends its attempt.
		await run.end('succeeded', {
			to: { channel: 'canary', version: NEXT, revision: REV_NEXT },
		});
		await run.release();
		await settled(
			window,
			(s) => s.progress[0]?.outcome !== undefined,
			'the old app’s card to end',
		);
		assert.equal(window.snapshot.progress[0].outcome, 'success');
		assert.deepEqual(
			window.snapshot.notices.map((notice) => notice.text),
			[`Pop is now on ${NEXT}.`],
		);
	},
);
