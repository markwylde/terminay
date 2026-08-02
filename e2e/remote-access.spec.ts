import type { Page } from '@playwright/test';
import { createServer } from 'node:net';
import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

function remoteOriginInput(page: Page) {
	return page
		.locator('#section-remote-access-host .settings-row')
		.filter({ hasText: 'Remote origin' })
		.locator('input');
}

async function reserveLoopbackPort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (address === null || typeof address === 'string')
		throw new Error('Unable to reserve a loopback port.');
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function configureWebRtcHostedDomain(
	page: Page,
	hostedDomain: string,
): Promise<void> {
	await page.evaluate(async (nextHostedDomain) => {
		const settings =
			await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings();
		await window.terminayTerminalSettingsCompatibilityHost.updateTerminalSettings(
			{
				...settings,
				remoteAccess: {
					...settings.remoteAccess,
					pairingMode: 'webrtc',
					webRtcHostedDomain: nextHostedDomain,
				},
			},
		);
	}, hostedDomain);
}

test('opens remote access settings from the host menu', async ({
	appHarness,
	mainWindow,
}) => {
	expect(await mainWindow.evaluate(() => 'terminayWebRtcHost' in window)).toBe(
		false,
	);
	await openRemoteMenu(mainWindow);

	const settingsWindow = await appHarness.openChildWindow(async () => {
		await mainWindow
			.getByRole('button', { name: 'Remote Access Settings' })
			.click();
	});

	await expect(
		settingsWindow.getByRole('heading', { name: 'Settings' }),
	).toBeVisible();
	await expect(
		settingsWindow.getByRole('heading', { name: 'Host & Origin' }),
	).toBeVisible();
	await expect(remoteOriginInput(settingsWindow)).toHaveValue(
		'https://localhost:9443',
	);
});

test('starts remote access from the host menu and shows a pairing qr modal', async ({
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(mainWindow, 'http://localhost:9');
	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^(?:Expose & show QR|Show Pairing QR)/ })
		.click();

	const pinDialog = mainWindow.getByRole('dialog', {
		name: 'Remote Pairing PIN',
	});
	await expect(pinDialog).toBeVisible();
	await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456');
	await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
	await expect(pinDialog).toHaveCount(0);
	await expect(mainWindow.getByLabel('Open connection menu')).toContainText(
		'Local',
	);

	const pairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' });
	await expect(pairingDialog).toBeVisible();
	await expect(
		pairingDialog.getByRole('heading', { name: 'Pair Device' }),
	).toBeVisible();
	await expect(
		pairingDialog.getByAltText('Remote pairing QR code'),
	).toBeVisible();
	await expect(
		pairingDialog.getByText(
			'Scan this QR code to add or re-add a browser to this Terminay host.',
		),
	).toBeVisible();
	await expect(
		pairingDialog.getByText(
			/Saved WebRTC sessions can reconnect later while their grant is valid\./,
		),
	).toBeVisible();
	await expect(
		pairingDialog.getByRole('button', { name: 'Local Network' }),
	).toBeVisible();
	await expect(
		pairingDialog.getByRole('button', { name: 'WebRTC Relay' }),
	).toBeVisible();
	await expect(
		pairingDialog.getByRole('button', { name: 'Copy Link' }),
	).toBeVisible();

	await pairingDialog
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await expect(pairingDialog).toHaveCount(0);

	await openRemoteMenu(mainWindow);
	await expect(
		mainWindow.getByRole('button', { name: 'Show Pairing QR' }),
	).toBeVisible();
	await expect(
		mainWindow.getByRole('button', { name: /^Stop exposing this server/ }),
	).toBeVisible();
	await mainWindow
		.getByRole('button', { name: /^Stop exposing this server/ })
		.click();
	await openRemoteMenu(mainWindow);
	await expect(
		mainWindow
			.locator('.remote-access-menu__item')
			.filter({ hasText: 'Expose this server' })
			.first(),
	).toBeVisible();
});

