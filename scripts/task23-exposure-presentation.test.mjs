import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop presents primary WebRTC and independent advanced direct listener without QR modes', async () => {
	const [menu, settings, app, main, preload] = await Promise.all([
		readFile('src/workspace/RemoteAccessConnectionMenu.tsx', 'utf8'),
		readFile('src/components/SettingsWindow.tsx', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('electron/preload.ts', 'utf8'),
	]);
	for (const source of [menu, settings, app]) {
		assert.doesNotMatch(
			source,
			/QR Type|Expose & show QR|WebRTC Relay QR|Local Network QR/u,
		);
	}
	assert.match(menu, /Unavailable in this build/u);
	assert.match(menu, /WebRTC exposure/u);
	assert.match(settings, /Direct network listener/u);
	assert.match(settings, /toggleDirectNetworkListener/u);
	assert.match(app, /Server\/session origin/u);
	assert.match(app, /Copy pairing link/u);
	assert.match(main, /remote:toggle-direct-listener/u);
	assert.match(preload, /toggleDirectListener/u);
});

test('primary WebRTC start cannot invoke the direct listener as a fallback', async () => {
	const main = await readFile('electron/main.ts', 'utf8');
	const primaryToggle = main.slice(
		main.indexOf("ipcMain.handle('remote:toggle-server'"),
		main.indexOf("ipcMain.handle('remote:toggle-direct-listener'"),
	);
	assert.doesNotMatch(
		primaryToggle,
		/desktopDirectNetworkExposure|embeddedLanExposure/u,
	);
});
