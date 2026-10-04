import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { setApplicationBadgeCount } from '../src/host/nativeActions.ts';

const context = {
	sourceId: 'source',
	windowId: 'window',
	profileId: 'profile',
	serverId: 'server',
};

function installHost(requestAction) {
	const requests = [];
	globalThis.window = {
		terminayHost: {
			getContext: async () => context,
			requestAction: async (request) => {
				requests.push(request);
				return requestAction?.(request);
			},
		},
	};
	return requests;
}

afterEach(() => {
	delete globalThis.window;
});

test('a browser host without the Desktop bridge reports nothing', async () => {
	globalThis.window = {};
	await assert.doesNotReject(setApplicationBadgeCount(3));
});

test('Desktop receives only this window count', async () => {
	const requests = installHost();
	await setApplicationBadgeCount(3);
	assert.deepEqual(requests, [
		{
			schemaVersion: 1,
			bridgeVersion: 1,
			...context,
			userGesture: true,
			action: { type: 'badge.count.set', count: 3 },
		},
	]);
});

test('the reported count stays inside the host bound', async () => {
	const requests = installHost();
	await setApplicationBadgeCount(-2);
	await setApplicationBadgeCount(2.9);
	await setApplicationBadgeCount(50_000);
	assert.deepEqual(
		requests.map((request) => request.action.count),
		[0, 2, 9_999],
	);
});

test('a host that rejects the action does not disturb the workspace', async () => {
	installHost(() => {
		throw new TypeError('host action is unsupported');
	});
	await assert.doesNotReject(setApplicationBadgeCount(1));
});
