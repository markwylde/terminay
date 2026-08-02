import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	cancelEditWindow,
	openProjectEditWindow,
	submitEditWindow,
} from './support/ui';

const profileName = 'E2E isolated shell';
const profileSecret = 'not-visible-in-catalogue';

function profileCard(page: Page, name: string): Locator {
	return page.locator('.shell-profile-card').filter({
		has: page.locator('.shell-profile-card__title strong', { hasText: name }),
	});
}

async function openShellSettings(
	appHarness: {
		openSettingsWindow: (options: {
			page: Page;
			sectionId: string;
		}) => Promise<Page>;
	},
	page: Page,
) {
	const settingsWindow = await appHarness.openSettingsWindow({
		page,
		sectionId: 'shell-launch',
	});
	await expect(
		settingsWindow.getByRole('heading', { name: 'Shell Profiles' }),
	).toBeVisible();
	await expect(settingsWindow.locator('.shell-profiles')).toHaveAttribute(
		'aria-busy',
		'false',
	);
	return settingsWindow;
}

async function createProfile(
	settingsWindow: Page,
	name = profileName,
): Promise<void> {
	await settingsWindow.getByRole('button', { name: 'New profile' }).click();
	const editor = settingsWindow.getByRole('dialog', {
		name: 'Create shell profile',
	});
	await expect(editor).toBeVisible();
	await editor.getByLabel('Name').fill(name);
	await editor.getByLabel('Target type').selectOption('system');
	await editor.getByText('Advanced launch options').click();
	await editor.getByRole('button', { name: 'Add argument' }).click();
	await editor
		.getByRole('textbox', { name: 'Arguments 1', exact: true })
		.fill('-i');
	await editor
		.getByRole('button', { name: 'Add environment variable' })
		.click();
	await editor
		.getByLabel('Environment name 1')
		.fill('E2E_VISIBLE_ONLY_IN_DETAIL');
	await editor.getByLabel('Environment value 1').fill(profileSecret);
	await editor.getByRole('button', { name: 'Validate and save' }).click();
	await expect(editor).toHaveCount(0);
	await expect(profileCard(settingsWindow, name)).toBeVisible();
}

