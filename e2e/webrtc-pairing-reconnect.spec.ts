import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function configureWebRtcRemoteAccess(
	appHarness: { openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page> },
	page: Page,
	options: { hostedDomain: string; lanPort: number },
) {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'remote-access-host' });
	const rows = settings.locator('#section-remote-access-host .settings-row');
	await settings.getByLabel('Pairing mode').selectOption('webrtc');
	await rows.filter({ hasText: 'Bind address' }).locator('input').fill('127.0.0.1');
	await rows.filter({ hasText: 'Remote origin' }).locator('input').fill(`https://127.0.0.1:${options.lanPort}`);
	await rows.filter({ hasText: 'Saved reconnect lifetime' }).locator('select').selectOption('24h');
	await rows.filter({ hasText: 'WebRTC hosted domain' }).locator('input').fill(options.hostedDomain);
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
	await page.evaluate(async () => {
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
	});
}

test('fails a hosted pairing closed when Desktop has no selected server-owned WebRTC runtime', async ({
	appHarness,
	mainWindow,
}) => {
	const runtimeError =
		'Desktop WebRTC Relay is unavailable in this build because its authenticated hosted signaling runtime is not installed.';
	await configureWebRtcRemoteAccess(appHarness, mainWindow, {
		hostedDomain: 'http://localhost:9',
		lanPort: 9,
	});
	const toggleError = await mainWindow.evaluate(async () => {
		try {
			await window.terminayRemoteAccessStatusHost.toggleServer();
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	});
	expect(toggleError).toContain(runtimeError);
	const status = await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.getStatus(),
	);
	expect(status).toMatchObject({
		errorMessage: runtimeError,
		isRunning: false,
		pairingUrl: null,
		webRtcPairingUrl: null,
		webRtcRoomId: null,
		webRtcStatus: 'error',
		webRtcStatusMessage: runtimeError,
	});
});
