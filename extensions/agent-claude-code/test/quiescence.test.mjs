import assert from 'node:assert/strict';
import test from 'node:test';
import { createClaudeRecordMapper } from '../dist/mapping.js';
import {
	INPUT_REQUEST_WINDOW_MS,
	MEASURED_IN_TURN_QUIET_CEILING_MS,
	QUIET_RECORD,
	withQuiescence,
} from '../dist/quiescence.js';

const sessionId = '5f2aff08-eab3-4852-96eb-48235fc7f471';

function collect(records) {
	const events = [];
	const publish = new Proxy(
		{},
		{
			get: (_target, kind) => (event) => {
				events.push({ kind, ...event });
			},
		},
	);
	const session = {
		publish,
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
	};
	const map = createClaudeRecordMapper();
	for (const record of records) map(record, session);
	return events;
}

const header = (mode = 'default') => [
	{ type: 'mode', mode: 'normal', sessionId },
	{ type: 'permission-mode', permissionMode: mode, sessionId, uuid: 'h1' },
];
const openTurn = {
	type: 'user',
	sessionId,
	promptId: 'p1',
	message: { role: 'user', content: 'do a thing' },
};

test('the window clears the measured in-turn quiet ceiling', () => {
	assert.ok(
		INPUT_REQUEST_WINDOW_MS > MEASURED_IN_TURN_QUIET_CEILING_MS,
		'the window must exceed the longest quiet interval ordinary work produces',
	);
});

test('silence inside an open turn infers a wait', () => {
	const events = collect([...header(), openTurn, QUIET_RECORD]);
	const wait = events.at(-1);
	assert.equal(wait.kind, 'waitStarted');
	assert.equal(wait.state, 'waiting');
	assert.equal(wait.inferred, true, 'the state is marked as derived');
});

test('silence outside an open turn infers nothing', () => {
	const events = collect([
		...header(),
		openTurn,
		{ type: 'system', subtype: 'turn_duration', sessionId },
		QUIET_RECORD,
	]);
	assert.equal(
		events.some((event) => event.kind === 'waitStarted'),
		false,
	);
});

test('a bypassing session never infers a wait', () => {
	const events = collect([
		...header('bypassPermissions'),
		openTurn,
		QUIET_RECORD,
	]);
	assert.equal(
		events.some((event) => event.kind === 'waitStarted'),
		false,
	);
});

test('plan mode never infers a wait', () => {
	const events = collect([...header('plan'), openTurn, QUIET_RECORD]);
	assert.equal(
		events.some((event) => event.kind === 'waitStarted'),
		false,
	);
});

test('any record the provider writes answers an inferred wait', () => {
	const events = collect([
		...header(),
		openTurn,
		QUIET_RECORD,
		{
			type: 'assistant',
			sessionId,
			uuid: 'a1',
			message: { role: 'assistant', content: [] },
		},
	]);
	const kinds = events.map((event) => event.kind);
	assert.ok(kinds.includes('waitStarted'));
	assert.ok(kinds.indexOf('waitFinished') > kinds.indexOf('waitStarted'));
});

test('a repeated quiet window does not republish the same wait', () => {
	const events = collect([...header(), openTurn, QUIET_RECORD, QUIET_RECORD]);
	assert.equal(
		events.filter((event) => event.kind === 'waitStarted').length,
		1,
	);
});

/**
 * A watcher that yields nothing until it is stopped, so only the quiet window
 * can fire. Stopping it lets the wrapper's iterator finish, exactly as a real
 * cancelled `follow` does.
 */
function silentWatcher() {
	let stop = () => {};
	const stopped = new Promise((resolve) => {
		stop = resolve;
	});
	return {
		stop: () => stop(),
		async *[Symbol.asyncIterator]() {
			await stopped;
		},
		async dispose() {
			stop();
		},
	};
}

function terminalWith(descendants) {
	return {
		signal: { aborted: false, throwIfAborted() {} },
		observation: { processes: { descendants: async () => descendants } },
	};
}

const immediately = () => ({
	promise: Promise.resolve('elapsed'),
	cancel() {},
});

/**
 * Fires a handful of immediate quiet windows and then stops. An unbounded
 * immediate timer would starve the macrotask queue and the test's own deadline
 * would never run.
 */
function boundedTicks(count = 5) {
	let ticks = 0;
	return () => {
		ticks += 1;
		return ticks > count
			? { promise: new Promise(() => {}), cancel() {} }
			: { promise: Promise.resolve('elapsed'), cancel() {} };
	};
}

/** Reads at most one chunk, always closing the iterator and the inner watcher. */
async function firstChunkWithin(watcher, inner, ms) {
	const iterator = watcher[Symbol.asyncIterator]();
	try {
		return await Promise.race([
			iterator.next().then((result) => (result.done ? 'none' : result.value)),
			new Promise((resolve) => {
				const timer = setTimeout(() => resolve('none'), ms);
				timer.unref?.();
			}),
		]);
	} finally {
		inner.stop();
		await iterator.return?.();
		await watcher.dispose();
	}
}

test('a quiet window yields the synthetic record when no tool is running', async () => {
	const inner = silentWatcher();
	const watcher = withQuiescence(inner, {
		terminal: terminalWith([
			{ executableName: 'zsh' },
			{ executableName: 'claude' },
		]),
		providerExecutable: 'claude',
		wait: immediately,
	});
	const chunk = await firstChunkWithin(watcher, inner, 1_000);
	assert.notEqual(chunk, 'none');
	assert.deepEqual(
		JSON.parse(new TextDecoder().decode(chunk.bytes)),
		QUIET_RECORD,
	);
});

test('a running tool suppresses the quiet window', async () => {
	const inner = silentWatcher();
	const watcher = withQuiescence(inner, {
		terminal: terminalWith([
			{ executableName: 'zsh' },
			{ executableName: 'claude' },
			{ executableName: 'rg' },
		]),
		providerExecutable: 'claude',
		wait: boundedTicks(),
	});
	const chunk = await firstChunkWithin(watcher, inner, 50);
	assert.equal(chunk, 'none', 'a long silent tool run is not a prompt');
});

test('an unavailable process sample withholds the inference', async () => {
	const inner = silentWatcher();
	const watcher = withQuiescence(inner, {
		terminal: {
			signal: { aborted: false, throwIfAborted() {} },
			observation: {
				processes: {
					descendants: async () => {
						throw new Error('unavailable');
					},
				},
			},
		},
		providerExecutable: 'claude',
		wait: boundedTicks(),
	});
	const chunk = await firstChunkWithin(watcher, inner, 50);
	assert.equal(chunk, 'none');
});
