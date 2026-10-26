import { expect, test } from './fixtures';
import { openRemoteMenu } from './support/ui';

test('Electron opens Remote Access as a category of the Settings window', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const manager = await appHarness.openRemoteAccessSettings(mainWindow);
	await expect(manager.locator('.settings-sidebar')).toBeVisible();
	await expect(manager.locator('.settings-list-column')).toBeVisible();
	await expect(manager.locator('.settings-content')).toBeVisible();
	await expect(
		manager.getByRole('heading', { name: 'Settings', level: 1 }),
	).toBeVisible();
	await expect(
		manager.locator('.settings-nav-item--active'),
	).toContainText('Remote Access');
	await expect(manager.locator('[role="dialog"]')).toHaveCount(0);
	const url = new URL(manager.url()).searchParams;
	expect(url.get('auxiliary')).toBe('settings');
	expect(url.get('section')).toBe('remote');
	const list = manager.getByRole('navigation', { name: 'Remote Access' });
	await expect(list.locator('.settings-list-section-title')).toHaveText([
		'This server',
		'Saved servers',
	]);
	// This server is selected first, with its exposure and its options together.
	await expect(list.locator('[aria-current="true"]')).toContainText('Not exposed');
	await expect(
		manager.getByRole('region', { name: 'Server exposure' }),
	).toBeVisible();
	await expect(manager.locator('#section-remote-access-host')).toBeVisible();
	// No other Settings category draws the exposure options.
	await manager.locator('.settings-nav-item', { hasText: 'Appearance' }).click();
	await expect(manager.locator('#section-remote-access-host')).toHaveCount(0);
	await manager.locator('.settings-nav-item', { hasText: 'Remote Access' }).click();

	await manager.getByRole('button', { name: 'Add server…' }).click();
	await expect(
		manager.locator('form[aria-label="Add connection"]'),
	).toBeVisible();
	await expect(manager.getByLabel('Pairing URL')).toBeVisible();
	// A person with no server is shown how to start one, naming the image
	// this build matches: a development build names the newest release.
	const guide = manager.getByRole('region', {
		name: "Don't have a server yet?",
	});
	await expect(
		guide.getByText(
			'docker run -d --name terminay -v terminay-data:/var/lib/terminay -v terminay-home:/home/terminay markwylde/terminay',
			{ exact: true },
		),
	).toBeVisible();
	await expect(guide.getByText(/TERMINAY_PUBLIC_HOST=/u)).toBeHidden();
	await guide.getByText('More options').click();
	await expect(guide.getByText(/TERMINAY_PUBLIC_HOST=/u)).toBeVisible();
	await expect(
		manager.getByRole('button', { name: 'Continue pairing', exact: true }),
	).toBeVisible();
});

test('the header connection menu opens Settings at Remote Access', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const connectionMenu = mainWindow.getByRole('button', {
		name: /Open connection menu/,
	});
	await expect(connectionMenu).toHaveAttribute(
		'aria-label',
		'Open connection menu, Offline',
	);
	const manager = await appHarness.openChildWindow(async () => {
		await connectionMenu.click();
		await mainWindow.getByRole('button', { name: 'Manage connections' }).click();
	});
	const url = new URL(manager.url()).searchParams;
	expect(url.get('auxiliary')).toBe('settings');
	expect(url.get('section')).toBe('remote');
	await expect(
		manager.getByRole('navigation', { name: 'Remote Access' }),
	).toBeVisible();
});

test('the Remote Access command, as the pending-approval notification sends it, opens Settings at Remote Access', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const manager = await appHarness.openChildWindow(async () => {
		await appHarness.sendAppCommand('open-remote-control', mainWindow);
	});
	expect(new URL(manager.url()).searchParams.get('section')).toBe('remote');
	await expect(
		manager.getByRole('navigation', { name: 'Remote Access' }),
	).toBeVisible();
});

test('Create pairing link opens the pairing dialog over Settings, and Escape closes only it', async ({
	appHarness,
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const manager = await appHarness.openRemoteAccessSettings(mainWindow);
	const exposure = manager.getByRole('region', { name: 'Server exposure' });
	const expose = exposure.getByRole('button', { name: 'Expose this server…' });
	await expect(expose).toBeVisible();
	test.skip(
		await expose.isDisabled(),
		'WebRTC exposure is unavailable in this build, so no pairing link can be made.',
	);
	await expose.click();
	await exposure.getByRole('button', { name: 'Create pairing link' }).click();
	const dialog = manager.getByRole('dialog');
	await expect(dialog).toBeVisible();
	await manager.keyboard.press('Escape');
	await expect(dialog).toHaveCount(0);
	await expect(
		manager.getByRole('navigation', { name: 'Remote Access' }),
	).toBeVisible();
	await exposure.getByRole('button', { name: 'Stop exposure' }).click();
});

test('the header connection menu lists Local and omits Switch connections', async ({
	mainWindow,
}) => {
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	await openRemoteMenu(mainWindow);
	const menu = mainWindow
		.locator('[role="menu"][aria-label="Connection menu"]:visible')
		.first();
	await expect(
		menu.getByRole('menuitemradio', { name: 'Local' }),
	).toBeVisible();
	await expect(
		menu.getByRole('button', { name: 'Switch connections' }),
	).toHaveCount(0);
});
