import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
	containerSourceRunner,
	SourceRunError,
} from '../dist/botService/sourceRunner.js';
import {
	BotSourceStore,
	evaluateObservation,
	initialCheckpoint,
	parseObservation,
	selectPointer,
} from '../dist/botService/sourceState.js';
import {
	storedTrigger,
	triggerCondition,
} from '../dist/botService/triggerState.js';

const id = 'a'.repeat(24),
	botId = 'b'.repeat(12);
const trigger = {
	id,
	botId,
	name: 'Items',
	enabled: true,
	prompt: 'Inspect this item',
	condition: {
		kind: 'command',
		command: 'list',
		intervalMs: 60000,
		match: { kind: 'items', items: '', identity: '/id' },
	},
	generation: id,
	evaluatedThrough: 0,
	missedCount: 0,
	missedLatest: null,
};
const cp = () => initialCheckpoint(id);
const observation = (items) => ({
	stdout: JSON.stringify(items),
	stderr: '',
	exitCode: 0,
});
test('generic item matching processes initial items, ignores reordered/updated/reappearing identities and is all-or-nothing', () => {
	const source = trigger.condition;
	let result = evaluateObservation(
		source,
		cp(),
		observation([{ id: 1 }, { id: 2 }]),
	);
	assert.equal(result.events.length, 2);
	const previous = structuredClone(result.checkpoint);
	assert.equal(
		evaluateObservation(
			source,
			previous,
			observation([{ id: 2, title: 'edited' }, { id: 1 }]),
		).events.length,
		0,
	);
	result = evaluateObservation(source, previous, observation([]));
	assert.equal(
		evaluateObservation(source, result.checkpoint, observation([{ id: 1 }]))
			.events.length,
		0,
	);
	assert.throws(
		() =>
			evaluateObservation(
				source,
				previous,
				observation([{ id: 3 }, { id: 3 }]),
			),
		/Duplicate/,
	);
	assert.deepEqual(previous, result.checkpoint);
	assert.throws(
		() =>
			evaluateObservation(
				source,
				previous,
				observation([{ id: 3 }, { noId: true }]),
			),
		/Pointer/,
	);
	assert.equal(previous.ids.length, 2);
	assert.equal(
		evaluateObservation(
			{ ...source, match: { ...source.match, initial: 'baseline' } },
			cp(),
			observation([{ id: 1 }]),
		).events.length,
		0,
	);
});
test('changed values establish a baseline, JSON pointers are data and failures do not advance memory', () => {
	const source = {
		kind: 'http',
		url: 'https://example.test',
		intervalMs: 60000,
		select: '/status',
	};
	const first = evaluateObservation(source, cp(), {
		body: '{"status":{"a":1,"b":2},"time":1}',
	});
	assert.equal(first.events.length, 0);
	assert.equal(
		evaluateObservation(source, first.checkpoint, {
			body: '{"time":2,"status":{"b":2,"a":1}}',
		}).events.length,
		0,
	);
	assert.equal(
		evaluateObservation(source, first.checkpoint, { body: '{"status":"down"}' })
			.events.length,
		1,
	);
	assert.throws(
		() => evaluateObservation(source, first.checkpoint, { body: '{}' }),
		/Missing/,
	);
	assert.deepEqual(
		evaluateObservation(source, first.checkpoint, { notModified: true })
			.checkpoint,
		first.checkpoint,
	);
	assert.equal(selectPointer({ 'a/b': { '~': 7 } }, '/a~1b/~0'), 7);
	assert.throws(() => selectPointer({}, '/__proto__'), /Missing/);
});
test('matching supports transitions, repeat, explicit nonzero exit conditions and bounded payloads', () => {
	const source = {
		kind: 'command',
		command: 'check',
		intervalMs: 60000,
		match: { kind: 'contains', text: 'ready' },
	};
	const result = evaluateObservation(source, cp(), {
		stdout: 'ready',
		exitCode: 0,
	});
	assert.equal(result.events.length, 1);
	assert.equal(
		evaluateObservation(source, result.checkpoint, {
			stdout: 'ready',
			exitCode: 0,
		}).events.length,
		0,
	);
	assert.equal(
		evaluateObservation(
			{ ...source, match: { ...source.match, repeat: true } },
			result.checkpoint,
			{ stdout: 'ready', exitCode: 0 },
		).events.length,
		1,
	);
	assert.throws(
		() =>
			evaluateObservation(source, result.checkpoint, {
				stdout: 'ready',
				exitCode: 1,
			}),
		/exited 1/,
	);
	assert.equal(
		evaluateObservation({ ...source, match: { kind: 'exit', code: 1 } }, cp(), {
			exitCode: 1,
		}).events.length,
		1,
	);
	assert.throws(
		() =>
			evaluateObservation(
				trigger.condition,
				cp(),
				observation([{ id: 1, body: 'x'.repeat(32768) }]),
			),
		/32 KiB/,
	);
});
test('SSE IDs deduplicate and commit cursors; file recovery reports net changes and resume baselines suppress disabled periods', () => {
	const sse = { kind: 'sse', url: 'https://example.test/events' };
	let result = evaluateObservation(sse, cp(), { eventId: '42', data: 'hello' });
	assert.equal(result.events.length, 1);
	assert.equal(result.checkpoint.cursor, '42');
	assert.equal(
		evaluateObservation(sse, result.checkpoint, {
			eventId: '42',
			data: 'hello',
		}).events.length,
		0,
	);
	assert.equal(
		evaluateObservation(sse, result.checkpoint, {
			eventId: '43',
			filtered: true,
		}).events.length,
		0,
	);
	const files = { kind: 'files', path: '/tmp/example' };
	const before = evaluateObservation(files, cp(), { snapshot: { a: '1' } });
	const after = evaluateObservation(files, before.checkpoint, {
		snapshot: { a: '2', b: '1' },
	});
	assert.deepEqual(after.events[0].changes, ['a', 'b']);
	result = evaluateObservation(
		trigger.condition,
		{ ...cp(), resumeBaseline: true },
		observation([{ id: 1 }]),
	);
	assert.equal(result.events.length, 0);
	assert.equal(result.checkpoint.ids.length, 1);
});
test('checkpoint and full event batch survive restart atomically; reset keeps session identity sequence monotonic', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-source-store-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	let store = new BotSourceStore(root);
	const evaluated = evaluateObservation(
		trigger.condition,
		store.checkpoint(trigger),
		observation([{ id: 1 }, { id: 2 }]),
	);
	const accepted = store.commit(
		trigger,
		evaluated.checkpoint,
		evaluated.events,
		100,
		100,
	);
	store = new BotSourceStore(root);
	assert.equal(store.pending(botId).length, 2);
	assert.equal(store.checkpoint(trigger).ids.length, 2);
	assert.equal(store.pending(botId)[0].sessionId, accepted[0].sessionId);
	store.reset(trigger);
	const next = evaluateObservation(
		trigger.condition,
		store.checkpoint(trigger),
		observation([{ id: 1 }]),
	);
	const more = store.commit(trigger, next.checkpoint, next.events, 200, 200);
	assert.notEqual(more[0].sessionId, accepted[0].sessionId);
	const prior = readFileSync(join(root, `${botId}.json`), 'utf8');
	assert.throws(
		() =>
			store.commit(
				trigger,
				store.checkpoint(trigger),
				Array(1001).fill({ id: 3 }),
				300,
				300,
			),
		/limit/,
	);
	assert.equal(readFileSync(join(root, `${botId}.json`), 'utf8'), prior);
});
test('source validation bounds fields, URL protocols, headers, intervals, selectors and preserves disabled legacy definitions', () => {
	assert.equal(triggerCondition(trigger.condition, 10).intervalMs, 60000);
	for (const c of [
		{ ...trigger.condition, intervalMs: 59999 },
		{ ...trigger.condition, cwd: 'relative' },
		{ kind: 'http', url: 'file:///etc/passwd', intervalMs: 60000 },
		{
			kind: 'http',
			url: 'https://user:password@example.test',
			intervalMs: 60000,
		},
		{
			kind: 'http',
			url: 'https://example.test',
			intervalMs: 60000,
			headers: { Authorization: 'x\r\ny' },
		},
		{ ...trigger.condition, unknown: true },
		{
			...trigger.condition,
			match: { kind: 'items', items: 'bad', identity: '/id' },
		},
	])
		assert.throws(() => triggerCondition(c, 10));
	const old = storedTrigger({
		...trigger,
		condition: { kind: 'event', event: 'project.opened' },
	});
	assert.equal(old.enabled, false);
	assert.match(old.unsupported, /unsupported/);
});
test('source runner seals headers, executes only via bot container and redacts diagnostics before returning', async () => {
	const entries = new Map();
	const calls = [];
	let activities = 0;
	const vault = {
		status: () => ({ entries: [...entries.keys()].map((id) => ({ id })) }),
		put: async (d) => entries.set(d.id, Buffer.from(d.value)),
		withSecret: async (id, fn) => fn(entries.get(id)),
	};
	const driver = {
		exec: async (...args) => calls.push(args),
		execStream(container, argv, options) {
			calls.push([container, argv, options]);
			const child = new EventEmitter();
			child.stdin = new PassThrough();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {
				child.stdout.end();
				return true;
			};
			child.stdin.once('data', (chunk) => {
				const config = JSON.parse(String(chunk));
				assert.equal(config.source.headers.Authorization, 'secret-value');
				queueMicrotask(() => {
					child.stdout.end(JSON.stringify({ body: 'secret-value' }) + '\n');
				});
			});
			return child;
		},
	};
	const runner = containerSourceRunner({
		driver: async () => driver,
		start: async (id) => {
			assert.equal(id, botId);
		},
		activity: (_, delta) => (activities += delta),
		vault,
	});
	const raw = {
		kind: 'http',
		url: 'https://example.test',
		headers: { Authorization: 'secret-value' },
		intervalMs: 60000,
	};
	const source = await runner.protect(botId, id, raw);
	assert.ok(source.headers.Authorization.startsWith('@vault:'));
	assert.ok(!JSON.stringify(source).includes('secret-value'));
	const results = [];
	await runner.run(
		botId,
		source,
		{ signal: new AbortController().signal },
		async (v) => results.push(v),
	);
	assert.equal(results[0].body, '[redacted]');
	assert.equal(activities, 0);
	assert.equal(calls[0][0], `terminay-bot-${botId}`);
	assert.ok(!JSON.stringify(calls).includes('secret-value'));
	await assert.rejects(
		runner.protect('c'.repeat(12), id, source),
		/Invalid header/,
	);
});

