import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTerminalNoteSync,
	decideTerminalNoteReconcile,
} from '../src/workspace/terminalNoteSync.ts';

const base = {
	canonicalNote: undefined,
	localNote: undefined,
	firstSeen: false,
	hasPendingEdit: false,
};

test('a local note the server has never held is adopted once', () => {
	assert.equal(
		decideTerminalNoteReconcile({ ...base, localNote: 'mine', firstSeen: true }),
		'adopt',
	);
	// Later, an absent canonical note means another client removed it.
	assert.equal(
		decideTerminalNoteReconcile({ ...base, localNote: 'mine' }),
		'apply',
	);
});

test('a canonical note always wins over a different local note', () => {
	assert.equal(
		decideTerminalNoteReconcile({
			...base,
			canonicalNote: 'server',
			localNote: 'mine',
			firstSeen: true,
		}),
		'apply',
	);
	assert.equal(
		decideTerminalNoteReconcile({ ...base, canonicalNote: 'server' }),
		'apply',
	);
	assert.equal(
		decideTerminalNoteReconcile({
			...base,
			canonicalNote: 'same',
			localNote: 'same',
		}),
		'none',
	);
});

test('a reconcile never rewinds a note edit that is still on its way', () => {
	assert.equal(
		decideTerminalNoteReconcile({
			...base,
			canonicalNote: 'ab',
			localNote: 'abc',
			hasPendingEdit: true,
		}),
		'none',
	);
});

function deferred() {
	let resolve;
	const promise = new Promise((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

test('edits are debounced and stay pending until the server accepts the last one', async (t) => {
	// The debounce is the test's clock.
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const sent = [];
	const gates = [];
	const sync = createTerminalNoteSync({
		delayMs: 5,
		onError: (error) => assert.fail(error),
		send: (panelId, note) => {
			sent.push([panelId, note]);
			const gate = deferred();
			gates.push(gate);
			return gate.promise;
		},
	});

	sync.edit('panel-a', 'a');
	sync.edit('panel-a', 'ab');
	assert.equal(sync.hasPendingEdit('panel-a'), true);
	t.mock.timers.tick(4);
	assert.deepEqual(sent, []);
	t.mock.timers.tick(1);
	assert.deepEqual(sent, [['panel-a', 'ab']]);

	// A keystroke during the send keeps the panel pending after it resolves.
	sync.edit('panel-a', 'abc');
	gates[0].resolve();
	// The sync settles its send with a catch and a finally attached to the
	// send's promise. The same chain attached after it settles after it.
	await gates[0].promise.catch(() => undefined).finally(() => undefined);
	assert.equal(sync.hasPendingEdit('panel-a'), true);

	// Flushing sends the waiting edit at once, without the debounce.
	const flushed = sync.flush('panel-a');
	assert.deepEqual(sent[1], ['panel-a', 'abc']);
	gates[1].resolve();
	await flushed;
	assert.equal(sync.hasPendingEdit('panel-a'), false);
});

test('removing a note sends null, and a failed send is reported and cleared', async () => {
	const sent = [];
	const errors = [];
	const sync = createTerminalNoteSync({
		delayMs: 1_000,
		onError: (error) => errors.push(error.message),
		send: async (panelId, note) => {
			sent.push([panelId, note]);
			if (note === 'bad') throw new Error('rejected');
		},
	});
	sync.edit('panel-a', undefined);
	await sync.flush('panel-a');
	assert.deepEqual(sent, [['panel-a', null]]);

	sync.edit('panel-a', 'bad');
	await sync.flush('panel-a');
	assert.deepEqual(errors, ['rejected']);
	assert.equal(sync.hasPendingEdit('panel-a'), false);
});

test('a panel is first-seen exactly once until it is forgotten', () => {
	const sync = createTerminalNoteSync({
		onError: () => undefined,
		send: async () => undefined,
	});
	assert.equal(sync.markSeen('panel-a'), true);
	assert.equal(sync.markSeen('panel-a'), false);
	sync.forget('panel-a');
	assert.equal(sync.markSeen('panel-a'), true);
});

test('flushAll sends every waiting edit without the debounce', async () => {
	const sent = [];
	const sync = createTerminalNoteSync({
		delayMs: 60_000,
		onError: (error) => assert.fail(error),
		send: async (panelId, note) => {
			sent.push([panelId, note]);
		},
	});
	sync.edit('panel-a', 'one');
	sync.edit('panel-b', 'two');
	sync.flushAll();
	// Both were sent at once; flushing each waits for its send to settle.
	assert.equal(sent.length, 2);
	await Promise.all([sync.flush('panel-a'), sync.flush('panel-b')]);
	assert.deepEqual(sent, [
		['panel-a', 'one'],
		['panel-b', 'two'],
	]);
	assert.equal(sync.hasPendingEdit('panel-a'), false);
	assert.equal(sync.hasPendingEdit('panel-b'), false);
});
