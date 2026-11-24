import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBotEnvironmentOverview } from '../dist/index.js';

const overview = (extra = {}) => ({
	botId: 'abc123def456',
	state: 'running',
	uptimeMs: 0,
	image: 'terminay-bot:local',
	fingerprint: 'f',
	current: true,
	homeVolume: 'terminay-bot-abc123def456-home',
	limits: { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512 },
	limitsEnforced: true,
	engineSocket: 'proxy',
	limitsChangePending: false,
	cpuPercent: null,
	memoryBytes: null,
	homeBytes: null,
	sampledAt: 1,
	log: '',
	...extra,
});

test('an overview from a server that predates usageRead parses as read', () => {
	const parsed = parseBotEnvironmentOverview(overview());
	assert.equal(parsed.usageRead, undefined);
});

test('a state-only overview carries usageRead false', () => {
	assert.equal(
		parseBotEnvironmentOverview(overview({ usageRead: false })).usageRead,
		false,
	);
});

test('a non-boolean usageRead is refused', () => {
	assert.throws(
		() => parseBotEnvironmentOverview(overview({ usageRead: 'no' })),
		/invalid bot environment flag/,
	);
});