test('worker frames reject malformed fields before observation progress', () => {
	for (const value of [
		{ unexpected: true },
		{ matched: 'yes' },
		{ exitCode: 1.5 },
		{ snapshot: { '/tmp/file': 42 } },
		{ changes: ['ok', 42] },
	])
		assert.throws(() => parseObservation(value));
	assert.deepEqual(parseObservation({ stdout: 'ok', exitCode: 0 }), {
		stdout: 'ok',
		exitCode: 0,
	});
});

test('source canonical corruption restores the last complete batch and preserves bad files; future versions never roll back', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bot-source-corrupt-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = new BotSourceStore(root);
	const first = evaluateObservation(
		trigger.condition,
		store.checkpoint(trigger),
		observation([{ id: 1 }]),
	);
	store.commit(trigger, first.checkpoint, first.events, 100, 100);
	const second = evaluateObservation(
		trigger.condition,
		store.checkpoint(trigger),
		observation([{ id: 1 }, { id: 2 }]),
	);
	store.commit(trigger, second.checkpoint, second.events, 200, 200);
	const path = join(root, `${botId}.json`);
	writeFileSync(path, 'broken');
	const recovered = new BotSourceStore(root);
	assert.equal(recovered.pending(botId).length, 1);
	assert.equal(recovered.checkpoint(trigger).ids.length, 1);
	assert.ok(readdirSync(root).some((name) => name.includes('.corrupt-')));
	const future = JSON.stringify({ version: 999 });
	writeFileSync(path, future);
	assert.throws(() => new BotSourceStore(root).pending(botId), /version/);
	assert.equal(readFileSync(path, 'utf8'), future);
});

