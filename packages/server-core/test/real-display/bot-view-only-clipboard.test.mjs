/**
 * What a bot view-only desktop stream is sent when the bot's clipboard
 * changes, read from the stream's raw bytes against a real display server.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	displayServerVersion,
	realDisplayUnavailable,
	startDisplay,
} from '../../../remote-desktop/test/support/display.mjs';
import {
	ENCODING,
	settle,
	Viewer,
} from '../../../remote-desktop/test/support/viewer.mjs';
import { authority, botDesktop, botId } from './support.mjs';

// Bot desktops run the bot image's display server, TigerVNC 1.15. The
// service's PRIMARY check reads that version's `vncconfig` output, so on an
// older display server there is no bot behaviour to test.
const skip =
	realDisplayUnavailable() ??
	(displayServerVersion().startsWith('1.12')
		? 'bot desktops run TigerVNC 1.15'
		: undefined);
const port = 5940 + (process.pid % 40);

async function open(service, mode, encodings) {
	const relay = await service.open(authority(), botId, 1, mode);
	const viewer = await new Viewer(relay).connect();
	await viewer.setEncodings(encodings);
	return viewer;
}

test('a bot view-only stream carries no clipboard message, legacy or extended, while the bot clipboard changes', { skip }, async (t) => {
	// As the bot image starts it: loopback TCP, one password file holding the
	// full and the view-only password.
	const display = await startDisplay({
		listen: { tcp: port },
		passwords: ['fullpass', 'viewpass'],
	});
	t.after(() => display.stop());
	const { service } = botDesktop(display, port, (mode) =>
		mode === 'control' ? 'fullpass' : 'viewpass',
	);
	t.after(() => service.close());
	t.diagnostic(`TigerVNC ${displayServerVersion()}`);

	const viewLegacy = await open(service, 'view-only', [ENCODING.raw]);
	const viewExtended = await open(service, 'view-only', [
		ENCODING.raw,
		ENCODING.extendedClipboard,
	]);
	const controlLegacy = await open(service, 'control', [ENCODING.raw]);
	const controlExtended = await open(service, 'control', [
		ENCODING.raw,
		ENCODING.extendedClipboard,
	]);
	await settle(500);
	await display.setClipboard('bot-secret');
	await settle(1500);
	// An explicit request is what a viewer that wanted the text would send.
	await viewExtended.requestClipboard();
	await controlExtended.requestClipboard();
	await settle(1000);

	const seen = {
		viewLegacy: viewLegacy.messages(),
		viewExtended: viewExtended.messages(),
		controlLegacy: controlLegacy.messages(),
		controlExtended: controlExtended.messages(),
	};
	t.diagnostic(JSON.stringify(seen));

	// The control streams prove the change reached the display server and
	// that this test would see a clipboard message if one were sent.
	assert.ok(
		seen.controlLegacy.some(
			(m) => m.form === 'legacy' && m.text === 'bot-secret',
		),
		'control stream receives the legacy clipboard',
	);
	assert.ok(
		seen.controlExtended.some(
			(m) => m.form === 'extended' && m.actions.includes('provide'),
		),
		'control stream receives the extended clipboard',
	);
	assert.deepEqual(seen.viewLegacy, []);
	assert.deepEqual(seen.viewExtended, []);
	assert.equal(viewLegacy.raw.length, 0);
	assert.equal(viewExtended.raw.length, 0);
});
