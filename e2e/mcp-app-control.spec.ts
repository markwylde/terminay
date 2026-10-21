import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectHomeSection } from './support/home-tabs';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * Workspace windows through MCP (mcp-app-control, ADR-0072). Pixel holds
 * workspace reach; the fake `claude` (e2e/fixtures/fake-claude-chat.mjs)
 * calls the real window tools on Pixel's own capability, so the server
 * commits each change and the window Pixel was asked from presents it.
 */

const balloon = (page: Page) => page.locator('.mwpet-chat');

/** One MCP request on the calling terminal's own control socket. */
const MCP_SCRIPT = `
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile, outFile] = process.argv.slice(2);
const params = JSON.parse(readFileSync(paramsFile, 'utf8'));
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	writeFileSync(outFile, buffer.slice(0, end));
	socket.end();
});
socket.on('error', (error) => {
	writeFileSync(outFile, JSON.stringify({ ok: false, error: { code: 'socket', message: error.message } }));
});
`;

async function openPixel(
	appHarness: {
		openSettingsWindow: (options: {
			page: Page;
			sectionId: string;
		}) => Promise<Page>;
	},
	page: Page,
): Promise<void> {
	const settings = await appHarness.openSettingsWindow({
		page,
		sectionId: 'pixel',
	});
	await settings.getByLabel('Enable Pixel').check();
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
	const dock = page.locator('.workspace-status-bar .pixel-dock--status-bar');
	await expect(dock).toBeVisible();
	const claudeChip = balloon(page).getByRole('button', { name: 'Claude Code' });
	await expect(async () => {
		if (await balloon(page).isVisible()) await dock.click();
		await dock.click();
		await expect(claudeChip).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	await claudeChip.click();
	await expect(balloon(page).locator('.mwpet-chat-status')).toContainText(
		'Claude Code',
	);
}

async function ask(page: Page, text: string): Promise<void> {
	const input = balloon(page).locator('.mwpet-chat-input');
	await input.fill(text);
	await input.press('Enter');
}

/** Every open workspace window other than the main one. */
function otherWorkspaceWindows(
	electronApp: ElectronApplication,
	mainWindow: Page,
): Page[] {
	return electronApp
		.windows()
		.filter(
			(page) =>
				page !== mainWindow &&
				!page.isClosed() &&
				!page.url().startsWith('about:blank') &&
				!page.url().startsWith('data:') &&
				new URL(page.url()).searchParams.get('view') !== null,
		);
}

test('Pixel opens a workspace window holding a project, then moves the project back and closes the window', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(150_000);
	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	const projectId = await mainWindow
		.locator('.project-workspace--active')
		.first()
		.getAttribute('data-terminay-project-id');
	const sessionId = await mainWindow
		.locator('.project-workspace--active .terminal-panel')
		.first()
		.getAttribute('data-terminay-terminal-session-id');
	expect(projectId).not.toBeNull();
	expect(sessionId).not.toBeNull();

	await openPixel(appHarness, mainWindow);
	await ask(mainWindow, 'pop this project out');
	await expect(balloon(mainWindow)).toContainText('Opened a window for', {
		timeout: 30_000,
	});
	await expect(balloon(mainWindow)).toContainText('✓ Opening a window');

	// Desktop presents it as a native window, holding the project and its
	// running terminal; the main window keeps the other project.
	let popout: Page | undefined;
	await expect
		.poll(
			async () => {
				popout = otherWorkspaceWindows(electronApp, mainWindow)[0];
				return popout === undefined
					? 0
					: await popout
							.locator(`.project-tab[data-project-id="${projectId}"]`)
							.count();
			},
			{ timeout: 30_000 },
		)
		.toBe(1);
	if (popout === undefined) throw new Error('Expected the presented window');
	await expect(
		popout.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		),
	).toBeVisible({ timeout: 20_000 });
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(
		mainWindow.locator(`.project-tab[data-project-id="${projectId}"]`),
	).toHaveCount(0);

	// Back again: the project returns with its terminal, and the window,
	// deleted on the server, closes.
	await ask(mainWindow, 'bring it back');
	await expect(balloon(mainWindow)).toContainText(
		'Moved it back and closed the window.',
		{ timeout: 30_000 },
	);
	await expect(
		mainWindow.locator(`.project-tab[data-project-id="${projectId}"]`),
	).toHaveCount(1);
	await expect
		.poll(() => popout?.isClosed() ?? true, { timeout: 20_000 })
		.toBe(true);
	await expect
		.poll(() => otherWorkspaceWindows(electronApp, mainWindow).length)
		.toBe(0);
	await mainWindow
		.locator(`.project-tab[data-project-id="${projectId}"]`)
		.click();
	await expect(
		mainWindow.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		),
	).toBeVisible({ timeout: 20_000 });
});

