import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function configureWebRtcRemoteAccess(
	page: Page,
	options: { hostedDomain: string; lanPort: number },
) {
	await page.evaluate(async ({ hostedDomain, lanPort }) => {
		const settings =
			await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings();
		await window.terminayTerminalSettingsCompatibilityHost.updateTerminalSettings(
			{
				...settings,
				remoteAccess: {
					...settings.remoteAccess,
					bindAddress: '127.0.0.1',
					origin: `https://127.0.0.1:${lanPort}`,
					pairingMode: 'webrtc',
					reconnectGrantLifetime: '24h',
					webRtcHostedDomain: hostedDomain,
				},
			},
		);
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
	}, options);
}

test('fails a hosted pairing closed when Desktop has no selected server-owned WebRTC runtime', async ({
	mainWindow,
}) => {
	const runtimeError =
		'Desktop WebRTC Relay is unavailable in this build because its authenticated hosted signaling runtime is not installed.';
	await configureWebRtcRemoteAccess(mainWindow, {
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