test('asks for a Remote Access PIN before generating the QR code', async ({
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(mainWindow, 'http://localhost:9');
	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^(?:Expose & show QR|Show Pairing QR)/ })
		.click();

	const pinDialog = mainWindow.getByRole('dialog', {
		name: 'Remote Pairing PIN',
	});
	await expect(pinDialog).toBeVisible();
	await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456');
	await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
	await expect(pinDialog).toHaveCount(0);

	const pairingDialog = mainWindow.getByRole('dialog', { name: 'Pair device' });
	await expect(pairingDialog).toBeVisible();
	await expect(
		pairingDialog.getByAltText('Remote pairing QR code'),
	).toBeVisible();
	const pairingDialogMetrics = await pairingDialog.evaluate((dialog) => {
		const rect = dialog.getBoundingClientRect();
		const copyButton = dialog.querySelector('.remote-pairing-modal__copy-btn');
		const copyButtonRect = copyButton?.getBoundingClientRect();
		const closeButton = dialog.querySelector('button.project-edit-modal-close');
		const closeButtonRect = closeButton?.getBoundingClientRect();
		const toggle = dialog.querySelector('.remote-pairing-modal__toggle');
		const toggleRect = toggle?.getBoundingClientRect();
		const style = window.getComputedStyle(dialog);

		return {
			bottom: rect.bottom,
			closeButtonBottom: closeButtonRect?.bottom ?? 0,
			closeButtonRight: closeButtonRect?.right ?? 0,
			copyButtonRight: copyButtonRect?.right ?? 0,
			overflowY: style.overflowY,
			right: rect.right,
			toggleRight: toggleRect?.right ?? 0,
			viewportHeight: window.innerHeight,
		};
	});

	expect(pairingDialogMetrics.overflowY).toBe('auto');
	expect(pairingDialogMetrics.bottom).toBeLessThanOrEqual(
		pairingDialogMetrics.viewportHeight,
	);
	expect(pairingDialogMetrics.closeButtonBottom).toBeLessThanOrEqual(
		pairingDialogMetrics.viewportHeight,
	);
	expect(pairingDialogMetrics.closeButtonRight).toBeLessThanOrEqual(
		pairingDialogMetrics.right,
	);
	expect(pairingDialogMetrics.copyButtonRight).toBeLessThanOrEqual(
		pairingDialogMetrics.right,
	);
	expect(pairingDialogMetrics.toggleRight).toBeLessThanOrEqual(
		pairingDialogMetrics.right,
	);

	const settings = await mainWindow.evaluate(() =>
		window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings(),
	);
	expect(settings.remoteAccess.pairingPinHash).toMatch(/^scrypt-v1:/);
	expect(settings.remoteAccess.pairingPinHash).not.toContain('123456');

	await pairingDialog
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await expect(pairingDialog).toHaveCount(0);

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^Stop exposing this server/ })
		.click();

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^(?:Expose & show QR|Show Pairing QR)/ })
		.click();
	const secondPairingDialog = mainWindow.getByRole('dialog', {
		name: 'Pair device',
	});
	await expect(secondPairingDialog).toBeVisible();
	await expect(
		mainWindow.getByRole('dialog', { name: 'Remote Pairing PIN' }),
	).toHaveCount(0);

	await secondPairingDialog
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^Stop exposing this server/ })
		.click();
});

