import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentStatusService,
	agentHarnessSwitchesFromSettings,
	agentIntegrationEnabledFromSettings,
	ProjectAgentScope,
	SessionSourceBridge,
	SessionSourceSupervisor,
	TerminalActivityService,
} from '../dist/index.js';

const sourceId = 'com.terminay.builtin-agents/agents';
const contribution = {
	id: sourceId,
	displayName: 'Built-in Agents',
	harnesses: [
		{ id: 'claude-code', displayName: 'Claude Code' },
		{ id: 'grok', displayName: 'Grok' },
	],
};

function fakeHosts() {
	const listeners = new Set();
	const calls = [];
	let contributions = [];
	return {
		calls,
		publish(next) {
			contributions = next;
			for (const listener of listeners) listener();
		},
		onContributionsChanged(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		sessionSourceContributions: () => contributions,
		async startSessionSource(id, enabled) {
			calls.push(['start', id, [...enabled]]);
		},
		async stopSessionSource(id) {
			calls.push(['stop', id]);
		},
		async setSessionSourceHarnesses(id, enabled) {
			calls.push(['harnesses', id, [...enabled]]);
		},
	};
}

async function fixture(switches = {}) {
	const activity = new TerminalActivityService({ serverId: 's' });
	const agents = new AgentStatusService({ activity });
	await agents.start();
	const scope = new ProjectAgentScope({
		resolveWorktrees: async () => undefined,
	});
	const bridge = new SessionSourceBridge({ agents, scope });
	const supervisor = new SessionSourceSupervisor({
		bridge,
		agents,
		harnessSwitches: switches,
	});
	const hosts = fakeHosts();
	supervisor.attach(hosts);
	return { agents, bridge, supervisor, hosts };
}

test('a registered source starts with only the harnesses switched on', async () => {
	const { supervisor, hosts, bridge } = await fixture({
		[`${sourceId}/grok`]: false,
	});
	hosts.publish([{ extensionId: 'com.terminay.builtin-agents', contribution }]);
	await supervisor.reconcile();
	assert.deepEqual(hosts.calls, [['start', sourceId, ['claude-code']]]);
	assert.equal(bridge.hasSource(sourceId), true);
});

test('switching a harness re-scopes the running source without restarting it', async () => {
	const { supervisor, hosts } = await fixture();
	hosts.publish([{ extensionId: 'com.terminay.builtin-agents', contribution }]);
	await supervisor.reconcile();
	supervisor.setHarnessSwitches({ [`${sourceId}/claude-code`]: false });
	await supervisor.reconcile();
	assert.deepEqual(hosts.calls, [
		['start', sourceId, ['claude-code', 'grok']],
		['harnesses', sourceId, ['grok']],
	]);
});

test('agent status off stops every source; on starts them again', async () => {
	const { supervisor, hosts, agents, bridge } = await fixture();
	hosts.publish([{ extensionId: 'com.terminay.builtin-agents', contribution }]);
	await supervisor.reconcile();
	agents.setIntegrationEnabled(false);
	await supervisor.reconcile();
	assert.equal(bridge.hasSource(sourceId), false);
	agents.setIntegrationEnabled(true);
	await supervisor.reconcile();
	assert.deepEqual(
		hosts.calls.map(([kind]) => kind),
		['start', 'stop', 'start'],
	);
});

test('a source whose extension stops is forgotten and restarts when it returns', async () => {
	const { supervisor, hosts, bridge } = await fixture();
	hosts.publish([{ extensionId: 'com.terminay.builtin-agents', contribution }]);
	await supervisor.reconcile();
	supervisor.sourceStopped({
		extensionId: 'com.terminay.builtin-agents',
		sourceId,
	});
	assert.equal(bridge.hasSource(sourceId), false);
	hosts.publish([{ extensionId: 'com.terminay.builtin-agents', contribution }]);
	await supervisor.reconcile();
	assert.deepEqual(
		hosts.calls.map(([kind]) => kind),
		['start', 'start'],
	);
});

test('settings helpers read the agent switches defensively', () => {
	assert.equal(agentIntegrationEnabledFromSettings({}), true);
	assert.equal(
		agentIntegrationEnabledFromSettings({
			agentIntegration: { enabled: false },
		}),
		false,
	);
	assert.deepEqual(
		agentHarnessSwitchesFromSettings({
			agentIntegration: { harnesses: { a: false, b: 'no' } },
		}),
		{ a: false },
	);
	assert.deepEqual(agentHarnessSwitchesFromSettings(null), {});
});
