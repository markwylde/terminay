import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createProfileConnectQueue,
	DesktopWindowIds,
} from '../electron/remote/desktopWindowIdentity.ts';

test('a native window keeps one window id for its life, and no two windows share one', () => {
	const ids = new DesktopWindowIds();
	const first = ids.for(11);
	// A reload or a reconnect of the same window presents the same id.
	assert.equal(ids.for(11), first);
	assert.notEqual(ids.for(12), first);
	// What a server accepts as a window id: a bounded identifier.
	assert.match(first, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u);

	// A window that is connected before it exists adopts the id it used.
	const minted = ids.mint();
	ids.adopt(13, minted);
	assert.equal(ids.for(13), minted);

	// A closed window's id is not handed to whatever reuses its number.
	ids.release(11);
	assert.notEqual(ids.for(11), first);
});

test('connections to one server open one at a time, and a failure does not hold up the next', async () => {
	const queue = createProfileConnectQueue();
	const events = [];
	const attempt = (name, { fail = false, ms = 20 } = {}) =>
		async () => {
			events.push(`start:${name}`);
			await new Promise((resolve) => setTimeout(resolve, ms));
			events.push(`end:${name}`);
			if (fail) throw new Error(`${name} failed`);
			return name;
		};
	const first = queue.run('remote:a', attempt('main', { fail: true }));
	const second = queue.run('remote:a', attempt('settings'));
	// Another server does not wait behind them.
	const other = queue.run('remote:b', attempt('other', { ms: 1 }));

	await assert.rejects(first, /main failed/u);
	assert.equal(await second, 'settings');
	assert.equal(await other, 'other');
	const order = events.filter((event) => !event.endsWith(':other'));
	assert.deepEqual(order, [
		'start:main',
		'end:main',
		'start:settings',
		'end:settings',
	]);
	assert.ok(
		events.indexOf('end:other') < events.indexOf('end:main'),
		'a different server ran alongside',
	);
});
