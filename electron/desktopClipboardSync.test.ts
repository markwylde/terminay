import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DesktopClipboardSync,
	type ClipboardSyncSnapshot,
} from './desktopClipboardSync.ts';
const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
function setup() {
	let text: string | undefined = 'initial host ✓';
	const writes: string[] = [];
	const timers = new Set<() => void>();
	const service = new DesktopClipboardSync({
		read: async () => text,
		write: async (value) => {
			text = value;
			writes.push(value);
		},
		schedule: (callback, ms) => {
			assert.equal(ms, 500);
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
	});
	const tick = async () => {
		for (const callback of [...timers]) {
			timers.delete(callback);
			callback();
		}
		await new Promise((resolve) => setImmediate(resolve));
	};
	return {
		service,
		writes,
		timers,
		tick,
		setText: (value: string | undefined) => {
			text = value;
		},
	};
}
test('sharing seeds text, detects background copies, and suppresses both write and monitor echoes', async () => {
	const { service, setText, writes, tick, timers } = setup();
	const owner = {};
	const changes: ClipboardSyncSnapshot[] = [];
	const first = await service.start(owner, A, (s) => changes.push(s));
	assert.equal(first.text, 'initial host ✓');
	assert.equal(timers.size, 1);
	await tick();
	assert.equal(changes.length, 1);
	setText('copied in another app');
	await tick();
	assert.equal(changes.at(-1)?.text, 'copied in another app');
	const updated = await service.write(
		owner,
		A,
		changes.at(-1)!.revision,
		'from bot\r\n✓',
	);
	assert.equal(updated.text, 'from bot\n✓');
	assert.deepEqual(writes, ['from bot\n✓']);
	await tick();
	await service.write(owner, A, updated.revision, 'from bot\n✓');
	assert.equal(changes.length, 2);
	assert.equal(writes.length, 1);
	service.stop(owner, A);
	assert.equal(timers.size, 0);
	assert.equal(changes.at(-1)?.active, false);
});
test('host revision prevents a stale remote echo overwriting a newer local copy', async () => {
	const { service, setText, writes, tick } = setup();
	const owner = {};
	const first = await service.start(owner, A, () => {});
	setText('new Mac copy');
	await tick();
	const rejected = await service.write(
		owner,
		A,
		first.revision,
		'old bot echo',
	);
	assert.equal(rejected.text, 'new Mac copy');
	assert.deepEqual(writes, []);
	service.stop(owner);
});
test('one owner across windows; stale owners, tokens, and stop calls cannot change its successor', async () => {
	const { service, timers, writes } = setup();
	const old = {},
		next = {};
	const ended: ClipboardSyncSnapshot[] = [];
	await service.start(old, A, (s) => ended.push(s));
	const current = await service.start(next, B, () => {});
	assert.equal(ended.at(-1)?.active, false);
	assert.equal(timers.size, 1);
	assert.throws(() => service.write(old, A, 1, 'stale'));
	assert.throws(() => service.write(next, A, 1, 'wrong token'));
	service.stop(old, A);
	assert.equal(timers.size, 1);
	await service.write(next, B, current.revision, 'current bot');
	assert.deepEqual(writes, ['current bot']);
	service.stop(next);
});
test('an outstanding read is fenced when its document is retired', async () => {
	let finish!: (value: string) => void;
	let scheduled = 0;
	const changes: ClipboardSyncSnapshot[] = [];
	const service = new DesktopClipboardSync({
		read: () =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
		write: async () => assert.fail('retired session wrote clipboard'),
		schedule: () => {
			scheduled++;
			return () => {};
		},
	});
	const owner = {};
	const starting = service.start(owner, A, (s) => changes.push(s));
	await new Promise((resolve) => setImmediate(resolve));
	service.stop(owner);
	finish('late secret');
	assert.equal((await starting).active, false);
	assert.equal(
		changes.some((s) => s.text !== undefined),
		false,
	);
	assert.equal(scheduled, 0);
});
test('nontext and oversized host contents never expose stale text; invalid bot updates are rejected', async () => {
	const { service, setText, tick } = setup();
	const owner = {};
	const changes: ClipboardSyncSnapshot[] = [];
	await service.start(owner, A, (s) => changes.push(s));
	setText(undefined);
	await tick();
	assert.equal(changes.at(-1)?.text, undefined);
	setText('✓'.repeat(400_000));
	await tick();
	assert.equal(changes.at(-1)?.text, undefined);
	assert.equal(changes.at(-1)?.tooLarge, true);
	assert.throws(() => service.write(owner, A, -1, 'text'));
	assert.throws(() => service.write(owner, A, 1, '\u001bunsafe'));
	assert.throws(() => service.write(owner, A, 1, 'a'.repeat(1024 * 1024 + 1)));
	service.stop(owner);
	await assert.rejects(service.start(owner, 'bad', () => {}));
});
