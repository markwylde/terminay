import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Topology sampling spawns a process per sample, so a disabled feature that
 * merely discards its results still costs the whole feature. "Off" has to mean
 * the work is cancelled.
 */
async function runtimeHarness(options = {}) {
	const { AgentStatusService, ExtensionAgentRuntimeRegistry } = await import(
		'../dist/index.js'
	);

	const timers = new Map();
	let nextTimer = 1;
	let signatureCalls = 0;

	const activity = {
		serverId: 'server-a',
		record: () => undefined,
		publish: () => undefined,
	};
	const agents = new AgentStatusService({ activity });

	const runtime = new ExtensionAgentRuntimeRegistry({
		hosts: {
			agentProviderContributions: () => [],
			admitAgentTerminal: async () => undefined,
			cancelAgentTerminal: async () => undefined,
			drainAgentObservers: async () => undefined,
		},
		agents,
		topologySignature: async () => {
			signatureCalls += 1;
			return `signature-${signatureCalls}`;
		},
		schedule: (callback, ms) => {
			const id = nextTimer++;
			timers.set(id, { callback, ms });
			return id;
		},
		cancelSchedule: (id) => {
			timers.delete(id);
		},
		...options,
	});

	return {
		agents,
		runtime,
		timers,
		signatureCalls: () => signatureCalls,
	};
}

test('the runtime starts from the integration setting rather than assuming on', async () => {
	const { agents, runtime } = await runtimeHarness();
	assert.equal(
		runtime.observationIsEnabled,
		true,
		'integration defaults on, so observation does too',
	);

	agents.setIntegrationEnabled(false);
	const second = await runtimeHarness();
	second.agents.setIntegrationEnabled(false);
	assert.equal(second.runtime.observationIsEnabled, false);
});

test('disabling integration disables observation through the service', async () => {
	const { agents, runtime } = await runtimeHarness();
	assert.equal(runtime.observationIsEnabled, true);

	assert.equal(agents.setIntegrationEnabled(false), true);
	assert.equal(
		runtime.observationIsEnabled,
		false,
		'the runtime must observe the setting, not only the service',
	);

	assert.equal(agents.setIntegrationEnabled(true), true);
	assert.equal(runtime.observationIsEnabled, true);
});

test('a repeated set is a no-op and does not churn observers', async () => {
	const { agents, runtime } = await runtimeHarness();
	assert.equal(agents.setIntegrationEnabled(false), true);
	assert.equal(agents.setIntegrationEnabled(false), false);
	assert.equal(runtime.observationIsEnabled, false);
});

test('an observer that throws does not stop the setting applying', async () => {
	const { agents, runtime } = await runtimeHarness();
	agents.observeIntegrationEnabled(() => {
		throw new Error('observer failure');
	});
	assert.doesNotThrow(() => agents.setIntegrationEnabled(false));
	assert.equal(
		runtime.observationIsEnabled,
		false,
		'a failing observer must not prevent the runtime hearing the change',
	);
});

test('setObservationEnabled rejects a non-boolean', async () => {
	const { runtime } = await runtimeHarness();
	assert.throws(() => runtime.setObservationEnabled('yes'), TypeError);
});
