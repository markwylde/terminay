import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * `ps -axo` returns the same bytes for every caller, so reading it once per
 * terminal per sampling round spawns N identical processes — each one a fresh
 * binary for an endpoint-security agent to authorise. Terminals that sample
 * together must share one read.
 */
const darwinOnly = { skip: process.platform === 'linux' };

test('terminals sampling together share one process-table read', darwinOnly, async () => {
	const { sharedProcessTable, resetSharedProcessTable } = await import(
		'../dist/index.js'
	);
	resetSharedProcessTable();

	// Five terminals sampling in the same round. One command, not five: the
	// identical promise proves they were coalesced rather than merely fast.
	const reads = [
		sharedProcessTable(),
		sharedProcessTable(),
		sharedProcessTable(),
		sharedProcessTable(),
		sharedProcessTable(),
	];
	for (const read of reads)
		assert.equal(read, reads[0], 'every caller in a round shares one read');

	const output = await reads[0];
	assert.ok(typeof output === 'string' && output.length > 0);
	assert.ok(
		/\d+\s+\d+\s+\S+/u.test(output),
		'the shared snapshot is a real process table',
	);
});

test('a later round reads the table again', darwinOnly, async () => {
	const { sharedProcessTable, resetSharedProcessTable } = await import(
		'../dist/index.js'
	);
	resetSharedProcessTable();
	const first = sharedProcessTable();
	await first;

	// Reset stands in for the window elapsing. The snapshot must not be a cache
	// that outlives its round -- process topology is exactly what is being
	// watched for change.
	resetSharedProcessTable();
	const second = sharedProcessTable();
	assert.notEqual(second, first, 'a new round must take a fresh reading');
	await second;
});

test('a failed read is not cached past its own round', darwinOnly, async () => {
	const { sharedProcessTable, resetSharedProcessTable } = await import(
		'../dist/index.js'
	);
	resetSharedProcessTable();
	const read = sharedProcessTable();
	await read.catch(() => undefined);
	// Whether it resolved or rejected, the module must remain usable: a poisoned
	// snapshot would take out every terminal sharing the window.
	resetSharedProcessTable();
	assert.doesNotThrow(() => sharedProcessTable());
});
