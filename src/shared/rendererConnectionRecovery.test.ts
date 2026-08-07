import assert from 'node:assert/strict';
import test from 'node:test';
import {
	RendererConnectionRecovery,
	type RendererConnectionRecoveryClock,
} from './rendererConnectionRecovery.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, reject, resolve };
}

class FakeClock implements RendererConnectionRecoveryClock {
	private nextId = 0;
	private timers = new Map<number, { callback: () => void; delayMs: number }>();

	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number);
	}

	setTimeout(callback: () => void, delayMs: number): unknown {
		const id = ++this.nextId;
		this.timers.set(id, { callback, delayMs });
		return id;
	}

	get delays(): number[] {
		return [...this.timers.values()].map(({ delayMs }) => delayMs);
	}

	runNext(): void {
		const entry = this.timers.entries().next().value as
			| [number, { callback: () => void }]
			| undefined;
		assert.ok(entry, 'expected a scheduled retry');
		this.timers.delete(entry[0]);
		entry[1].callback();
	}
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function eventually(predicate: () => boolean): Promise<void> {
	for (let index = 0; index < 20; index += 1) {
		if (predicate()) return;
		await Promise.resolve();
	}
	assert.ok(predicate(), 'condition did not settle');
}

test('recovers through the ordered connection phases', async () => {
	const phases: string[] = [];
	const published: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		connect: async () => 'fresh-context',
		dispose: () => undefined,
		hydrate: async () => undefined,
		onRecovered: (context) => {
			published.push(context);
		},
		onStateChange: ({ phase }) => phases.push(phase),
		resubscribe: async () => undefined,
	});

	recovery.start('local');
	await settle();
	assert.deepEqual(phases, [
		'reconnecting',
		'resubscribing',
		'hydrating',
		'connected',
	]);
	assert.deepEqual(published, ['fresh-context']);
});

test('retries indefinitely with bounded exponential backoff', async () => {
	const clock = new FakeClock();
	let calls = 0;
	const recovery = new RendererConnectionRecovery<string>({
		clock,
		connect: async () => {
			calls += 1;
			throw new Error(`offline-${calls}`);
		},
		dispose: () => undefined,
		hydrate: async () => undefined,
		initialRetryMs: 10,
		maxRetryMs: 25,
		onRecovered: () => undefined,
		resubscribe: async () => undefined,
	});

	recovery.start('remote');
	await settle();
	assert.deepEqual(clock.delays, [10]);
	clock.runNext();
	await settle();
	assert.deepEqual(clock.delays, [20]);
	clock.runNext();
	await settle();
	assert.deepEqual(clock.delays, [25]);
	clock.runNext();
	await settle();
	assert.deepEqual(clock.delays, [25]);
	assert.equal(recovery.state.phase, 'failed');
	assert.equal(calls, 4);
});

test('serializes explicit retry and ignores stale completion', async () => {
	const first = deferred<string>();
	let active = 0;
	let maximumActive = 0;
	let calls = 0;
	const disposed: string[] = [];
	const published: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		connect: async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			calls += 1;
			try {
				return calls === 1 ? await first.promise : 'current';
			} finally {
				active -= 1;
			}
		},
		dispose: (context) => {
			disposed.push(context);
		},
		hydrate: async () => undefined,
		onRecovered: (context) => {
			published.push(context);
		},
		resubscribe: async () => undefined,
	});

	recovery.start('local');
	recovery.retry();
	await settle();
	assert.equal(calls, 1);
	first.resolve('stale');
	await eventually(() => published.length === 1);
	assert.equal(maximumActive, 1);
	assert.deepEqual(disposed, ['stale']);
	assert.deepEqual(published, ['current']);
});

test('a new connection selection supersedes hydration from the old generation', async () => {
	const oldHydration = deferred<void>();
	const disposed: string[] = [];
	const published: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		connect: async ({ key }) => key,
		dispose: (context) => {
			disposed.push(context);
		},
		hydrate: async (context) => {
			if (context === 'old') await oldHydration.promise;
		},
		onRecovered: (context) => {
			published.push(context);
		},
		resubscribe: async () => undefined,
	});

	recovery.start('old');
	await settle();
	assert.equal(recovery.state.phase, 'hydrating');
	recovery.start('new');
	oldHydration.resolve();
	await eventually(() => published.length === 1);
	assert.deepEqual(disposed, ['old']);
	assert.deepEqual(published, ['new']);
});

test('cancel invalidates work and clears scheduled retries', async () => {
	const clock = new FakeClock();
	const published: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		clock,
		connect: async () => {
			throw new Error('offline');
		},
		dispose: () => undefined,
		hydrate: async () => undefined,
		onRecovered: (context) => {
			published.push(context);
		},
		resubscribe: async () => undefined,
	});

	recovery.start('local');
	await settle();
	assert.equal(clock.delays.length, 1);
	recovery.cancel();
	assert.deepEqual(clock.delays, []);
	assert.equal(recovery.state.phase, 'connected');
	assert.deepEqual(published, []);
});

test('does not publish connected until asynchronous activation completes', async () => {
	const activation = deferred<void>();
	const phases: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		connect: async () => 'candidate',
		dispose: () => undefined,
		hydrate: async () => undefined,
		onRecovered: () => activation.promise,
		onStateChange: ({ phase }) => phases.push(phase),
		resubscribe: async () => undefined,
	});

	recovery.start('local');
	await settle();
	assert.equal(recovery.state.phase, 'hydrating');
	assert.equal(phases.includes('connected'), false);
	activation.resolve();
	await eventually(() => recovery.state.phase === 'connected');
	assert.equal(phases.at(-1), 'connected');
});

test('supersession during asynchronous activation fences and disposes the stale context', async () => {
	const oldActivation = deferred<void>();
	const disposed: string[] = [];
	const published: string[] = [];
	const recovery = new RendererConnectionRecovery<string>({
		connect: async ({ key }) => key,
		dispose: (context) => {
			disposed.push(context);
		},
		hydrate: async () => undefined,
		onRecovered: async (context) => {
			published.push(context);
			if (context === 'old') await oldActivation.promise;
		},
		resubscribe: async () => undefined,
	});

	recovery.start('old');
	await eventually(() => published.includes('old'));
	recovery.start('new');
	oldActivation.resolve();
	await eventually(() => recovery.state.phase === 'connected');
	assert.deepEqual(published, ['old', 'new']);
	assert.deepEqual(disposed, ['old']);
	assert.equal(recovery.state.key, 'new');
});
