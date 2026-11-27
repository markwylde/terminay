import assert from 'node:assert/strict';
import test from 'node:test';
import {
	attachDesktopClipboardSharing,
	type HostClipboardSnapshot as Snapshot,
} from './desktopClipboardSharing.ts';

const settle = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
	const rfb = Object.assign(new EventTarget(), {
		pastes: [] as string[],
		keys: [] as unknown[],
		clipboardPasteFrom(text: string) {
			this.pastes.push(text);
		},
		sendKey(...key: unknown[]) {
			this.keys.push(key);
		},
	});
	let receive!: (s: Snapshot) => void;
	let current: Snapshot;
	const writes: string[] = [],
		stops: string[] = [];
	const sharing = attachDesktopClipboardSharing(
		rfb,
		{
			start: async (token, changed) => {
				receive = changed;
				current = { token, revision: 1, active: true, text: 'Mac initial' };
				return current;
			},
			stop: async (token) => {
				stops.push(token);
			},
			write: async (_token, revision, text) => {
				writes.push(text);
				if (revision !== current.revision) return current;
				current = { ...current, text, revision: revision + 1 };
				return current;
			},
			dispose: () => {},
		},
		{ onState: () => {}, onTooLarge: () => {} },
	);
	return {
		rfb,
		sharing,
		writes,
		stops,
		update: (text: string) => {
			current = { ...current, revision: current.revision + 1, text };
			receive(current);
		},
		remote: (text: string) =>
			rfb.dispatchEvent(new CustomEvent('clipboard', { detail: { text } })),
		ended: () => receive({ ...current, active: false }),
	};
}
test('continuous sync uploads initial and background text with no synthesized key', async () => {
	const { sharing, rfb, update, remote, writes } = setup();
	sharing.claim();
	remote('old remote baseline');
	await settle();
	assert.deepEqual(rfb.pastes, ['Mac initial']);
	assert.deepEqual(writes, []);
	update('host copy ✓');
	assert.deepEqual(rfb.pastes, ['Mac initial', 'host copy ✓']);
	assert.deepEqual(rfb.keys, []);
	remote('bot copy\r\n✓');
	await settle();
	assert.deepEqual(writes, ['bot copy\n✓']);
	remote('bot copy\n✓');
	await settle();
	assert.equal(writes.length, 1);
	assert.equal(rfb.pastes.length, 2);
	sharing.dispose();
});
test('retired sharing cannot write or upload late callbacks and resumes only on selection', async () => {
	const { sharing, rfb, update, remote, writes, ended } = setup();
	sharing.claim();
	await settle();
	ended();
	update('late host change');
	remote('late bot change');
	await settle();
	assert.equal(sharing.active(), false);
	assert.deepEqual(rfb.pastes, ['Mac initial']);
	assert.deepEqual(writes, []);
	sharing.claim();
	await settle();
	assert.equal(sharing.active(), true);
	sharing.dispose();
	update('after disposal');
	remote('after disposal');
	await settle();
	assert.equal(rfb.pastes.length, 2);
	assert.deepEqual(writes, []);
});
