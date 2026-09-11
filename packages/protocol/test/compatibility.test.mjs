import assert from 'node:assert/strict';
import test from 'node:test';
import {
	CLIENT_SERVER_COMPATIBILITY,
	FEATURE_CAPABILITIES,
	evaluateServerCompatibility,
	parseServerCompatibilityRequirements,
} from '../dist/index.js';

const requirements = {
	protocol: { minimum: 1, maximum: 1 },
	requiredCapabilities: [
		FEATURE_CAPABILITIES.workspace,
		FEATURE_CAPABILITIES.terminal,
	],
	optionalCapabilities: [FEATURE_CAPABILITIES.git],
};

function hello(capabilities, protocolVersion = 1) {
	return {
		type: 'server_hello',
		protocolVersion,
		serverId: 'server-a',
		serverVersion: '3.0.0',
		clientId: 'client-a',
		capabilities,
		limits: {},
		authScope: 'write',
	};
}

test('a server serving every declared capability is compatible', () => {
	const result = evaluateServerCompatibility(
		requirements,
		hello([
			FEATURE_CAPABILITIES.workspace,
			FEATURE_CAPABILITIES.terminal,
			FEATURE_CAPABILITIES.git,
		]),
	);
	assert.equal(result.state, 'compatible');
	assert.equal(result.serverVersion, '3.0.0');
});

test('a server missing only an optional capability is degraded and names it', () => {
	const result = evaluateServerCompatibility(
		requirements,
		hello([FEATURE_CAPABILITIES.workspace, FEATURE_CAPABILITIES.terminal]),
	);
	assert.equal(result.state, 'degraded');
	assert.deepEqual(result.missingOptionalCapabilities, [
		FEATURE_CAPABILITIES.git,
	]);
});

test('a server missing a required capability is incompatible and names the server', () => {
	const result = evaluateServerCompatibility(
		requirements,
		hello([FEATURE_CAPABILITIES.workspace]),
	);
	assert.equal(result.state, 'incompatible');
	assert.equal(result.reason, 'capability');
	assert.equal(result.upgrade, 'server');
	assert.deepEqual(result.missingRequiredCapabilities, [
		FEATURE_CAPABILITIES.terminal,
	]);
	assert.match(result.message, /Update the server/u);
});

test('a server below the client protocol range asks for a server upgrade', () => {
	const result = evaluateServerCompatibility(
		{ ...requirements, protocol: { minimum: 2, maximum: 3 } },
		hello([FEATURE_CAPABILITIES.workspace, FEATURE_CAPABILITIES.terminal], 1),
	);
	assert.equal(result.state, 'incompatible');
	assert.equal(result.reason, 'protocol');
	assert.equal(result.upgrade, 'server');
});

test('a server above the client protocol range asks for a client upgrade', () => {
	const result = evaluateServerCompatibility(
		requirements,
		hello([FEATURE_CAPABILITIES.workspace, FEATURE_CAPABILITIES.terminal], 4),
	);
	assert.equal(result.state, 'incompatible');
	assert.equal(result.reason, 'protocol');
	assert.equal(result.upgrade, 'client');
	assert.match(result.message, /Update Terminay/u);
});

test('a refused hello is classified from the incompatible_version envelope', () => {
	const older = evaluateServerCompatibility(requirements, {
		type: 'incompatible_version',
		supportedMin: 0,
		supportedMax: 0,
		error: { code: 'incompatible', message: 'no shared protocol version' },
	});
	assert.equal(older.state, 'incompatible');
	assert.equal(older.upgrade, 'server');
	assert.deepEqual(older.serverProtocol, { minimum: 0, maximum: 0 });

	const newer = evaluateServerCompatibility(requirements, {
		type: 'incompatible_version',
		supportedMin: 5,
		supportedMax: 6,
		error: { code: 'incompatible', message: 'no shared protocol version' },
	});
	assert.equal(newer.upgrade, 'client');
});

test('the bundle client declaration parses and keeps required and optional disjoint', () => {
	const parsed = parseServerCompatibilityRequirements(
		JSON.parse(JSON.stringify(CLIENT_SERVER_COMPATIBILITY)),
	);
	assert.deepEqual(
		[...parsed.requiredCapabilities],
		[...CLIENT_SERVER_COMPATIBILITY.requiredCapabilities],
	);
	assert.throws(
		() =>
			parseServerCompatibilityRequirements({
				protocol: { minimum: 1, maximum: 1 },
				requiredCapabilities: [FEATURE_CAPABILITIES.git],
				optionalCapabilities: [FEATURE_CAPABILITIES.git],
			}),
		/both required and optional/u,
	);
	assert.throws(
		() =>
			parseServerCompatibilityRequirements({
				protocol: { minimum: 2, maximum: 1 },
				requiredCapabilities: [],
				optionalCapabilities: [],
			}),
		/protocol range/u,
	);
});