test('Pixel shows Home > Automations on the window it was asked from, and no other', async ({
	appHarness,
	electronApp,
	mainWindow,
}) => {
	test.setTimeout(150_000);
	await createStartedProject(mainWindow);
	await openPixel(appHarness, mainWindow);
	// A second window, so there is another client that must not change.
	await ask(mainWindow, 'pop this project out');
	await expect(balloon(mainWindow)).toContainText('Opened a window for', {
		timeout: 30_000,
	});
	let popout: Page | undefined;
	await expect
		.poll(
			() => {
				popout = otherWorkspaceWindows(electronApp, mainWindow)[0];
				return popout !== undefined;
			},
			{ timeout: 30_000 },
		)
		.toBe(true);
	if (popout === undefined) throw new Error('Expected the presented window');
	await expect(popout.locator('.app-shell')).not.toHaveAttribute(
		'data-terminay-selected-view',
		'home',
	);
	await expect(mainWindow.locator('.app-shell')).not.toHaveAttribute(
		'data-terminay-selected-view',
		'home',
	);

	await ask(mainWindow, 'show my automations');
	await expect(balloon(mainWindow)).toContainText(
		'Showing Home: automations.',
		{ timeout: 30_000 },
	);
	await expect(balloon(mainWindow)).toContainText('✓ Showing Home');
	await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
		'data-terminay-selected-view',
		'home',
	);
	await expectHomeSection(mainWindow, 'automations');
	// Home's state is this device's own: the other window is unchanged.
	await expect(popout.locator('.app-shell')).not.toHaveAttribute(
		'data-terminay-selected-view',
		'home',
	);
});

test('Pixel creates a project at ~ and its first terminal opens in this window', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await openPixel(appHarness, mainWindow);
	await ask(mainWindow, 'make a project in my home folder');
	await expect(balloon(mainWindow)).toContainText(
		/Created Home from Pixel with terminal \S+, on screen\./,
		{ timeout: 30_000 },
	);
	const reply = (await balloon(mainWindow).textContent()) ?? '';
	const terminal = /with terminal (\S+?), on screen/.exec(reply)?.[1];
	expect(terminal).toBeDefined();
	expect(terminal).not.toBe('none');

	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(
		mainWindow.locator('.project-tab', { hasText: 'Home from Pixel' }),
	).toHaveCount(1);
	await expect(
		terminalPanelForSession(mainWindow, terminal as string),
	).toBeVisible({ timeout: 20_000 });
});

test("a project terminal's create_project fails out_of_scope and creates nothing", async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(90_000);
	// A script in the project's own terminal calls on that terminal's
	// capability, as the stdio adapter would.
	const caller = await activeTerminalSessionId(mainWindow);
	const script = path.join(userDataDir, 'mcp-app-control-e2e.mjs');
	const paramsFile = path.join(userDataDir, 'mcp-app-control-params.json');
	const outFile = path.join(userDataDir, 'mcp-app-control.out');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(
		paramsFile,
		JSON.stringify({ root: '~', name: 'Not allowed' }),
	);
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' create_project '${paramsFile}' '${outFile}'`,
		terminalPanelForSession(mainWindow, caller),
	);
	await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
	const response = JSON.parse(await readFile(outFile, 'utf8')) as {
		ok: boolean;
		error?: { code: string };
	};
	expect(response.ok).toBe(false);
	expect(response.error?.code).toBe('out_of_scope');
	await expect(mainWindow.locator('.project-tab')).toHaveCount(1);
	await expect(
		mainWindow.locator('.project-tab', { hasText: 'Not allowed' }),
	).toHaveCount(0);
});

test('update_settings under the default policy asks in the chat before anything changes', async ({
	appHarness,
	mainWindow,
}) => {
	test.setTimeout(120_000);
	await openPixel(appHarness, mainWindow);
	await ask(mainWindow, 'set scrollback to 4321');
	const allow = balloon(mainWindow).getByRole('button', {
		name: 'Allow One Time',
	});
	await expect(allow).toBeVisible({ timeout: 30_000 });
	await expect(balloon(mainWindow)).toContainText(
		'Pixel (Claude Code) wants to',
	);
	await expect(balloon(mainWindow)).not.toContainText(
		'Scrollback is now 4321.',
	);
	await allow.click();
	await expect(balloon(mainWindow)).toContainText('→ Allowed once');
	await expect(balloon(mainWindow)).toContainText('Scrollback is now 4321.', {
		timeout: 30_000,
	});
});
