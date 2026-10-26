import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalAuxiliaryRequest } from '../electron/auxiliaryRouteAllowList.ts';

const present = (kind, extra = '') => ({
	disposition: 'native-window',
	logicalViewId: kind,
	route: `/?auxiliary=${kind}${extra}`,
});

test('Settings opens at a category and item', () => {
	assert.deepEqual(
		canonicalAuxiliaryRequest(present('settings', '&section=macros&item=m1')),
		{ logicalViewId: 'settings', route: '/?auxiliary=settings&section=macros&item=m1', title: 'Settings' },
	);
});

test('Performance Log is still a window', () => {
	assert.equal(canonicalAuxiliaryRequest(present('performance-log')).title, 'Performance Log');
});

for (const kind of ['macros', 'recordings', 'remote-control', 'extensions', 'toString', '__proto__']) {
	test(`a request for ${kind} is refused`, () => {
		assert.throws(() => canonicalAuxiliaryRequest(present(kind)), /unavailable/);
	});
}

test('a request without a native-window identity is refused', () => {
	assert.throws(() => canonicalAuxiliaryRequest({ route: '/?auxiliary=settings' }), /logical native-window/);
});
