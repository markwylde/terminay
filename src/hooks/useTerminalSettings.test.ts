import assert from 'node:assert/strict';
import test from 'node:test';
import { settleSettingsAuthorities } from '../settingsAuthoritySettlement.ts';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, reject, resolve };
}

test('device failure waits for a late server commit before rejecting', async () => {
	const server = deferred<void>();
	const settled = settleSettingsAuthorities(
		'update',
		server.promise,
		Promise.reject(new Error('device failed')),
	);
	let finished = false;
	void settled
		.finally(() => {
			finished = true;
		})
		.catch(() => undefined);
	await Promise.resolve();
	assert.equal(finished, false);
	server.resolve();
	await assert.rejects(settled, /device authority/);
});

test('server failure waits for a late device commit before rejecting', async () => {
	const device = deferred<string>();
	const settled = settleSettingsAuthorities(
		'reset',
		Promise.reject(new Error('server failed')),
		device.promise,
	);
	let finished = false;
	void settled
		.finally(() => {
			finished = true;
		})
		.catch(() => undefined);
	await Promise.resolve();
	assert.equal(finished, false);
	device.resolve('committed');
	await assert.rejects(settled, /server authority/);
});

test('successful dual-authority settlement returns the device projection', async () => {
	assert.equal(
		await settleSettingsAuthorities(
			'update',
			Promise.resolve(),
			Promise.resolve('device'),
		),
		'device',
	);
});
