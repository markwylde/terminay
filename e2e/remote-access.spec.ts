import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

function remoteOriginInput(page: Page) {
	return page
		.locator('#section-remote-access-host .settings-row')
		.filter({ hasText: 'Remote origin' })
		.locator('input');
}

async function configureWebRtcHostedDomain(
	appHarness: {
		openSettingsWindow: (options: {
			page: Page;
			sectionId: string;
		}) => Promise<Page>;
	},
	page: Page,
	hostedDomain: string,
): Promise<void> {
	const settings = await appHarness.openSettingsWindow({
		page,
		sectionId: 'remote-access-host',
	});
	await settings.getByLabel('Exposure route').selectOption('webrtc');
	await settings.locator('#section-remote-access-host .settings-row').filter({ hasText: 'WebRTC hosted domain' }).locator('input').fill(hostedDomain);
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
}

async function exposeWebRtcAndOpenPairing(page: Page): Promise<void> {
	await openRemoteMenu(page);
	await page.getByRole('button', { name: 'Expose this server…' }).click();

	const pinDialog = page.getByRole('dialog', { name: 'Remote Pairing PIN' });
	await expect(pinDialog).toBeVisible();
	await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill('123456');
	await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
	await expect(pinDialog).toHaveCount(0);

	await openRemoteMenu(page);
	const showPairing = page.getByRole('button', {
		name: 'Show pairing link and QR',
	});
	// The connection menu is driven by the selected Terminay Server's
	// remote-access subscription. Its exposed action is the user-visible proof
	// that the server has started and published a pairing URL.
	await expect(showPairing).toBeVisible();
	await showPairing.click();
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

test('exposes the server, then shows its pairing QR from the host menu', async ({
	appHarness,
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(appHarness, mainWindow, 'http://localhost:9');
	await exposeWebRtcAndOpenPairing(mainWindow);
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
		pairingDialog.getByRole('button', { name: 'Copy pairing link' }),
	).toBeVisible();

	await pairingDialog
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await expect(pairingDialog).toHaveCount(0);

	await openRemoteMenu(mainWindow);
	await expect(
		mainWindow.getByRole('button', { name: 'Show pairing link and QR' }),
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
	appHarness,
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(appHarness, mainWindow, 'http://localhost:9');
	await exposeWebRtcAndOpenPairing(mainWindow);

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
		const style = window.getComputedStyle(dialog);

		return {
			bottom: rect.bottom,
			closeButtonBottom: closeButtonRect?.bottom ?? 0,
			closeButtonRight: closeButtonRect?.right ?? 0,
			copyButtonRight: copyButtonRect?.right ?? 0,
			overflowY: style.overflowY,
			right: rect.right,
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

	// The secret hash is deliberately not exposed to the canonical renderer.

	await pairingDialog
		.getByRole('button', { name: 'Close Pair Device' })
		.click();
	await expect(pairingDialog).toHaveCount(0);

	await openRemoteMenu(mainWindow);
	await mainWindow
		.getByRole('button', { name: /^Stop exposing this server/ })
		.click();

	await openRemoteMenu(mainWindow);
	await mainWindow.getByRole('button', { name: 'Expose this server…' }).click();
	await openRemoteMenu(mainWindow);
	const showPairing = mainWindow.getByRole('button', {
		name: 'Show pairing link and QR',
	});
	// The selected server's canonical status subscription enables this action
	// only after exposure has started and a pairing URL is available.
	await expect(showPairing).toBeVisible();
	await expect(
		mainWindow.getByRole('button', { name: /^Stop exposing this server/ }),
	).toBeVisible();
	await showPairing.click();
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

test('a direct pairing link boots the server UI, enrolls, and connects', async ({
	mainWindow,
	page,
}) => {
	const pairingUrl = await mainWindow.evaluate(async () => {
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
		const status =
			await window.terminayRemoteAccessStatusHost.toggleDirectListener();
		if (!status.lanPairingUrl)
			throw new Error('Direct exposure did not publish a pairing URL.');
		return status.lanPairingUrl;
	});

	expect(pairingUrl).toContain('pairingFlow=device');
	const certificateSession = await page.context().newCDPSession(page);
	await certificateSession.send('Security.setIgnoreCertificateErrors', {
		ignore: true,
	});
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
	appHarness,
	mainWindow,
}) => {
	await configureWebRtcHostedDomain(appHarness, mainWindow, 'http://localhost:9');

	await openRemoteMenu(mainWindow);
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
		expect(webRtcPairingUrl.protocol).toBe('https:');
		expect(webRtcPairingUrl.hostname).not.toBe('localhost');
		expect(webRtcPairingUrl.username).toBe('');
		expect(webRtcPairingUrl.password).toBe('');
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
	appHarness, mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' });
	await settingsWindow.getByLabel('Exposure route').selectOption('lan');
	await expect(settingsWindow.locator('.settings-status')).toContainText('Saved');
	await settingsWindow.close();
	await mainWindow.evaluate(async () => {
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'654321',
		);
		await window.terminayRemoteAccessStatusHost.toggleDirectListener();
	});

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
	await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.toggleServer(),
	);
});

test('rotates and stops server-owned LAN pairing without a legacy renderer API', async ({
	appHarness, mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'remote-access-host' });
	await settingsWindow.getByLabel('Exposure route').selectOption('lan');
	await expect(settingsWindow.locator('.settings-status')).toContainText('Saved');
	await settingsWindow.close();
	await mainWindow.evaluate(async () => {
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
		await window.terminayRemoteAccessStatusHost.toggleDirectListener();
	});

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
	await mainWindow.evaluate(async () => {
		await window.terminayRemoteAccessStatusHost.toggleDirectListener();
		await window.terminayRemoteAccessStatusHost.toggleDirectListener();
	});
	const rotated = await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.getStatus(),
	);
	expect(rotated.lanPairingUrl).toBeTruthy();
	expect(rotated.lanPairingUrl).not.toBe(first.lanPairingUrl);

	await mainWindow.evaluate(() =>
		window.terminayRemoteAccessStatusHost.toggleDirectListener(),
	);
	await expect
		.poll(
			async () =>
				(
					await mainWindow.evaluate(() =>
						window.terminayRemoteAccessStatusHost.getStatus(),
					)
				).directListenerRunning,
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

	await settingsWindow
		.getByRole('button', { name: 'Direct network listener' })
		.click();
	await settingsWindow
		.getByRole('button', { name: 'Start direct listener' })
		.click();
	await expect(
		settingsWindow.getByRole('button', { name: 'Stop direct listener' }),
	).toBeVisible();
	await settingsWindow.getByRole('button', { name: 'Show QR Code' }).click();
	await expect(
		settingsWindow.getByRole('dialog', { name: 'Direct network pairing QR' }),
	).toBeVisible();
	await expect(
		settingsWindow.getByAltText('Remote pairing QR code'),
	).toBeVisible();
	await settingsWindow
		.getByRole('button', { name: 'Close Remote Pairing QR' })
		.click();
	await settingsWindow
		.getByRole('button', { name: 'Stop direct listener' })
		.click();

	await settingsWindow
		.getByRole('button', { name: 'Stop Remote Access' })
		.click();
	await expect(
		settingsWindow.getByRole('button', { name: 'Start Remote Access' }),
	).toBeVisible();
});
