/**
 * The relay against a real display server, reached as the server desktop
 * reaches it: an owner-only unix socket, one upstream connection per stream,
 * the credential for the stream's mode. Assertions read the display itself.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import {
	DESKTOP_RESIZE_LIMITS,
	DesktopInputGate,
	openDesktopStream,
	unixSocketConnector,
} from '../../dist/server/index.js';
import {
	displayServerVersion,
	realDisplayUnavailable,
	startDisplay,
} from '../support/display.mjs';
import { ENCODING, settle, Viewer } from '../support/viewer.mjs';

const skip = realDisplayUnavailable();
const limits = { inputBytes: 4 * 1024 * 1024, clipboardBytes: 1024 * 1024 };
const SHIFT = 0xffe1;

async function desktop(t) {
	const display = await startDisplay();
	t.after(() => display.stop());
	t.diagnostic(`TigerVNC ${displayServerVersion()}`);
	const gate = new DesktopInputGate();
	const upstreams = [];
	const base = unixSocketConnector(display.socket);
	// The same connector, remembering each connection so a test can break one.
	const connector = {
		open: async () => {
			const upstream = await base.open();
			upstreams.push(upstream);
			return upstream;
		},
	};
	const open = async (mode, extra = {}) => {
		const controller = new AbortController();
		const relay = await openDesktopStream({
			connector,
			mode,
			authority: { signal: controller.signal, assert: () => {} },
			withPassword: (as, callback) =>
				callback(
					as === 'control' ? display.passwords.full : display.passwords.viewOnly,
				),
			limits,
			gate,
			...extra,
		});
		const viewer = await new Viewer(relay).connect();
		return { relay, viewer, controller };
	};
	return { display, gate, open, upstreams };
}

/** Press Shift and the left button through a control stream. */
async function hold(display, viewer) {
	await viewer.pointer(400, 300, 0);
	await viewer.key(SHIFT, true);
	await viewer.pointer(400, 300, 1);
	await settle(400);
	const held = await display.held();
	assert.equal(held.length, 2, `both are down on the display: ${held}`);
}

test('a control stream that ends normally leaves no key or button down before later input', { skip }, async (t) => {
	const { display, gate, open } = await desktop(t);
	const first = await open('control');
	await hold(display, first.viewer);

	const closed = once(first.relay, 'close');
	first.relay.destroy();
	await closed;
	// The next controller is admitted only once release has finished.
	const second = await open('control');
	assert.deepEqual(await display.held(), []);
	await gate.settled();

	// Later input lands on a clean desktop: a plain move, nothing dragged.
	await second.viewer.pointer(500, 350, 0);
	await settle(300);
	assert.deepEqual(await display.pointer(), { x: 500, y: 350 });
	assert.deepEqual(await display.held(), []);
});

test('a control stream cut off by an upstream failure mid-write leaves no key or button down', { skip }, async (t) => {
	const { display, gate, open, upstreams } = await desktop(t);
	const first = await open('control');
	await hold(display, first.viewer);

	// Break the upstream connection while input is still being written.
	const closed = once(first.relay, 'close');
	const writing = first.viewer.pointer(410, 310, 1).catch(() => undefined);
	upstreams[0].source.destroy(new Error('upstream lost'));
	await closed;
	await writing;
	await gate.settled();
	await settle(200);
	assert.deepEqual(await display.held(), []);

	const second = await open('control');
	await second.viewer.pointer(520, 360, 0);
	await settle(300);
	assert.deepEqual(await display.pointer(), { x: 520, y: 360 });
	assert.deepEqual(await display.held(), []);
});

test('a view-only stream reaches the display with the view-only credential: no input, no resize, no clipboard', { skip }, async (t) => {
	const { display, open } = await desktop(t);
	const control = await open('control');
	await control.viewer.pointer(50, 60, 0);
	await settle(300);
	assert.deepEqual(await display.pointer(), { x: 50, y: 60 });

	const viewOnly = await open('view-only');
	await viewOnly.viewer.setEncodings([
		ENCODING.raw,
		ENCODING.extendedClipboard,
		ENCODING.extendedDesktopSize,
	]);
	await viewOnly.viewer.pointer(111, 222, 1);
	await viewOnly.viewer.key(SHIFT, true);
	await settle(300);
	assert.deepEqual(await display.pointer(), { x: 50, y: 60 });
	assert.deepEqual(await display.held(), []);

	await display.setClipboard('desktop-secret');
	await settle(1200);
	assert.equal(viewOnly.viewer.raw.length, 0, 'no clipboard bytes of either form');
	assert.equal(await display.size(), '1280x800');
});

test('each stream has its own upstream connection, closed when the stream ends', { skip }, async (t) => {
	const { open, upstreams } = await desktop(t);
	const a = await open('view-only');
	const b = await open('control');
	assert.equal(upstreams.length, 2);
	assert.notEqual(upstreams[0].source, upstreams[1].source);
	const closed = once(a.relay, 'close');
	a.relay.destroy();
	await closed;
	await settle(200);
	assert.equal(upstreams[0].source.destroyed, true);
	assert.equal(upstreams[1].source.destroyed, false);
	b.relay.destroy();
});

test('with resize admitted, a control stream resizes the real screen: in range, clamped, last of a burst, and one screen only', { skip }, async (t) => {
	const { display, open } = await desktop(t);
	const resizing = { resize: DESKTOP_RESIZE_LIMITS };
	const control = await open('control', resizing);
	await control.viewer.setEncodings([ENCODING.raw, ENCODING.extendedDesktopSize]);
	await settle(300);

	await control.viewer.resize(1600, 900);
	await settle(700);
	assert.equal(await display.size(), '1600x900');

	await control.viewer.resize(10000, 9000);
	await settle(900);
	assert.equal(await display.size(), '3840x2160');

	for (let i = 0; i < 30; i++) await control.viewer.resize(1000 + i, 700 + i);
	await settle(1200);
	assert.equal(await display.size(), '1029x729');

	// A view-only stream of the same desktop changes nothing.
	const viewOnly = await open('view-only', resizing);
	await viewOnly.viewer.setEncodings([ENCODING.raw, ENCODING.extendedDesktopSize]);
	await viewOnly.viewer.resize(800, 600);
	await settle(600);
	assert.equal(await display.size(), '1029x729');

	const closed = once(control.relay, 'close');
	await control.viewer.resize(1280, 800, 2).catch(() => undefined);
	await closed;
	assert.equal(await display.size(), '1029x729');
});

test('without resize admitted, a resize request closes the stream and the screen keeps its size', { skip }, async (t) => {
	const { display, open } = await desktop(t);
	const control = await open('control');
	const closed = once(control.relay, 'close');
	await control.viewer.resize(1600, 900).catch(() => undefined);
	await closed;
	assert.equal(await display.size(), '1280x800');
});
