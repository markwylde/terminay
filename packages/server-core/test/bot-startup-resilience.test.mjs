import assert from 'node:assert/strict';
import test from 'node:test';
import {
	ADAPTER_EXIT_LASTING,
	ADAPTER_EXIT_TEMPORARY,
	BotStartupError,
	classifyStartup,
	EngineCommandError,
	StartupBudget,
	startupRetryDelay,
	temporaryEngineCode,
} from '../dist/botService/index.js';
import { adapterCheckFailure } from '../dist/botService/runtimeBridge.js';
import { botFailureCause } from '../dist/botService/failure.js';

test('engine deadlines and dropped connections are temporary; refused or missing sockets are not', () => {
	assert.equal(
		temporaryEngineCode(new EngineCommandError('deadline', 'slow')),
		'engine-deadline',
	);
	for (const errno of [
		'ECONNRESET',
		'EPIPE',
		'ECONNABORTED',
		'ERR_STREAM_PREMATURE_CLOSE',
	])
		assert.equal(
			temporaryEngineCode(new EngineCommandError('socket', 'x', { errno })),
			'engine-connection',
			errno,
		);
	for (const errno of ['ECONNREFUSED', 'ENOENT', 'EACCES'])
		assert.equal(
			temporaryEngineCode(new EngineCommandError('socket', 'x', { errno })),
			null,
			errno,
		);
	// A process that exited is not a dropped connection, whatever its errno.
	assert.equal(
		temporaryEngineCode(
			new EngineCommandError('socket', 'x', { errno: 'EPIPE', exitCode: 1 }),
		),
		null,
	);
	assert.equal(temporaryEngineCode(new Error('deadline')), null);
});

test('classification never reads message text', () => {
	const lookalike = new Error('engine deadline ECONNRESET timed out');
	assert.equal(classifyStartup(lookalike, 'prepare'), lookalike);
	const real = classifyStartup(
		new EngineCommandError('deadline', 'opaque'),
		'relay',
	);
	assert.ok(real instanceof BotStartupError);
	assert.deepEqual(real.failure, {
		stage: 'relay',
		temporary: true,
		code: 'engine-deadline',
	});
	assert.match(real.message, /starting the terminay_bot relay/);
	// A temporary failure never carries the blocking engine cause.
	assert.equal(botFailureCause(real), null);
});

test('adapter check outcomes map to stage, code and honest advice', () => {
	const cases = [
		[
			new EngineCommandError('deadline', 'x'),
			'adapter-timeout',
			true,
			/timed out.*overloaded/,
		],
		[
			new EngineCommandError('socket', 'x', { errno: 'ECONNRESET' }),
			'engine-connection',
			true,
			/dropped/,
		],
		[
			new EngineCommandError('exit', 'x', { exitCode: ADAPTER_EXIT_TEMPORARY }),
			'adapter-temporary',
			true,
			/in time/,
		],
		[
			new EngineCommandError('exit', 'x', { exitCode: ADAPTER_EXIT_LASTING }),
			'adapter-lasting',
			false,
			/could not use its runtime socket/,
		],
		[
			new EngineCommandError('exit', 'x', { exitCode: 1 }),
			'other',
			false,
			/check failed/,
		],
		[
			new EngineCommandError('exit', 'x', { exitCode: 126 }),
			'adapter-missing',
			false,
			/Rebuild the bot image/,
		],
		[
			new EngineCommandError('exit', 'x', { exitCode: 127 }),
			'adapter-missing',
			false,
			/Rebuild the bot image/,
		],
	];
	for (const [error, code, temporary, message] of cases) {
		const failure = adapterCheckFailure(
			error,
			'terminay-bot-mcp: said something',
		);
		assert.equal(failure.stage, 'adapter-check');
		assert.equal(failure.code, code);
		assert.equal(failure.temporary, temporary, code);
		assert.match(failure.message, message);
		assert.match(
			failure.message,
			/Adapter said: terminay-bot-mcp: said something/,
		);
		if (code !== 'adapter-missing')
			assert.doesNotMatch(failure.message, /[Rr]ebuild/, code);
	}
});

test('a failure whose cleanup is unconfirmed is no longer retryable', () => {
	const first = new BotStartupError(
		'relay',
		'relay-not-ready',
		true,
		'Relay closed.',
	);
	const final = first.unconfirmed();
	assert.equal(final.temporary, false);
	assert.equal(final.cleanupUnconfirmed, true);
	assert.match(final.message, /could not be confirmed stopped/);
});

test('retry delays are about 10, 30 and 60 seconds, varied by up to a fifth', () => {
	assert.equal(
		startupRetryDelay(1, () => 0.5),
		10_000,
	);
	assert.equal(
		startupRetryDelay(2, () => 0.5),
		30_000,
	);
	assert.equal(
		startupRetryDelay(3, () => 0.5),
		60_000,
	);
	assert.equal(
		startupRetryDelay(1, () => 0),
		8_000,
	);
	assert.equal(
		startupRetryDelay(3, () => 1),
		72_000,
	);
	assert.equal(
		startupRetryDelay(9, () => 0.5),
		60_000,
	);
});

test('the startup budget grants two at once, in request order, and frees a cancelled waiter', async () => {
	const budget = new StartupBudget(2);
	const order = [];
	const a = await budget.acquire('a');
	const b = await budget.acquire('b');
	assert.equal(budget.inUse, 2);
	const c = budget.acquire('c').then((release) => {
		order.push('c');
		return release;
	});
	const d = budget.acquire('d').then(
		() => order.push('d'),
		(error) => order.push(`d refused: ${error.message}`),
	);
	const e = budget.acquire('e').then((release) => {
		order.push('e');
		return release;
	});
	assert.equal(budget.isWaiting('c'), true);
	budget.cancel('d', new Error('replaced'));
	await d;
	a();
	a(); // Releasing twice frees one permit only.
	const releaseC = await c;
	assert.equal(budget.inUse, 2);
	assert.equal(budget.isWaiting('e'), true);
	b();
	const releaseE = await e;
	assert.deepEqual(order, ['d refused: replaced', 'c', 'e']);
	releaseC();
	releaseE();
	assert.equal(budget.inUse, 0);
});
