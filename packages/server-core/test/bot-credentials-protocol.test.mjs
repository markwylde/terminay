import assert from 'node:assert/strict';
import test from 'node:test';
import { BotCredentialClient } from '../../client-core/dist/index.js';
import { BOT_CREDENTIAL_OPERATIONS as op } from '../../protocol/dist/index.js';
import {
	assertBotSessionSignIn,
	BotTokenService,
	createBotCredentialOperations,
} from '../dist/botService/index.js';

const id = 'abc123def456';
test('4.5/4.6 credential facade stores binary values without returning them and exposes risk/status metadata', async () => {
	const entries = new Map();
	let resolutions = 0,
		signedOut = 0;
	const vault = {
		status: () => ({ entries: [...entries.keys()].map((id) => ({ id })) }),
		put: async ({ id, value }) => entries.set(id, Buffer.from(value)),
		replace: async ({ id, value }) => entries.set(id, Buffer.from(value)),
		remove: async (id) => entries.delete(id),
		withSecret: async (id, cb) => {
			resolutions++;
			if (!entries.has(id)) throw Error('missing');
			return cb(entries.get(id));
		},
	};
	const tokens = new BotTokenService(vault),
		controller = new AbortController();
	const context = {
		connectionId: 'c',
		clientId: 'client',
		authScope: 'write',
		signal: controller.signal,
	};
	const agent = {
		id: 'example/agent',
		deviceSignIn: {
			command: { executable: 'example', args: ['login'] },
			signOutCommand: {
				executable: 'example-session',
				args: ['forget', '--all'],
			},
			label: 'Example',
			help: 'Approve the code',
		},
		credentialSecrets: [
			{
				environmentVariable: 'API_KEY',
				kind: 'api-key',
				label: 'key',
				help: 'fake',
			},
		],
	};
	const registry = createBotCredentialOperations({
		authority: (c) => ({ ...c, assertCurrent: () => {} }),
		agent: () => agent,
		deviceSignedIn: () => true,
		deviceSignOut: async () => {
			signedOut++;
		},
		tokens,
	});
	const request = (
		operation,
		payload,
		body = new Uint8Array(),
		ctx = context,
	) => ({ context: ctx, body, envelope: { operation, payload } });
	const client = new BotCredentialClient({
		query: (operation, payload) =>
			registry.queries[operation](request(operation, payload)),
		command: async (operation, payload) =>
			(await registry.commands[operation](request(operation, payload))).result,
		commandWithBody: async (operation, payload, body) =>
			(await registry.commands[operation](request(operation, payload, body)))
				.result,
	});
	const value = Buffer.from('fake-key');
	await client.save(id, 'API_KEY', value);
	assert.ok(value.every((v) => v === 0));
	assert.equal(resolutions, 0);
	const options = await client.options(id);
	assert.equal(options.tokens[0].configured, true);
	assert.deepEqual(options.device, {
		label: 'Example',
		help: 'Approve the code',
		signedIn: true,
	});
	assert.equal(options.tokensReadableByTools, true);
	assert.ok(!JSON.stringify(options).includes('fake-key'));
	assert.equal(resolutions, 0);
	await client.copy(id, 'def123abc456', 'API_KEY');
	assert.equal(entries.size, 2);
	await client.deviceSignOut(id);
	assert.equal(signedOut, 1);
	const denied = Buffer.from('fake-key');
	await assert.rejects(
		registry.commands[op.save](
			request(op.save, { botId: id, variable: 'API_KEY' }, denied, {
				...context,
				claims: { sessionId: 's' },
			}),
		),
		/authority/,
	);
	assert.ok(denied.every((v) => v === 0));
	await assert.rejects(
		client.save(id, 'UNDECLARED', Buffer.from('fake')),
		/undeclared/,
	);
	for (const operation of Object.values(op)) {
		const handler = registry.commands[operation] ?? registry.queries[operation];
		await assert.rejects(
			handler(
				request(operation, { botId: id }, new Uint8Array(), {
					...context,
					authScope: 'read',
				}),
			),
			/authority/,
		);
	}

	assert.doesNotThrow(() =>
		assertBotSessionSignIn('token:API_KEY', 'token:API_KEY'),
	);
	assert.throws(() => assertBotSessionSignIn('device', 'token:API_KEY'), {
		code: 'bot-sign-in-changed',
	});
});