// A fake engine whose source exec ends the way `script` decides.
function endingRunner(script, { cleanupFails = false } = {}) {
	const vault = {
		status: () => ({ entries: [] }),
		put: async () => {},
		withSecret: async (_id, fn) => fn(Buffer.from('header-secret')),
	};
	const driver = {
		async exec() {
			if (cleanupFails) throw new Error('kill failed');
		},
		execStream() {
			const child = new EventEmitter();
			child.stdin = new PassThrough();
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = () => {
				if (!child.stdout.writableEnded) child.stdout.end();
				return true;
			};
			child.stdin.once('data', () => queueMicrotask(() => script(child)));
			return child;
		},
	};
	return containerSourceRunner({
		driver: async () => driver,
		start: async () => {},
		activity: () => {},
		vault,
	});
}
const commandSource = {
	kind: 'command',
	command: '/home/bot/poll.sh',
	intervalMs: 60000,
	match: { kind: 'output' },
};
const httpSource = {
	kind: 'http',
	url: 'https://example.test',
	headers: { Authorization: `@vault:bot:${botId}:trigger:${id}:header:x` },
	intervalMs: 60000,
};
async function runEnding(script, source = commandSource, options = {}, extra) {
	const runner = endingRunner(script, extra);
	try {
		await runner.run(
			botId,
			source,
			{
				signal: options.signal ?? new AbortController().signal,
				test: options.test,
			},
			async () => {},
		);
	} catch (error) {
		return error;
	}
	assert.fail('run should fail');
}

