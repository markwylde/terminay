import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { runShellCommand } from './support/terminal-input';

/** The OSC 52 sequence a program writes to copy `text`, as a shell command. */
function copyCommand(text: string, targets = 'c'): string {
	const payload = Buffer.from(text, 'utf8').toString('base64');
	return `printf '\\033]52;${targets};${payload}\\007'`;
}

function activePanel(page: Page) {
	return page.locator('.project-workspace--active .terminal-panel:visible');
}

async function setClipboard(app: ElectronApplication, text: string) {
	await app.evaluate(({ clipboard }, value) => {
		clipboard.writeText(value);
	}, text);
}

function readClipboard(app: ElectronApplication) {
	return app.evaluate(({ clipboard }) => clipboard.readText());
}

/** Run a command and wait until the shell has printed past it. */
async function runAndSettle(page: Page, command: string, marker: string) {
	await runShellCommand(page, `${command}; echo ${marker}-done`);
	await expect(activePanel(page)).toContainText(`${marker}-done`);
}

test('a program copies to the clipboard with OSC 52, and a reload does not copy again', async ({
	electronApp,
	mainWindow,
}) => {
	await setClipboard(electronApp, 'before');
	await runAndSettle(
		mainWindow,
		copyCommand('terminay osc52\n\tcopied ✓'),
		'osc52-live',
	);
	await expect
		.poll(() => readClipboard(electronApp))
		.toBe('terminay osc52\n\tcopied ✓');

	// The terminal's history still holds that sequence. Replaying it on
	// reattach must not overwrite what the user copied since.
	await setClipboard(electronApp, 'copied since');
	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	await expect(activePanel(mainWindow)).toContainText('osc52-live-done');
	await runAndSettle(mainWindow, 'true', 'osc52-after-reload');
	expect(await readClipboard(electronApp)).toBe('copied since');
});

test('a clipboard query, an empty request and text with escape sequences leave the clipboard alone', async ({
	electronApp,
	mainWindow,
}) => {
	await setClipboard(electronApp, 'untouched');

	await runAndSettle(mainWindow, "printf '\\033]52;c;?\\007'", 'osc52-query');
	await runAndSettle(mainWindow, "printf '\\033]52;c;\\007'", 'osc52-empty');
	await runAndSettle(
		mainWindow,
		copyCommand('echo hi\u001b[201~'),
		'osc52-unsafe',
	);

	expect(await readClipboard(electronApp)).toBe('untouched');
	// A query answer would arrive at the shell as input and be echoed.
	await expect(activePanel(mainWindow)).not.toContainText('dW50b3VjaGVk');
});

test('turning the setting off stops programs copying', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	const settingsWindow = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'selection',
	});
	const toggle = settingsWindow.getByLabel(
		'Programs can copy to the clipboard',
	);
	await expect(toggle).toBeChecked();
	await toggle.uncheck();
	await expect(toggle).not.toBeChecked();
	await settingsWindow.close();

	// The setting reaches the terminal asynchronously; once it has, a copy is
	// ignored.
	let attempt = 0;
	await expect(async () => {
		attempt += 1;
		await setClipboard(electronApp, 'untouched');
		await runAndSettle(
			mainWindow,
			copyCommand('ignored'),
			`osc52-off-${attempt}`,
		);
		expect(await readClipboard(electronApp)).toBe('untouched');
	}).toPass({ timeout: 15_000 });
});