test('a copied direct pairing link boots the server UI, enrolls, and connects', async ({
	mainWindow,
	page,
}) => {
	const port = await reserveLoopbackPort();
	const pairingUrl = await mainWindow.evaluate(async (selectedPort) => {
		const settings =
			await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings();
		await window.terminayTerminalSettingsCompatibilityHost.updateTerminalSettings(
			{
				...settings,
				remoteAccess: {
					...settings.remoteAccess,
					bindAddress: '127.0.0.1',
					origin: `http://localhost:${selectedPort}`,
					pairingMode: 'lan',
				},
			},
		);
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
		const status = await window.terminayRemoteAccessStatusHost.toggleServer();
		if (!status.lanPairingUrl)
			throw new Error('Direct exposure did not publish a pairing URL.');
		return status.lanPairingUrl;
	}, port);

	expect(pairingUrl).toContain('pairingFlow=device');
	const previousClipboard = await mainWindow.evaluate(() =>
		window.terminayClipboardHost?.readText(),
	);
	try {
		await openRemoteMenu(mainWindow);
		await mainWindow
			.getByRole('button', { name: 'Show Pairing QR' })
			.click();
		const pairingDialog = mainWindow.getByRole('dialog', {
			name: 'Pair device',
		});
		await expect(
			pairingDialog.locator('.remote-pairing-modal__address-text'),
		).toHaveText(pairingUrl);
		await pairingDialog.getByRole('button', { name: 'Copy Link' }).click();
		await expect
			.poll(() =>
				mainWindow.evaluate(() => window.terminayClipboardHost?.readText()),
			)
			.toBe(pairingUrl);
		await pairingDialog
			.getByRole('button', { name: 'Close Pair Device' })
			.click();
	} finally {
		if (previousClipboard !== undefined)
			await mainWindow.evaluate(
				(value) => window.terminayClipboardHost?.writeText(value),
				previousClipboard,
			);
	}
	await page.goto(pairingUrl);
	await expect(
		page.getByRole('dialog', { name: 'Enroll browser device' }),
	).toBeVisible();
	expect(page.url()).not.toContain('#');
	await page.getByLabel('Device name').fill('Direct browser');
	await page.getByLabel('Pairing PIN').fill('123456');
	await page.getByRole('button', { name: 'Pair and connect' }).click();
	await expect(page.locator('.connected-web-renderer-workspace')).toBeVisible({
		timeout: 20_000,
	});
});

test('starts WebRTC remote access from the host menu start button', async ({
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(mainWindow, 'http://localhost:9');

	await openRemoteMenu(mainWindow);
	await mainWindow.getByRole('button', { name: 'WebRTC Relay' }).click();
	await mainWindow
		.locator('.remote-access-menu__item')
		.filter({ hasText: /^Expose this server…Ready$/ })
		.click();

	try {
		const pinDialog = mainWindow.getByRole('dialog', {
			name: 'Remote Pairing PIN',
		});
		await expect(pinDialog).toBeVisible();
		await pinDialog
			.getByRole('textbox', { name: 'Pairing PIN' })
			.fill('123456');
		await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
		await expect(pinDialog).toHaveCount(0);

		await expect
			.poll(async () => {
				const status = await mainWindow.evaluate(() =>
					window.terminayRemoteAccessStatusHost.getStatus(),
				);
				return (
					status.isRunning &&
					status.pairingMode === 'webrtc' &&
					Boolean(status.webRtcPairingUrl)
				);
			})
			.toBe(true);

		const status = await mainWindow.evaluate(() =>
			window.terminayRemoteAccessStatusHost.getStatus(),
		);
		expect(status.pairingMode).toBe('webrtc');
		const webRtcPairingUrl = new URL(status.webRtcPairingUrl!);
		expect(webRtcPairingUrl.protocol).toBe('http:');
		expect(webRtcPairingUrl.hostname).toMatch(/^[a-f0-9]{32}\.localhost$/);
		expect(webRtcPairingUrl.port).toBe('9');
		expect(webRtcPairingUrl.pathname).toBe('/v1/');
		expect(webRtcPairingUrl.hash.length).toBeGreaterThan(20);
		expect(webRtcPairingUrl.searchParams.has('relayJoinToken')).toBe(false);
		expect(webRtcPairingUrl.searchParams.has('pairingToken')).toBe(false);
		expect(webRtcPairingUrl.searchParams.has('signalingAuthToken')).toBe(false);

		await openRemoteMenu(mainWindow);
		await expect(
			mainWindow
				.locator('.remote-access-menu__item')
				.filter({ hasText: /^Stop exposing this serverExposed$/ }),
		).toBeVisible();
		await expect(
			mainWindow.getByText(
				'Start remote access to generate a relay pairing link.',
			),
		).toHaveCount(0);
	} finally {
		await mainWindow.evaluate(async () => {
			const status = await window.terminayRemoteAccessStatusHost.getStatus();
			if (status.isRunning) {
				await window.terminayRemoteAccessStatusHost.toggleServer();
			}
		});
	}
});

test('keeps the configured PIN out of the server-owned LAN handoff', async ({
	mainWindow,
}) => {
	await mainWindow.evaluate(() =>
		window.terminayRemotePairingPinHost.setRemoteAccessPairingPin('654321'),
	);

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^(?:Expose & show QR|Show Pairing QR)/ })
		.click();

	await expect
		.poll(async () => {
			const status = await mainWindow.evaluate(() =>
				window.terminayRemoteAccessStatusHost.getStatus(),
			);
			return status.lanPairingUrl;
		})
		.toBeTruthy();

	const status = await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.getStatus(),
	);
	const pairingUrl = new URL(status.lanPairingUrl!);
	expect(pairingUrl.search).toBe('');
	const pairingBootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
	expect(pairingBootstrap.get('pairingSessionId')).toMatch(/^pair-/);
	expect(pairingBootstrap.get('pairingToken')).toMatch(/^[A-Za-z0-9_-]{32,}$/);
	expect(pairingBootstrap.get('pairingExpiresAt')).toBeTruthy();
	expect(pairingUrl.hash).not.toContain('654321');
	const settings = await mainWindow.evaluate(() =>
		window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings(),
	);
	expect(settings.remoteAccess.pairingPinHash).toMatch(/^scrypt-v1:/);
	expect(settings.remoteAccess.pairingPinHash).not.toContain('654321');

	await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.toggleServer(),
	);
});

