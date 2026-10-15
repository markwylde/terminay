import assert from 'node:assert/strict';
import test from 'node:test';
import type { MacroRunSnapshot } from '@terminay/client-core';
import { furtherAlong, stepStatusForSnapshot } from './macroRunSnapshot.ts';

function snapshot(overrides: Partial<MacroRunSnapshot> = {}): MacroRunSnapshot {
	return {
		runId: 'run:1',
		macroId: 'run',
		target: { serverId: 's', projectId: 'p', sessionId: 't' },
		status: 'running',
		stepIndex: 0,
		bytesWritten: 0,
		startedAt: 1,
		...overrides,
	};
}

test('a step snapshot that arrives before the launch response is kept', () => {
	const early = snapshot({ stepIndex: 3 });
	const launch = snapshot({ stepIndex: 0 });
	const applied = furtherAlong(early, launch);
	assert.equal(applied, early);
	assert.deepEqual(
		Array.from({ length: 6 }, (_value, index) =>
			stepStatusForSnapshot(applied, index),
		),
		['completed', 'completed', 'completed', 'running', 'pending', 'pending'],
	);
});

test('a later step or a finished run replaces what is held', () => {
	assert.equal(furtherAlong(undefined, snapshot()).stepIndex, 0);
	assert.equal(
		furtherAlong(snapshot({ stepIndex: 1 }), snapshot({ stepIndex: 2 }))
			.stepIndex,
		2,
	);
	const finished = snapshot({ status: 'completed', stepIndex: 2 });
	assert.equal(furtherAlong(snapshot({ stepIndex: 5 }), finished), finished);
	assert.equal(furtherAlong(finished, snapshot({ stepIndex: 5 })), finished);
});

test('a canceled or failed run marks where it stopped', () => {
	const statuses = (status: MacroRunSnapshot['status']) =>
		[0, 1, 2].map((index) =>
			stepStatusForSnapshot({ status, stepIndex: 1 }, index),
		);
	assert.deepEqual(statuses('canceled'), ['completed', 'canceled', 'canceled']);
	assert.deepEqual(statuses('failed'), ['completed', 'failed', 'pending']);
	assert.deepEqual(statuses('completed'), [
		'completed',
		'completed',
		'completed',
	]);
});