test('a worker that cannot be executed (exit 127) is reported as not executable', async () => {
	const error = await runEnding((child) => {
		child.stderr.write(
			'terminay-run: exec failed: [Errno 2] No such file or directory\n',
		);
		child.stdout.end();
		child.emit('exit', 127, null);
	});
	assert.ok(error instanceof SourceRunError);
	assert.equal(error.outcome, 'not-executable');
	assert.match(error.message, /could not be executed.*recreate the bot/);
	assert.equal(error.diagnostics.exitCode, 127);
	assert.equal(error.cleaned, true);
});

test('exit 126 is also not executable', async () => {
	const error = await runEnding((child) => {
		child.stdout.end();
		child.emit('exit', 126, null);
	});
	assert.equal(error.outcome, 'not-executable');
});

test('a run that ends without output for another reason is interrupted, keeps exit and redacted stderr, and never says recreate', async () => {
	const error = await runEnding((child) => {
		child.stderr.write('connection reset; token header-secret\n');
		child.stdout.end();
		child.emit('exit', 137, null);
	}, httpSource);
	assert.equal(error.outcome, 'interrupted');
	assert.equal(error.code, 'unavailable');
	assert.doesNotMatch(error.message, /recreate/i);
	assert.equal(error.diagnostics.exitCode, 137);
	assert.match(error.diagnostics.stderr, /\[redacted\]/);
	assert.doesNotMatch(error.diagnostics.stderr, /header-secret/);
});

test('a broken exec stream is interrupted with an unknown exit status', async () => {
	const error = await runEnding((child) => {
		child.emit('error', new Error('socket hang up'));
	});
	assert.equal(error.outcome, 'interrupted');
	assert.equal(error.diagnostics.exitCode, null);
});

test('a cancelled run is reported as cancelled, not interrupted', async () => {
	const controller = new AbortController();
	const error = await runEnding(() => controller.abort(), commandSource, {
		signal: controller.signal,
	});
	assert.ok(!(error instanceof SourceRunError));
	assert.equal(error.code, 'conflict');
});

test('a run past its own time limit names the limit and is not interrupted', async () => {
	const error = await runEnding(() => {}, { ...commandSource, timeoutMs: 50 });
	assert.ok(error instanceof SourceRunError);
	assert.equal(error.outcome, 'deadline');
	assert.equal(error.code, 'deadline');
	assert.match(error.message, /exceeded its 0 s limit/);
});

test('a trigger test longer than the test window names the 10 s limit', async () => {
	const error = await runEnding(() => {}, commandSource, { test: true });
	assert.equal(error.outcome, 'deadline');
	assert.match(error.message, /exceeded its 10 s limit/);
});

test('failed cleanup keeps the run error and marks it not cleaned', async () => {
	const error = await runEnding(
		(child) => {
			child.stdout.end();
			child.emit('exit', 1, null);
		},
		commandSource,
		{},
		{ cleanupFails: true },
	);
	assert.equal(error.outcome, 'interrupted');
	assert.equal(error.cleaned, false);
});

test('stderr is bounded while read and a partial first line is dropped', async () => {
	const error = await runEnding((child) => {
		// About 3 MiB of multibyte stderr.
		for (let i = 0; i < 120_000; i++)
			child.stderr.write(`línea ${i} — ünïcödé\n`);
		child.stdout.end();
		child.emit('exit', 1, null);
	});
	const bytes = Buffer.byteLength(error.diagnostics.stderr);
	assert.ok(bytes > 0 && bytes <= 4096, `stderr tail is ${bytes} bytes`);
	assert.match(error.diagnostics.stderr, /^línea \d+ — ünïcödé\n/);
	assert.match(error.diagnostics.stderr, /línea 119999/);
});
