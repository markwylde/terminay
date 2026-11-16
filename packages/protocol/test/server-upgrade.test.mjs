import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CLIENT_SERVER_COMPATIBILITY,
	encodeFrame,
	evaluateServerCompatibility,
	FEATURE_CAPABILITIES,
	parseServerUpgradeAttemptState,
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
				(capability) =>
					capability !== SERVER_UPGRADE_CAPABILITY &&
					capability !== FEATURE_CAPABILITIES.serverUpgradeAttempts,
			),
		],
		limits: {},
		authScope: 'admin',
	});
	assert.equal(older.state, 'degraded');
	assert.deepEqual(older.missingOptionalCapabilities, [
		SERVER_UPGRADE_CAPABILITY,
		FEATURE_CAPABILITIES.serverUpgradeAttempts,
	]);
});

test('every server upgrade operation name can be encoded on the wire', () => {
	assert.deepEqual(
		{ ...SERVER_UPGRADE_OPERATIONS },
		{
			status: 'server.upgrade.status',
			start: 'server.upgrade.start',
			check: 'server.upgrade.check',
			event: 'server.upgrade',
			attempt: 'server.upgrade.attempt',
			attemptEvent: 'server.upgrade.attempt.changed',
		},
	);
	for (const operation of [
		SERVER_UPGRADE_OPERATIONS.status,
		SERVER_UPGRADE_OPERATIONS.start,
		SERVER_UPGRADE_OPERATIONS.check,
		SERVER_UPGRADE_OPERATIONS.attempt,
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
	// Consent to move backwards is a boolean and never a version (ADR-0117).
	assert.deepEqual(
		parseServerUpgradeStartRequest({ mode: 'in-place', allowOlder: true }),
		{ mode: 'in-place', allowOlder: true },
	);
	assert.deepEqual(parseServerUpgradeStartRequest({ mode: 'recreate' }), {
		mode: 'recreate',
	});
	// The device's own request id, so it can find its attempt (ADR-0125).
	assert.deepEqual(
		parseServerUpgradeStartRequest({
			mode: 'in-place',
			requestId: 'req-0b6c2f2e',
		}),
		{ mode: 'in-place', requestId: 'req-0b6c2f2e' },
	);
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
		{ mode: 'in-place', allowOlder: false },
		{ mode: 'in-place', allowOlder: '5.1.0' },
		{ mode: 'in-place', allowOlder: true, version: '5.1.0' },
		{ mode: 'in-place', requestId: '' },
		{ mode: 'in-place', requestId: 'has space' },
		{ mode: 'in-place', requestId: 'x'.repeat(65) },
		{ mode: 'in-place', requestId: 7 },
	])
		assert.throws(
			() => parseServerUpgradeStartRequest(bad),
			TypeError,
			JSON.stringify(bad),
		);
});

test("a status may name the channel's latest release, whichever way it orders", () => {
	const base = {
		version: '5.3.0-main.40.nightly',
		channel: 'main',
		canUpgrade: true,
		modes: ['in-place'],
		upgrade: { state: 'none' },
	};
	const older = parseServerUpgradeStatus({
		...base,
		latest: { version: '5.3.0-main.38.nightly', order: 'older', canInstall: true },
	});
	assert.deepEqual(older.latest, {
		version: '5.3.0-main.38.nightly',
		order: 'older',
		canInstall: true,
	});
	const blocked = parseServerUpgradeStatus({
		...base,
		latest: {
			version: '5.2.0',
			order: 'older',
			canInstall: false,
			unavailable: { reason: 'needs the helper', command: 'sudo terminay daemon upgrade --allow-downgrade --system' },
		},
	});
	assert.equal(blocked.latest.unavailable.reason, 'needs the helper');
	for (const latest of [
		{ version: '5.2.0', order: 'sideways', canInstall: true },
		{ version: '5.2.0', order: 'older', canInstall: 'yes' },
		{ version: '5.2.0', order: 'same', canInstall: true },
		{ version: '', order: 'older', canInstall: true },
		{ version: '5.2.0', order: 'older', canInstall: true, url: 'https://example.test' },
	])
		assert.throws(() => parseServerUpgradeStatus({ ...base, latest }), TypeError, JSON.stringify(latest));
});