test.describe('shell profiles', () => {
	test('manages redacted profiles, durable defaults, project references, and existing sessions', async ({
		appHarness,
		mainWindow,
	}) => {
		const originalSessionId = await mainWindow
			.locator('.terminal-panel')
			.first()
			.getAttribute('data-terminay-terminal-session-id');
		expect(originalSessionId).toBeTruthy();

		const settingsWindow = await openShellSettings(appHarness, mainWindow);
		await expect(
			settingsWindow.getByText(
				'Executables and environment values run only on this server.',
			),
		).toBeVisible();
		await expect(
			settingsWindow.getByLabel('Default shell profile'),
		).toHaveValue('system');
		await expect(
			settingsWindow.getByLabel('New terminals start in'),
		).toHaveValue('current');

		const discoveredCards = settingsWindow
			.locator('.shell-profile-group')
			.filter({ hasText: 'Discovered on this server' })
			.locator('.shell-profile-card');
		await expect(discoveredCards.first()).toBeVisible();
		const discoveredName = (
			await discoveredCards.first().locator('strong').textContent()
		)?.trim();
		expect(discoveredName).toBeTruthy();
		await expect(
			settingsWindow
				.getByLabel('Default shell profile')
				.locator('option', { hasText: discoveredName! }),
		).toHaveCount(0);
		await discoveredCards.first().getByRole('button', { name: 'Copy' }).click();
		const copiedEditor = settingsWindow.getByRole('dialog', {
			name: 'Create shell profile',
		});
		await expect(copiedEditor.getByLabel('Name')).toHaveValue(
			`${discoveredName} copy`,
		);
		await copiedEditor.getByRole('button', { name: 'Cancel' }).click();

		await createProfile(settingsWindow);
		const card = profileCard(settingsWindow, profileName);
		await expect(card).toContainText('Available');
		await expect(card).toContainText('1 argument');
		await expect(card).toContainText('1 environment');
		await expect(card).not.toContainText(profileSecret);

		await card.getByRole('button', { name: 'Edit' }).click();
		const editor = settingsWindow.getByRole('dialog', {
			name: 'Edit shell profile',
		});
		await editor.getByText('Advanced launch options').click();
		await expect(editor.getByLabel('Environment value 1')).toHaveValue(
			profileSecret,
		);
		await editor.getByRole('button', { name: 'Cancel' }).click();

		const defaultOption = settingsWindow
			.getByLabel('Default shell profile')
			.getByRole('option', { name: profileName, exact: true });
		await expect(defaultOption).toBeEnabled();
		await settingsWindow
			.getByLabel('Default shell profile')
			.selectOption({ label: profileName });
		await expect(card).toContainText('Server default');
		await settingsWindow.close();

		await expect(
			mainWindow.locator(
				`[data-terminay-terminal-session-id="${originalSessionId}"]`,
			),
		).toBeVisible();

		const editWindow = await openProjectEditWindow(mainWindow);
		await editWindow
			.getByLabel('Default shell profile')
			.selectOption({ label: profileName });
		await submitEditWindow(editWindow);

		const reopenedProjectEditor = await openProjectEditWindow(mainWindow);
		await expect(
			reopenedProjectEditor.getByLabel('Default shell profile'),
		).toHaveValue(/profile:/);
		await cancelEditWindow(reopenedProjectEditor);

		const referencedSettings = await openShellSettings(appHarness, mainWindow);
		const referencedCard = profileCard(referencedSettings, profileName);
		await expect(referencedCard).toContainText('1 project');
		await expect(
			referencedCard.getByRole('button', { name: 'Delete' }),
		).toBeDisabled();
		await expect(
			referencedCard.getByRole('button', { name: 'Delete' }),
		).toHaveAttribute('title', /server default|referenced projects/);
	});

	test('preserves editor input on a duplicate-name conflict', async ({
		appHarness,
		mainWindow,
	}) => {
		const settingsWindow = await openShellSettings(appHarness, mainWindow);
		await createProfile(settingsWindow, 'Conflicting profile name');

		await settingsWindow.getByRole('button', { name: 'New profile' }).click();
		const conflictingEditor = settingsWindow.getByRole('dialog', {
			name: 'Create shell profile',
		});
		await conflictingEditor.getByLabel('Name').fill('Conflicting profile name');
		await conflictingEditor
			.getByRole('textbox', { name: 'Executable', exact: true })
			.fill('/bin/zsh');
		await conflictingEditor
			.getByRole('button', { name: 'Validate and save' })
			.click();

		await expect(conflictingEditor).toBeVisible();
		await expect(conflictingEditor.getByLabel('Name')).toHaveValue(
			'Conflicting profile name',
		);
		await expect(conflictingEditor.getByLabel('Name')).toHaveAttribute(
			'aria-invalid',
			'true',
		);
		await expect(
			conflictingEditor.locator('.shell-profile-field-error'),
		).toContainText(/already|duplicate|unique/i);
		await conflictingEditor.getByRole('button', { name: 'Cancel' }).click();

		const currentCard = profileCard(settingsWindow, 'Conflicting profile name');
		await currentCard.getByRole('button', { name: 'Delete' }).click();
		await expect(currentCard).toHaveCount(0);
	});

	test('preserves an unavailable profile for repair without selecting it by default', async ({
		appHarness,
		mainWindow,
	}) => {
		const settingsWindow = await openShellSettings(appHarness, mainWindow);
		await settingsWindow.getByRole('button', { name: 'New profile' }).click();
		const editor = settingsWindow.getByRole('dialog', {
			name: 'Create shell profile',
		});
		await editor.getByLabel('Name').fill('Unavailable executable');
		await editor
			.getByRole('textbox', { name: 'Executable', exact: true })
			.fill('/definitely/missing/terminay-e2e-shell');
		await editor.getByRole('button', { name: 'Validate and save' }).click();

		await expect(editor).toHaveCount(0);
		const unavailableCard = profileCard(
			settingsWindow,
			'Unavailable executable',
		);
		await expect(unavailableCard).toContainText(/unavailable/i);
		await expect(
			settingsWindow.getByLabel('Default shell profile'),
		).toHaveValue('system');
		await expect(
			settingsWindow
				.getByLabel('Default shell profile')
				.locator('option', { hasText: 'Unavailable executable' }),
		).toHaveAttribute('disabled', '');

		await unavailableCard.getByRole('button', { name: 'Edit' }).click();
		const repairEditor = settingsWindow.getByRole('dialog', {
			name: 'Edit shell profile',
		});
		await expect(
			repairEditor.getByRole('textbox', { name: 'Executable', exact: true }),
		).toHaveValue('/definitely/missing/terminay-e2e-shell');
	});

	test('traps and restores editor focus and remains usable at narrow widths', async ({
		appHarness,
		mainWindow,
	}) => {
		const settingsWindow = await openShellSettings(appHarness, mainWindow);
		const newProfileButton = settingsWindow.getByRole('button', {
			name: 'New profile',
		});
		await newProfileButton.focus();
		await newProfileButton.click();

		const editor = settingsWindow.getByRole('dialog', {
			name: 'Create shell profile',
		});
		await expect(
			editor.getByRole('heading', { name: 'Create shell profile' }),
		).toBeFocused();
		const closeButton = editor.getByRole('button', {
			name: 'Close profile editor',
		});
		await closeButton.focus();
		await settingsWindow.keyboard.press('Shift+Tab');
		await expect(
			editor.getByRole('button', { name: 'Validate and save' }),
		).toBeFocused();

		await settingsWindow.keyboard.press('Escape');
		await expect(editor).toHaveCount(0);
		await expect(newProfileButton).toBeFocused();

		await settingsWindow.setViewportSize({ width: 560, height: 720 });
		await expect
			.poll(
				async () =>
					await settingsWindow
						.locator('.shell-profiles-defaults')
						.evaluate(
							(element) =>
								getComputedStyle(element).gridTemplateColumns.split(' ').length,
						),
			)
			.toBe(1);
		await expect(
			settingsWindow.locator('.shell-profile-card').first(),
		).toHaveCSS('flex-direction', 'column');
		await newProfileButton.click();
		const narrowEditor = settingsWindow.getByRole('dialog', {
			name: 'Create shell profile',
		});
		await expect(narrowEditor).toBeInViewport();
		const editorBox = await narrowEditor.boundingBox();
		expect(editorBox).not.toBeNull();
		expect(editorBox!.width).toBeLessThanOrEqual(560);
	});

	test('opens the one-off chooser from the command bar with keyboard-safe dismissal and launches once', async ({
		appHarness,
		mainWindow,
	}) => {
		const existingTabCount = await mainWindow
			.locator('.terminal-tab-content')
			.count();

		await appHarness.openMacroLauncher(mainWindow);
		await mainWindow
			.getByLabel('Search commands')
			.fill('new terminal with profile');
		await mainWindow
			.locator('.macro-launcher-item')
			.filter({ hasText: 'New Terminal with Profile…' })
			.click();
		const chooser = mainWindow.getByRole('dialog', {
			name: 'New Terminal with Profile',
		});
		await expect(chooser).toBeVisible();
		await expect(
			chooser.getByPlaceholder('Search shell profiles'),
		).toBeFocused();

		const closeButton = chooser.getByRole('button', {
			name: 'Close shell profile chooser',
		});
		await closeButton.focus();
		await mainWindow.keyboard.press('Shift+Tab');
		await expect(
			chooser.locator('.shell-profile-chooser__list > button').last(),
		).toBeFocused();
		await mainWindow.keyboard.press('Escape');
		await expect(chooser).toHaveCount(0);
		await expect
			.poll(() =>
				mainWindow.evaluate(() =>
					document.activeElement?.classList.contains('xterm-helper-textarea'),
				),
			)
			.toBe(true);

		await appHarness.openMacroLauncher(mainWindow);
		await mainWindow
			.getByLabel('Search commands')
			.fill('new terminal with profile');
		await mainWindow
			.locator('.macro-launcher-item')
			.filter({ hasText: 'New Terminal with Profile…' })
			.click();
		await mainWindow
			.getByRole('dialog', { name: 'New Terminal with Profile' })
			.getByRole('button', { name: 'System default' })
			.click();
		await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(
			existingTabCount + 1,
		);
		await expect(
			mainWindow.locator('.terminal-tab-content').last(),
		).toContainText('Terminal 2');
	});
});
