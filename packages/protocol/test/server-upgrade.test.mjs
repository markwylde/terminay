import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CLIENT_SERVER_COMPATIBILITY,
	encodeFrame,
	evaluateServerCompatibility,
	FEATURE_CAPABILITIES,
	parseServerUpgradeStartRequest,
	parseServerUpgradeStatus,
	SERVER_UPGRADE_CAPABILITY,
	SERVER_UPGRADE_OPERATIONS,
} from '../dist/index.js';

const status = (overrides = {}) => ({
	version: '5.1.1',
	channel: 'tag',
	available: { version: '5.2.0' },
	canUpgrade: true,
	modes: ['in-place'],
	upgrade: { state: 'none' },
	...overrides,
});

test('server upgrade is a capability a client can do without', () => {
	assert.equal(FEATURE_CAPABILITIES.serverUpgrade, 'server.upgrade');
	assert.equal(SERVER_UPGRADE_CAPABILITY, FEATURE_CAPABILITIES.serverUpgrade);
	assert.equal(
		CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.includes(
			SERVER_UPGRADE_CAPABILITY,
		),
		true,
	);
	assert.equal(
		CLIENT_SERVER_COMPATIBILITY.requiredCapabilities.includes(
			SERVER_UPGRADE_CAPABILITY,
		),
		false,
	);
	// A server from before the capability is still one this client works with.
	const older = evaluateServerCompatibility(CLIENT_SERVER_COMPATIBILITY, {
		type: 'server_hello',
		protocolVersion: CLIENT_SERVER_COMPATIBILITY.protocol.maximum,
		serverId: 'older',
		serverVersion: '5.0.0',
		clientId: 'client',
		capabilities: [
			...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities,
			...CLIENT_SERVER_COMPATIBILITY.optionalCapabilities.filter(
				(capability) => capability !== SERVER_UPGRADE_CAPABILITY,
			),
		],
		limits: {},
		authScope: 'admin',
	});
	assert.equal(older.state, 'degraded');
	assert.deepEqual(older.missingOptionalCapabilities, [
		SERVER_UPGRADE_CAPABILITY,
	]);
});

test('every server upgrade operation name can be encoded on the wire', () => {
	assert.deepEqual(
		{ ...SERVER_UPGRADE_OPERATIONS },
		{
			status: 'server.upgrade.status',
			start: 'server.upgrade.start',
			event: 'server.upgrade',
		},
	);
	for (const operation of [
		SERVER_UPGRADE_OPERATIONS.status,
		SERVER_UPGRADE_OPERATIONS.start,
	])
		assert.doesNotThrow(() =>
			encodeFrame({ type: 'query', queryId: 'q1', operation, payload: {} }),
		);
});

test('a status is accepted exactly as a server publishes it', () => {
	assert.deepEqual(parseServerUpgradeStatus(status()), status());
	assert.deepEqual(
		parseServerUpgradeStatus({
			version: '5.1.1',
			canUpgrade: false,
			modes: [],
			upgrade: { state: 'none' },
		}),
		{
			version: '5.1.1',
			canUpgrade: false,
			modes: [],
			upgrade: { state: 'none' },
		},
	);
	const container = status({
		modes: ['in-place', 'recreate'],
		recreateEndsTerminals: true,
	});
	assert.deepEqual(parseServerUpgradeStatus(container), container);
	const unavailable = status({
		canUpgrade: false,
		modes: [],
		unavailable: {
			reason: 'no helper',
			command: 'sudo terminay daemon upgrade',
		},
	});
	assert.deepEqual(parseServerUpgradeStatus(unavailable), unavailable);
	for (const upgrade of [
		{ state: 'in-progress', mode: 'in-place', startedAt: 1_000 },
		{ state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 2_000 },
		{
			state: 'failed',
			from: '5.1.1',
			to: '5.2.0',
			reason: 'not ready',
			restored: true,
			at: 2_000,
		},
		{ state: 'failed', from: '5.1.1', to: '5.2.0', restored: true, at: 2_000 },
	])
		assert.deepEqual(
			parseServerUpgradeStatus(status({ upgrade })).upgrade,
			upgrade,
		);
});

test('a malformed status is refused', () => {
	for (const bad of [
		null,
		[],
		status({ version: '' }),
		status({ version: 'x'.repeat(129) }),
		status({ channel: 'nightly' }),
		status({ available: { version: '5.2.0', url: 'https://example.test' } }),
		status({ canUpgrade: 'yes' }),
		status({ modes: ['recreate', 'recreate'] }),
		status({ modes: ['sideways'] }),
		// Recreate is never offered without saying what it costs.
		status({ modes: ['in-place', 'recreate'] }),
		status({ recreateEndsTerminals: true }),
		status({ unavailable: { reason: 'no helper' } }),
		status({ upgrade: undefined }),
		status({ upgrade: { state: 'paused' } }),
		status({ upgrade: { state: 'none', extra: 1 } }),
		status({
			upgrade: { state: 'in-progress', mode: 'in-place', startedAt: -1 },
		}),
		status({
			upgrade: {
				state: 'failed',
				from: '5.1.1',
				to: '5.2.0',
				restored: false,
				at: 1,
			},
		}),
		status({ extra: true }),
	])
		assert.throws(
			() => parseServerUpgradeStatus(bad),
			TypeError,
			JSON.stringify(bad),
		);
});

test('a start request names a mode and nothing else', () => {
	assert.deepEqual(parseServerUpgradeStartRequest({ mode: 'in-place' }), {
		mode: 'in-place',
	});
	assert.deepEqual(parseServerUpgradeStartRequest({ mode: 'recreate' }), {
		mode: 'recreate',
	});
	for (const bad of [
		null,
		[],
		{},
		{ mode: 'sideways' },
		{ mode: ['in-place'] },
		{ mode: 'in-place', version: '5.2.0' },
		{ mode: 'in-place', ref: 'main' },
		{ mode: 'in-place', url: 'https://example.test/terminay.tar.gz' },
		{ mode: 'in-place', path: '/tmp/terminay' },
		{ mode: 'in-place', flags: ['--force'] },
	])
		assert.throws(
			() => parseServerUpgradeStartRequest(bad),
			TypeError,
			JSON.stringify(bad),
		);
});
