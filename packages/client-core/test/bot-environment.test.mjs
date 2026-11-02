import assert from 'node:assert/strict';
import test from 'node:test';
import { BotEnvironmentClient } from '../dist/botEnvironment.js';

const botId = 'abc123def456';
const overview = {
	botId,
	state: 'running',
	uptimeMs: 1000,
	image: 'terminay-bot:local',
	fingerprint: 'abc',
	current: true,
	homeVolume: `terminay-bot-${botId}-home`,
	limits: { cpus: 2, memoryBytes: 4294967296, pids: 1024 },
	limitsEnforced: true,
	shareEngineSocket: false,
	socketChangePending: false,
	limitsChangePending: false,
	socketWarning: 'root-equivalent',
	cpuPercent: 1,
	memoryBytes: 1000,
	homeBytes: 2000,
	sampledAt: 1234,
	log: 'redacted',
};

test('bot environment facade samples each request and forwards lifecycle/container operations', async () => {
	const calls = [];
	const transport = {
		async query(operation, payload, options) {
			calls.push([operation, payload, options]);
			return operation.endsWith('overview') ? overview : [];
		},
		async command(operation, payload, options) {
			calls.push([operation, payload, options]);
			return operation.endsWith('container-action') && payload.action === 'logs'
				? 'log'
				: null;
		},
	};
	const client = new BotEnvironmentClient(transport);
	const first = await client.overview(botId);
	const second = await client.overview(botId);
	assert.deepEqual(first, second);
	assert.notEqual(first, second);
	assert.deepEqual(await client.containers(botId), []);
	await client.lifecycle(botId, 'start');
	await client.lifecycle(botId, 'recreate', { confirmed: true });
	await client.remove(botId, false);
	assert.equal(
		await client.containerAction(botId, 'a'.repeat(64), 'logs'),
		'log',
	);
	assert.deepEqual(
		calls.map((call) => call[0]),
		[
			'bots.environment.overview',
			'bots.environment.overview',
			'bots.environment.containers',
			'bots.environment.start',
			'bots.environment.recreate',
			'bots.environment.remove',
			'bots.environment.container-action',
		],
	);
	assert.equal(calls[4][1].confirmed, true);
	assert.equal(calls[5][1].deleteHome, false);
});

test('bot environment facade validates ids and bounded results', async () => {
	const client = new BotEnvironmentClient({
		query: async () => ({ ...overview, log: 'x'.repeat(262145) }),
		command: async () => null,
	});
	await assert.rejects(client.overview(botId), /text/);
	await assert.rejects(client.overview('../host'), /bot id/);
	await assert.rejects(client.containers(botId), /containers/);
	await assert.rejects(client.lifecycle(botId, 'shell command'), /lifecycle/);
});

test('settings facade validates request/result shapes and forwards revision and confirmation', async () => {
	const calls = [];
	const settings = {
		botId,
		shareEngineSocket: false,
		idleStopMs: 1800000,
		limits: overview.limits,
		limitsEnforced: true,
		socketWarning: 'root-equivalent',
		revision: 0,
	};
	const client = new BotEnvironmentClient({
		query: async (operation, payload) => {
			calls.push([operation, payload]);
			return settings;
		},
		command: async (operation, payload) => {
			calls.push([operation, payload]);
			return { ...settings, ...payload, revision: 1 };
		},
	});
	assert.deepEqual(await client.settings(botId), settings);
	const patch = {
		botId,
		shareEngineSocket: true,
		idleStopMs: null,
		confirmed: true,
		expectedRevision: 0,
	};
	assert.equal((await client.setSettings(patch)).revision, 1);
	assert.deepEqual(calls, [
		['bots.environment.settings', { botId }],
		['bots.environment.set-settings', patch],
	]);
	await assert.rejects(
		client.setSettings({ botId, idleStopMs: 1 }),
		/idle stop/,
	);
	assert.equal(calls.length, 2);
	const invalid = new BotEnvironmentClient({
		query: async () => ({ ...settings, revision: -1 }),
	});
	await assert.rejects(invalid.settings(botId), /revision/);
});

test('overview parser validates the pending limits', async () => {
	const valid = {
		...overview,
		limitsChangePending: true,
	};
	let response = valid;
	const client = new BotEnvironmentClient({ query: async () => response });
	assert.deepEqual(await client.overview(botId), valid);
	for (const patch of [{ limitsChangePending: undefined }]) {
		response = { ...valid, ...patch };
		await assert.rejects(client.overview(botId), TypeError);
	}
});
