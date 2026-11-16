/**
 * A server upgrade attempt end to end at the process boundary (ADR-0125):
 * the server's real attempt store in a data root, the upgrader's real run
 * records in an install prefix, the server's real watch on them, a restart
 * between two server processes, and the window's board reading what the
 * server publishes. Only the release itself is not installed: the Docker E2E
 * suite drives the Electron UI and cannot run one.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createFileServerUpgradeAttemptStore,
	ServerUpgradeService,
} from '@terminay/server-core';
import { UpgradeRun } from '../apps/terminay-cli/dist/outcome.js';
import {
	readUpgradeRunRecord,
	watchUpgradeRunRecord,
} from '../apps/terminay-server/dist/releaseUpgrader.js';
import { ServerUpgradeBoard } from '../src/workspace/serverUpgradeModel.ts';

const VERSION = '6.10.0-main.3493.canary';
const OLD = 'a'.repeat(40);
const NEW = 'b'.repeat(40);

/** One machine: an install prefix the upgrader writes, a data root the server
 * keeps its state in, and the install record's revision. */
async function machine(t) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-attempts-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const prefix = join(root, 'opt-terminay');
	const dataRoot = join(root, 'data');
	const { mkdir } = await import('node:fs/promises');
	await mkdir(prefix, { recursive: true });
	await mkdir(dataRoot, { recursive: true });
	const host = {
		resultPath: join(prefix, 'upgrade-result.json'),
		installed: OLD,
		available: { version: VERSION, revision: NEW },
		handovers: 0,
	};
	const upgrader = {
		async check() {
			return {
				environment: 'system',
				installed: { channel: 'canary', version: VERSION, revision: host.installed },
				available: host.available,
				canUpgrade: true,
				modes: ['in-place'],
				trigger: { kind: 'request-file', path: join(prefix, 'request') },
				unavailable: null,
				recordPath: host.resultPath,
				lastResult: (await readUpgradeRunRecord(host.resultPath)) ?? null,
			};
		},
		async trigger() {
			host.handovers += 1;
			return undefined;
		},
		readRecord: readUpgradeRunRecord,
		watchRecord: watchUpgradeRunRecord,
	};
	/** A server process as the launcher starts it. */
	const serve = (revision) => {
		const service = new ServerUpgradeService({
			serverVersion: VERSION,
			serverRevision: revision,
			upgrader,
			attemptStore: createFileServerUpgradeAttemptStore(dataRoot),
		});
		t.after(() => service.dispose());
		return service;
	};
	return { host, serve };
}

/** Settles once the service publishes an attempt that satisfies `predicate`. */
function attemptWhere(service, predicate, what) {
	if (predicate(service.attemptState.attempt))
		return Promise.resolve(service.attemptState.attempt);
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			off();
			reject(new Error(`timed out waiting for ${what}`));
		}, 10_000);
		const off = service.subscribeAttempt(({ attempt }) => {
			if (!predicate(attempt)) return;
			clearTimeout(timer);
			off();
			resolve(attempt);
		});
	});
}

/** What a connection's upgrade client gives the board, read from a service. */
function clientOf(service) {
	return {
		store: {
			get status() {
				return service.status;
			},
			subscribe: (listener) => service.subscribe(listener),
		},
		attempts: {
			get attempt() {
				return service.attemptState.attempt;
			},
			subscribe: (listener) =>
				service.subscribeAttempt(({ attempt }) => listener(attempt)),
		},
		startServerUpgrade: (mode, options) => service.startUpgrade(mode, options),
	};
}

test('an attempt survives the restart its upgrade causes and ends on its own run', async (t) => {
	const { host, serve } = await machine(t);
	const before = serve(OLD);
	await before.check();

	const board = new ServerUpgradeBoard({ randomId: () => 'phone-req-1' });
	t.after(() => board.dispose());
	const source = (service, phase = 'ready') => ({
		profileId: 'pop',
		serverId: 'pop',
		label: 'Pop',
		phase,
		...(service === undefined ? {} : { client: clientOf(service) }),
	});
	board.sync([source(before)]);
	assert.equal(
		await board.startUpgrade('pop', clientOf(before), 'in-place', { to: VERSION }),
		undefined,
	);
	assert.equal(host.handovers, 1);
	const kept = await attemptWhere(before, (a) => a?.requestId === 'phone-req-1', 'the attempt');

	// The root helper starts the upgrader, which records its start.
	const run = await UpgradeRun.begin({
		resultPath: host.resultPath,
		from: { channel: 'canary', version: VERSION, revision: OLD },
	});
	await attemptWhere(before, (a) => a?.stage === 'installing', 'the run to be bound');
	assert.equal(board.snapshot.progress[0]?.steps[1]?.state, 'running');

	// The upgrader stops the old server; the connection drops.
	before.dispose();
	board.sync([source(undefined, 'reconnecting')]);

	// The new build starts and takes the attempt up, before the install
	// record is rewritten.
	const after = serve(NEW);
	after.start();
	const finishing = await attemptWhere(after, (a) => a?.stage === 'finishing', 'finishing');
	assert.equal(finishing.id, kept.id);
	assert.equal(after.status.available, undefined, 'a stale record offers nothing');
	board.sync([source(after)]);
	assert.equal(board.snapshot.progress[0]?.steps[3]?.state, 'running');

	// Ready: the upgrader records success for its run, and only then the
	// install record.
	await run.end('succeeded', {
		to: { channel: 'canary', version: VERSION, revision: NEW },
	});
	host.installed = NEW;
	await run.release();
	const ended = await attemptWhere(after, (a) => a?.ending !== undefined, 'the ending');
	assert.equal(ended.ending.kind, 'succeeded');
	assert.equal(ended.ending.to, `${VERSION} (bbbbbbb)`);
	assert.equal(board.snapshot.progress[0]?.outcome, 'success');
	assert.deepEqual(
		board.snapshot.notices.map((notice) => notice.text),
		[`Pop is now on ${VERSION} (bbbbbbb).`],
	);

	// A second restart reads the same outcome and is told nothing new.
	after.dispose();
	const again = serve(NEW);
	again.start();
	const last = await attemptWhere(again, (a) => a?.ending !== undefined, 'the kept outcome');
	assert.equal(last.id, kept.id);
});

test('a run with nothing to install ends the attempt within moments, not at a deadline', async (t) => {
	const { host, serve } = await machine(t);
	// The restarted server once offered the build it already ran: rolling
	// builds share a version string. Now the revision says it is the same.
	host.available = { version: VERSION, revision: OLD };
	const server = serve(OLD);
	await server.check();
	assert.equal(server.status.available, undefined);

	// An upgrade that resolves to the running build anyway — another channel
	// build appeared and went — is ended by the run that found nothing to do.
	host.available = { version: VERSION, revision: NEW };
	await server.check();
	await server.startUpgrade('in-place', { requestId: 'r1' });
	const run = await UpgradeRun.begin({
		resultPath: host.resultPath,
		from: { channel: 'canary', version: VERSION, revision: OLD },
	});
	await run.end('unchanged');
	await run.release();
	const ended = await attemptWhere(server, (a) => a?.ending !== undefined, 'the ending');
	assert.equal(ended.ending.kind, 'unchanged');
	assert.equal(server.status.upgrade.state, 'succeeded');
	assert.equal(server.status.upgrade.from, server.status.upgrade.to);
});
