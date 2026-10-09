import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { runShellCommand } from './support/terminal-input';
import { openTerminalEditWindow, submitEditWindow } from './support/ui';

function activeTabTitle(page: Page) {
	return page.locator(
		'.project-workspace--active .terminal-tab-content--active .terminal-tab-title',
	);
}

/** The xterm title sequence a CLI writes to name its tab. */
function setTitleCommand(title: string): string {
	return `printf '\\033]2;${title}\\007'`;
}

async function renameActiveTab(page: Page, name: string): Promise<void> {
	const editWindow = await openTerminalEditWindow(page);
	await editWindow
		.getByRole('textbox', { name: 'Name', exact: true })
		.fill(name);
	await submitEditWindow(editWindow);
}

test('a program names its tab, a name someone gave it wins, and clearing that name brings the program title back', async ({
	mainWindow,
}) => {
	const title = activeTabTitle(mainWindow);
	await expect(title).toHaveText('Terminal 1');

	await runShellCommand(mainWindow, setTitleCommand('build watcher'));
	await expect(title).toHaveText('build watcher');

	// The field holds only a name someone gave: there is none yet, so it is
	// empty and offers what the tab shows.
	const editWindow = await openTerminalEditWindow(mainWindow);
	const nameField = editWindow.getByRole('textbox', {
		name: 'Name',
		exact: true,
	});
	await expect(nameField).toHaveValue('');
	await expect(nameField).toHaveAttribute('placeholder', 'build watcher');
	await nameField.fill('api');
	await submitEditWindow(editWindow);
	await expect(title).toHaveText('api');

	// The program keeps renaming itself; the tab keeps the name it was given.
	await runShellCommand(mainWindow, setTitleCommand('deploy'));
	await runShellCommand(mainWindow, 'echo title-was-sent');
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-panel:visible'),
	).toContainText('title-was-sent');
	await expect(title).toHaveText('api');

	// Taking the name away shows what the program last asked for.
	await renameActiveTab(mainWindow, '');
	await expect(title).toHaveText('deploy');

	// A program that clears its title returns the tab to its default name.
	await runShellCommand(mainWindow, setTitleCommand(''));
	await expect(title).toHaveText('Terminal 1');
});

test('a program title survives a reload', async ({ mainWindow }) => {
	const title = activeTabTitle(mainWindow);
	await runShellCommand(mainWindow, setTitleCommand('build watcher'));
	await expect(title).toHaveText('build watcher');

	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await expect(title).toHaveText('build watcher');
});

test('turning the setting off drops program titles and ignores new ones', async ({
	appHarness,
	mainWindow,
}) => {
	const title = activeTabTitle(mainWindow);
	await runShellCommand(mainWindow, setTitleCommand('build watcher'));
	await expect(title).toHaveText('build watcher');

	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'shell-lifecycle',
	});
	const toggle = settingsWindow.getByLabel('Let programs set tab titles');
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
	await expect(title).toHaveText('Terminal 1');
	await settingsWindow.close();

	await runShellCommand(mainWindow, setTitleCommand('ignored'));
	await runShellCommand(mainWindow, 'echo title-was-sent');
	const panel = mainWindow.locator(
		'.project-workspace--active .terminal-panel:visible',
	);
	await expect(panel).toContainText('title-was-sent');
	await expect(title).toHaveText('Terminal 1');
	// The sequence is consumed, never drawn: the title's text appears once, in
	// the command as it was typed, and nowhere in that command's output.
	expect((await panel.innerText()).split('ignored')).toHaveLength(2);

	// A name still works while program titles are off.
	await renameActiveTab(mainWindow, 'api');
	await expect(title).toHaveText('api');
});
