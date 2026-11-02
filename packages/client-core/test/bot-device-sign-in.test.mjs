import assert from 'node:assert/strict';
import test from 'node:test';
import { BotCredentialClient, BotIoClient } from '../dist/index.js';

const botId = 'abc123def456';
test('device sign-in uses a bound terminal with credit reads, resize and sign-out', async () => {
	const calls = [];
	let read = false;
	const transport = {
		command: async (operation, payload) => {
			calls.push([operation, payload]);
			return { streamId: 'signin', botId, generation: 1 };
		},
		queryWithBody: async (operation, payload) => {
			calls.push([operation, payload]);
			const done = read;
			read = true;
			return {
				result: { done },
				body: done
					? new Uint8Array()
					: Buffer.from('https://example.invalid/device TEST-CODE'),
			};
		},
	};
	const terminal = await new BotIoClient(transport).shell(
		botId,
		1,
		80,
		24,
		{},
		'sign-in',
	);
	await terminal.resize(100, 40);
	let output = '';
	for await (const bytes of terminal.read())
		output += Buffer.from(bytes).toString();
	assert.match(output, /TEST-CODE/);
	await new BotCredentialClient(transport).deviceSignOut(botId);
	assert.deepEqual(calls[0], [
		'bots.shell.open',
		{ botId, generation: 1, cols: 80, rows: 24, purpose: 'sign-in' },
	]);
	assert.deepEqual(calls[1], [
		'bots.shell.resize',
		{ streamId: 'signin', botId, generation: 1, cols: 100, rows: 40 },
	]);
	assert.deepEqual(calls.at(-1), [
		'bots.credentials.device-sign-out',
		{ botId },
	]);
});

test('abandoning sign-in closes its handle and invalid bot ids never reach the transport', async () => {
	const calls = [];
	const transport = {
		command: async (operation) => {
			calls.push(operation);
			return { streamId: 'signin', botId, generation: 1 };
		},
	};
	const io = new BotIoClient(transport);
	const terminal = await io.shell(botId, 1, 80, 24, {}, 'sign-in');
	await terminal.close();
	await terminal.close();
	await assert.rejects(
		new BotCredentialClient(transport).deviceSignOut('../escape'),
	);
	await assert.rejects(io.shell('../escape', 2, 80, 24, {}, 'sign-in'));
	assert.deepEqual(calls, ['bots.shell.open', 'bots.io.close']);
});
