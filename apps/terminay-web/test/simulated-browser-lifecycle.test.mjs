import assert from 'node:assert/strict';
import test from 'node:test';
import {
	SimulatedBrowserLifecycleHarness,
	WebConnectionHost,
} from '../dist/index.js';

function fixture(reconnect = async () => true) {
	const host = new WebConnectionHost({ storage: undefined });
	const profile = host.addConnection({
		id: 'simulated-browser',
		label: 'Simulated browser',
		origin: 'https://server.example.test',
		serverId: 'server-simulated',
		status: 'connected',
	});
	return {
		harness: new SimulatedBrowserLifecycleHarness(host, profile.id, reconnect),
		host,
		profile,
	};
}

test('simulated page freeze plus network interruption reconnects after resume', async () => {
	const { harness, host, profile } = fixture();
	harness.suspend('freeze');
	harness.setNetworkOnline(false);
	assert.equal(harness.isSuspended, true);
	assert.equal(host.profiles.get(profile.id)?.status, 'offline');

	harness.setNetworkOnline(true);
	assert.equal((await harness.resume()).status, 'connected');
	assert.deepEqual(
		harness.evidence.map(({ kind }) => kind),
		['freeze', 'network-offline', 'network-online', 'resume', 'reconnected'],
	);
});

for (const event of ['pagehide', 'visibility-hidden']) {
	test(`simulated ${event} resumes through the reconnect path`, async () => {
		const { harness } = fixture();
		harness.suspend(event);
		assert.equal((await harness.resume()).status, 'connected');
	});
}

test('simulated reconnect failure remains retryable', async () => {
	const { harness } = fixture(async () => false);
	harness.suspend('pagehide');
	assert.equal((await harness.resume()).status, 'unreachable');
	assert.equal(harness.evidence.at(-1)?.kind, 'reconnect-failed');
});

test('simulated revocation while backgrounded prevents reconnect on resume', async () => {
	let reconnectCalls = 0;
	const { harness } = fixture(async () => {
		reconnectCalls += 1;
		return true;
	});
	harness.suspend('visibility-hidden');
	harness.revoke();
	assert.equal((await harness.resume()).status, 'revoked');
	assert.equal(reconnectCalls, 0);
});
