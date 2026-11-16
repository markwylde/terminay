import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	readUpgradeOutcome,
	UPGRADE_LOCK,
	UpgradeLockedError,
	UpgradeRun,
	writeUpgradeOutcome,
} from '../dist/outcome.js';

const FROM = { channel: 'canary', version: '6.10.0', revision: 'a'.repeat(40) };
const TO = { channel: 'canary', version: '6.10.0', revision: 'b'.repeat(40) };

async function withPrefix(run) {
	const prefix = await mkdtemp(join(tmpdir(), 'terminay-outcome-'));
	try {
		await run({ prefix, resultPath: join(prefix, 'upgrade-result.json') });
	} finally {
		await rm(prefix, { recursive: true, force: true });
	}
}

test('every record kind round-trips with its run and releases', async () => {
	await withPrefix(async ({ resultPath }) => {
		for (const outcome of [
			'started',
			'succeeded',
			'rolled-back',
			'unchanged',
			'failed',
		]) {
			await writeUpgradeOutcome(resultPath, {
				run: 'r1',
				from: 'canary-aaaaaaaaaaaa',
				to: 'canary-bbbbbbbbbbbb',
				fromRelease: FROM,
				toRelease: TO,
				outcome,
				...(outcome === 'succeeded' ? {} : { reason: 'why' }),
			});
			const read = await readUpgradeOutcome(resultPath);
			assert.equal(read.outcome, outcome);
			assert.equal(read.run, 'r1');
			assert.deepEqual(read.fromRelease, FROM);
			assert.deepEqual(read.toRelease, TO);
		}
		await writeFile(resultPath, JSON.stringify({ schemaVersion: 1, from: 'a', to: 'b', outcome: 'exploded', at: 'x' }));
		assert.equal(await readUpgradeOutcome(resultPath), undefined);
	});
});

test('concurrent writes never share a temporary file and leave none behind', async () => {
	await withPrefix(async ({ prefix, resultPath }) => {
		await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				writeUpgradeOutcome(resultPath, {
					run: `r${index}`,
					from: 'a',
					to: 'b',
					outcome: 'started',
				}),
			),
		);
		assert.match((await readUpgradeOutcome(resultPath)).run, /^r\d+$/u);
		assert.deepEqual(
			(await readdir(prefix)).filter((name) => name.endsWith('.tmp')),
			[],
		);
	});
});

test('a run records its start, exactly one ending, and releases the lock', async () => {
	await withPrefix(async ({ prefix, resultPath }) => {
		const run = await UpgradeRun.begin({ resultPath, from: FROM });
		const started = await readUpgradeOutcome(resultPath);
		assert.equal(started.outcome, 'started');
		assert.equal(started.run, run.id);
		assert.match(await readFile(join(prefix, UPGRADE_LOCK), 'utf8'), /"pid"/u);

		await run.end('succeeded', { to: TO });
		// Bookkeeping that fails after success cannot replace it.
		await run.end('failed', { reason: 'pruning failed' });
		const ended = await readUpgradeOutcome(resultPath);
		assert.equal(ended.outcome, 'succeeded');
		assert.equal(ended.run, run.id);
		assert.deepEqual(ended.toRelease, TO);

		await run.release();
		assert.deepEqual(await readdir(prefix), ['upgrade-result.json']);
	});
});

test('a held lock refuses a second run and records nothing', async () => {
	await withPrefix(async ({ resultPath }) => {
		const first = await UpgradeRun.begin({ resultPath, from: FROM });
		await writeFile(
			join(resultPath, '..', UPGRADE_LOCK),
			JSON.stringify({ pid: 424242 }),
		);
		await assert.rejects(
			UpgradeRun.begin({ resultPath, from: FROM, isRunning: () => true }),
			UpgradeLockedError,
		);
		assert.equal((await readUpgradeOutcome(resultPath)).run, first.id);
		await first.release();
	});
});

test("a lock whose holder is gone is taken over", async () => {
	await withPrefix(async ({ prefix, resultPath }) => {
		await writeFile(join(prefix, UPGRADE_LOCK), JSON.stringify({ pid: 424242 }));
		const run = await UpgradeRun.begin({
			resultPath,
			from: FROM,
			isRunning: () => false,
		});
		assert.equal((await readUpgradeOutcome(resultPath)).run, run.id);
		assert.match(
			await readFile(join(prefix, UPGRADE_LOCK), 'utf8'),
			new RegExp(`"pid":${process.pid}`, 'u'),
		);
		await run.release();
		// Unreadable lock content counts as a holder that is gone.
		await writeFile(join(prefix, UPGRADE_LOCK), 'garbage');
		const again = await UpgradeRun.begin({ resultPath, from: FROM });
		await again.release();
	});
});