test('rotates and stops server-owned LAN pairing without a legacy renderer API', async ({
	mainWindow,
}) => {
	await mainWindow.evaluate(() =>
		window.terminayRemotePairingPinHost.setRemoteAccessPairingPin('123456'),
	);

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^(?:Expose & show QR|Show Pairing QR)/ })
		.click();

	await expect
		.poll(async () => {
			const status = await mainWindow.evaluate(() =>
				window.terminayRemoteAccessStatusHost.getStatus(),
			);
			return status.lanPairingUrl;
		})
		.toBeTruthy();

	const first = await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.getStatus(),
	);
	expect(first.lanPairingUrl).toBeTruthy();
	await mainWindow
		.getByRole('dialog', { name: 'Pair device' })
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await mainWindow.evaluate(async () => {
		await window.terminayRemoteAccessStatusHost.toggleServer();
		await window.terminayRemoteAccessStatusHost.toggleServer();
	});
	const rotated = await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.getStatus(),
	);
	expect(rotated.lanPairingUrl).toBeTruthy();
	expect(rotated.lanPairingUrl).not.toBe(first.lanPairingUrl);

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^Stop exposing this server/ })
		.click();
	await expect
		.poll(
			async () =>
				(
					await mainWindow.evaluate(() =>
						window.terminayRemoteAccessStatusHost.getStatus(),
					)
				).isRunning,
		)
		.toBe(false);
});

test('manages remote access from the settings window host section', async ({
	appHarness,
	mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'remote-access-host',
	});

	await expect(
		settingsWindow.getByText('Remote Access: Stopped'),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('Terminay will use your Remote Access settings'),
	).toBeVisible();

	await settingsWindow
		.getByRole('button', { name: 'Start Remote Access' })
		.click();
	const pinDialog = settingsWindow.getByRole('dialog', {
		name: 'Remote Pairing PIN',
	});
	await expect(pinDialog).toBeVisible();
	await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456');
	await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
	await expect(pinDialog).toHaveCount(0);
	await expect(
		settingsWindow.getByRole('button', { name: 'Stop Remote Access' }),
	).toBeVisible();

	await expect(
		settingsWindow.getByText('Trusted Browsers', { exact: true }),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('Reconnects', { exact: true }),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('Cleanup', { exact: true }),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('No trusted browsers found.'),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('No active remote connections.'),
	).toBeVisible();
	await expect(
		settingsWindow.getByText('No recent activity logged.'),
	).toBeVisible();

	await settingsWindow.getByRole('button', { name: 'Local Network' }).click();
	await settingsWindow.getByRole('button', { name: 'Show QR Code' }).click();
	await expect(
		settingsWindow.getByRole('dialog', { name: 'Local Network QR' }),
	).toBeVisible();
	await expect(
		settingsWindow.getByAltText('Remote pairing QR code'),
	).toBeVisible();
	await settingsWindow
		.getByRole('button', { name: 'Close Remote Pairing QR' })
		.click();

	await settingsWindow
		.getByRole('button', { name: 'Stop Remote Access' })
		.click();
	await expect(
		settingsWindow.getByRole('button', { name: 'Start Remote Access' }),
	).toBeVisible();
});
