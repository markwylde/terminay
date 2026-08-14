import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

type AppHarness = {
	openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page>;
};

function remoteOriginInput(page: Page) {
	return page
		.locator('#section-remote-access-host .settings-row')
		.filter({ hasText: 'Remote origin' })
		.locator('input');
}

async function configureWebRtcHostedDomain(
	appHarness: AppHarness,
	page: Page,
	hostedDomain: string,
): Promise<void> {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'remote-access-host' });
	await settings.getByLabel('Exposure route').selectOption('webrtc');
	await settings.locator('#section-remote-access-host .settings-row').filter({ hasText: 'WebRTC hosted domain' }).locator('input').fill(hostedDomain);
	// "Saved" is also the initial status. Observe this mutation enter the
	// canonical save pipeline before accepting its committed state; otherwise a
	// fast close can leave the exposure using the previous LAN origin.
	await expect(settings.locator('.settings-status')).toHaveText('Saving...');
	await expect(settings.locator('.settings-status')).toHaveText('Saved');
	await settings.close();
}

async function readPairingLink(page: Page): Promise<string> {
	const pairingDialog = page.getByRole('dialog', { name: 'Pair device' });
	await expect(pairingDialog).toBeVisible();
	const pairingLink = pairingDialog
		.locator('.remote-pairing-modal__address-text')
		.filter({ hasText: /^https?:\/\//u })
		.last();
	await expect(pairingLink).toBeVisible();
	return pairingLink.innerText();
}

async function exposeDirectAndReadPairingLink(
	appHarness: AppHarness,
	page: Page,
	pin: string,
): Promise<string> {
	const settings = await appHarness.openSettingsWindow({
		page,
		sectionId: 'remote-access-host',
	});
	await settings.getByLabel('Exposure route').selectOption('lan');
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.getByRole('button', { name: 'Direct network listener' }).click();
	await settings.getByRole('button', { name: 'Start direct listener' }).click();
	const pinDialog = settings.getByRole('dialog', { name: 'Remote Pairing PIN' });
	// A fresh Desktop authority has no PIN. Wait for the controller's required
	// first-use continuation instead of sampling visibility before React has had
	// a chance to render the dialog and accidentally leaving the start action
	// suspended forever.
	await expect(pinDialog).toBeVisible();
	await expect(
		settings.getByRole('button', { name: 'Starting direct listener…' }),
	).toBeDisabled();
	await pinDialog.getByRole('textbox', { name: 'Pairing PIN' }).fill(pin);
	await pinDialog.getByRole('button', { name: 'Save PIN' }).click();
	await expect(pinDialog).toHaveCount(0);
	const directListenerError = settings.getByTestId(
		'direct-listener-operation-error',
	);
	await expect(
		settings
			.getByRole('button', { name: 'Stop direct listener' })
			.or(directListenerError),
	).toBeVisible({ timeout: 20_000 });
	if (await directListenerError.isVisible().catch(() => false)) {
		throw new Error(
			`Direct listener start was rejected: ${await directListenerError.innerText()}`,
		);
	}
	const showPairing = settings.getByRole('button', { name: 'Show QR Code' });
	await expect(showPairing).toBeVisible();
	await expect(showPairing).toBeEnabled();
	await showPairing.click();
	const qrDialog = settings.getByRole('dialog', {
		name: 'Direct network pairing QR',
	});
	await expect(qrDialog).toBeVisible();
	const pairingLink = qrDialog.getByTestId('remote-pairing-link');
	await expect(pairingLink).toBeVisible();
	const pairingUrl = await pairingLink.innerText();
	await settings.getByRole('button', { name: 'Close Remote Pairing QR' }).click();
	await settings.close();
	return pairingUrl;
}

async function stopExposure(page: Page): Promise<void> {
	await openRemoteMenu(page);
	const stop = page.getByRole('button', { name: /^Stop exposing this server/ });
	if (await stop.isVisible().catch(() => false)) await stop.click();
}

async function stopDirectExposure(appHarness: AppHarness, page: Page): Promise<void> {
	const settings = await appHarness.openSettingsWindow({
		page,
		sectionId: 'remote-access-host',
	});
	await settings.getByRole('button', { name: 'Direct network listener' }).click();
	const stop = settings.getByRole('button', { name: 'Stop direct listener' });
	if (await stop.isVisible().catch(() => false)) await stop.click();
	await expect(
		settings.getByRole('button', { name: 'Start direct listener' }),
	).toBeVisible();
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
	const showPairing = page.getByRole('button', { name: 'Show pairing link and QR' });
	await expect(showPairing).toBeEnabled();
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
	).toBeEnabled();
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
	await expect(showPairing).toBeEnabled();
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
	appHarness,
	mainWindow,
	page,
}) => {
	const pairingUrl = await exposeDirectAndReadPairingLink(
		appHarness,
		mainWindow,
		'123456',
	);

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

		await openRemoteMenu(mainWindow);
		const showPairing = mainWindow.getByRole('button', {
			name: 'Show pairing link and QR',
		});
		await expect(showPairing).toBeEnabled();
		await showPairing.click();
		const webRtcPairingUrl = new URL(await readPairingLink(mainWindow));
		await mainWindow.getByRole('button', { name: 'Close Pair Device' }).click();
		// The configured test registrar is loopback HTTP. Its randomized reserved
		// .localhost session name remains a distinct origin; production hosted
		// registrars use HTTPS under their configured public domain.
		expect(webRtcPairingUrl.protocol).toBe('http:');
		expect(webRtcPairingUrl.hostname).toMatch(/^[a-f0-9]{32}\.localhost$/u);
		expect(webRtcPairingUrl.hostname).not.toBe('localhost');
		expect(webRtcPairingUrl.port).toBe('9');
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
		await stopExposure(mainWindow);
	}
});

test('keeps the configured PIN out of the server-owned LAN handoff', async ({
	appHarness, mainWindow,
}) => {
	const pairingUrl = new URL(
		await exposeDirectAndReadPairingLink(appHarness, mainWindow, '654321'),
	);
	expect(pairingUrl.search).toBe('');
	const pairingBootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
	expect(pairingBootstrap.get('pairingSessionId')).toMatch(/^pair-/);
	expect(pairingBootstrap.get('pairingToken')).toMatch(/^[A-Za-z0-9_-]{32,}$/);
	expect(pairingBootstrap.get('pairingExpiresAt')).toBeTruthy();
	expect(pairingUrl.hash).not.toContain('654321');
	await stopDirectExposure(appHarness, mainWindow);
});

test('rotates and stops server-owned LAN pairing without a legacy renderer API', async ({
	appHarness, mainWindow,
}) => {
	const first = await exposeDirectAndReadPairingLink(
		appHarness,
		mainWindow,
		'123456',
	);
	await stopDirectExposure(appHarness, mainWindow);
	const rotated = await exposeDirectAndReadPairingLink(
		appHarness,
		mainWindow,
		'123456',
	);
	expect(rotated).not.toBe(first);
	await stopDirectExposure(appHarness, mainWindow);
	await openRemoteMenu(mainWindow);
	await expect(
		mainWindow.getByRole('button', { name: 'Expose this server…' }),
	).toBeVisible();
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
