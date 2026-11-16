import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopClipboardSharing } from './nativeActions.ts';

test('disposing during capability negotiation cannot start a session or leak a subscription', async () => {
	let resolve!: (value: unknown) => void;
	let calls = 0;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: {
			terminayHost: {
				getContext: () =>
					new Promise((done) => {
						resolve = done;
					}),
				startClipboardSync: async () => {
					calls++;
				},
				stopClipboardSync: async () => {},
				writeClipboardSync: async () => {},
				subscribeClipboardSync: () => {
					calls++;
					return () => {};
				},
			},
		},
	});
	try {
		const route = desktopClipboardSharing()!;
		const opening = route.start('negotiating_clipboard_session', () => {});
		route.dispose();
		resolve({ capabilities: { clipboardSync: 1 } });
		assert.equal(await opening, undefined);
		assert.equal(calls, 0);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