const attempt = (overrides = {}) => ({
	id: '6f1c9a52-41d5-4c5c-9d0e-5e1f00c0ffee',
	requestId: 'req-1',
	mode: 'in-place',
	kind: 'upgrade',
	startedAt: 1_000,
	expiresAt: 1_801_000,
	stage: 'requested',
	...overrides,
});

test('an attempt is accepted exactly as a server publishes it', () => {
	assert.deepEqual(parseServerUpgradeAttemptState({ attempt: null }), {
		attempt: null,
	});
	for (const stage of ['requested', 'installing', 'finishing'])
		assert.equal(
			parseServerUpgradeAttemptState({ attempt: attempt({ stage }) }).attempt
				?.stage,
			stage,
		);
	for (const kind of ['succeeded', 'rolled-back', 'unchanged', 'failed']) {
		const ended = attempt({
			stage: undefined,
			ending: {
				kind,
				from: '6.10.0-main.3493.canary',
				to: '6.10.0-main.3493.canary',
				...(kind === 'succeeded' || kind === 'unchanged'
					? {}
					: { reason: 'the channel could not be read' }),
				at: 2_000,
			},
		});
		delete ended.stage;
		assert.equal(
			parseServerUpgradeAttemptState({ attempt: ended }).attempt?.ending?.kind,
			kind,
		);
	}
	// An attempt without a request id is one another device or a server start
	// began.
	const { requestId: _omitted, ...bare } = attempt();
	assert.equal(
		parseServerUpgradeAttemptState({ attempt: bare }).attempt?.requestId,
		undefined,
	);
});

test('a malformed attempt is refused', () => {
	const ended = {
		kind: 'succeeded',
		from: '5.1.1',
		to: '5.2.0',
		at: 2_000,
	};
	for (const bad of [
		{},
		{ attempt: undefined },
		{ attempt: attempt(), extra: true },
		{ attempt: attempt({ stage: 'downloading' }) },
		{ attempt: attempt({ id: 'x'.repeat(65) }) },
		{ attempt: attempt({ id: '' }) },
		{ attempt: attempt({ requestId: 'has space' }) },
		{ attempt: attempt({ mode: 'sideways' }) },
		{ attempt: attempt({ kind: 'downgrade' }) },
		{ attempt: attempt({ expiresAt: 500 }) },
		{ attempt: attempt({ ending: ended }) },
		{ attempt: { ...attempt(), stage: undefined } },
		{
			attempt: {
				...attempt({ ending: { ...ended, kind: 'maybe' } }),
				stage: undefined,
			},
		},
		{
			attempt: {
				...attempt({ ending: { ...ended, path: '/opt' } }),
				stage: undefined,
			},
		},
	]) {
		const value = JSON.parse(JSON.stringify(bad));
		assert.throws(
			() => parseServerUpgradeAttemptState(value),
			TypeError,
			JSON.stringify(bad),
		);
	}
});

test('a released client reads every status a server with attempts publishes', () => {
	// The status keeps its shape: attempts travel on their own surface, so a
	// client that predates them never meets a field it would refuse.
	for (const upgrade of [
		{ state: 'none' },
		{ state: 'in-progress', mode: 'in-place', startedAt: 1_000 },
		{ state: 'succeeded', from: '5.1.1', to: '5.2.0', at: 2_000 },
		// An unchanged ending is a success from and to the running release.
		{ state: 'succeeded', from: '5.2.0', to: '5.2.0', at: 2_000 },
		// A failure that changed nothing has the running release "again".
		{
			state: 'failed',
			from: '5.1.1',
			to: '5.1.1',
			reason: 'the channel could not be read',
			restored: true,
			at: 2_000,
		},
	])
		assert.doesNotThrow(() => parseServerUpgradeStatus(status({ upgrade })));
});
