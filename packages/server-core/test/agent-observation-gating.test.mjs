import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * An observation attempt spawns a process, and an unbound terminal's directory
 * watches are what re-run it, so a disabled feature that merely discards its
 * results still costs the whole feature. "Off" has to mean the work is
 * cancelled: watches closed, nothing scheduled.
 */
async function runtimeHarness(options = {}) {
	const { AgentStatusService, ExtensionAgentRuntimeRegistry } = await import(
		'../dist/index.js'
	);

	const timers = new Map();
	let nextTimer = 1;
	const watchers = [];

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
		watchDirectory: (path, onChange) => {
			const watcher = { path, onChange, closed: false, close() { watcher.closed = true; } };
			watchers.push(watcher);
			return watcher;
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
		watchers,
	};
}

const identity = Object.freeze({ serverId: 'server-a', projectId: 'project-1', sessionId: 'terminal-1' });
const provider = Object.freeze({
	id: 'com.terminay.agent-test/test',
	displayName: 'Test Agent',
	processMatchers: [{ executableName: 'test-agent' }],
	mappings: [{ mappingVersion: 'test-v1', providerVersionRange: '>=1' }],
});

test('disabling integration closes an unbound terminal\'s watches and opens none while off', async () => {
	const { AgentStatusService, ExtensionAgentRuntimeRegistry, TerminalActivityService } = await import('../dist/index.js');
	const activity = new TerminalActivityService({ serverId: identity.serverId });
	activity.register(identity);
	const agents = new AgentStatusService({ activity });
	await agents.start();
	agents.register(identity);
	let admissions = 0;
	const timers = new Map();
	let nextTimer = 1;
	const watchers = [];
	const runtime = new ExtensionAgentRuntimeRegistry({
		agents,
		hosts: {
			agentProviderContributions: () => [provider],
			admitAgentTerminal: async () => {
				admissions += 1;
				return { state: 'not-bound', awaiting: ['/home/user/.test-agent/sessions'] };
			},
			cancelAgentTerminal: async () => true,
			drainAgentObservers: async () => undefined,
		},
		watchDirectory: (path, onChange) => {
			const watcher = { path, onChange, closed: false, close() { watcher.closed = true; } };
			watchers.push(watcher);
			return watcher;
		},
		schedule: (callback, ms) => {
			const id = nextTimer++;
			timers.set(id, { callback, ms });
			return id;
		},
		cancelSchedule: (id) => {
			timers.delete(id);
		},
	});
	runtime.register(identity);
	runtime.terminalStarted(identity, 4321);
	assert.equal(runtime.foregroundProcessChanged(identity, 'test-agent'), true);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(admissions, 1);
	assert.equal(watchers.length, 1, 'an unbound terminal watches what its provider named');
	assert.equal(timers.size, 0, 'and schedules nothing');

	agents.setIntegrationEnabled(false);
	assert.ok(watchers.every((watcher) => watcher.closed), 'off closes the watches');
	watchers[0].onChange();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(admissions, 1, 'a late change on a closed watch re-runs nothing');
	assert.equal(timers.size, 0);
	runtime.register(identity);
	runtime.terminalStarted(identity, 4321);
	assert.equal(runtime.foregroundProcessChanged(identity, 'test-agent'), false, 'nothing is admitted while off');
	assert.equal(watchers.length, 1, 'and no watch is opened');
	await agents.stop();
});

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
