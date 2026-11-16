import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import {
	settledTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';

/**
 * Terminal overlays beside the workflow panel (terminal-workflows, issue #583).
 *
 * The reported failure: with the workflow panel open, a terminal's red
 * "Terminal recovery timed out" banner ran underneath the panel, so its
 * **Retry connection** button sat behind it and could not be clicked. The pane
 * reserves the panel's room as padding, which absolutely positioned overlays
 * ignored. Here the banner is raised for real — the server refuses the
 * terminal's resume after a Local transport loss — and must lie inside the
 * terminal's own area, beside the panel, rail or drawer, and answer a real
 * click and a real Enter.
 */

const READY_TIMEOUT_MS = 20_000;
const RECOVERY_TIMEOUT_MS = 45_000;
const PANEL_KEY = 'terminay.workflowPanel.v1';
const LAYOUT_KEY = 'terminay.workflowLayout.v1';
const DRAWER_KEY = 'terminay.workflowDrawer.v1';

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

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('element has no box');
	return box;
}

async function attachWorkflow(page: Page, userDataDir: string, panel: Locator): Promise<void> {
	const script = path.join(userDataDir, 'overlays-e2e.mjs');
	const paramsFile = path.join(userDataDir, 'overlays-e2e.json');
	const outFile = path.join(userDataDir, 'overlays-e2e.out');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(
		paramsFile,
		JSON.stringify({
			name: 'OpenSpec: Propose → Ship',
			steps: [
				{ title: 'Propose the change' },
				{ title: 'Codex reviews the proposal' },
				{ title: 'Implement' },
				{ title: 'Verify the implementation' },
				{ title: 'Open the pull request' },
				{ title: 'Get CI green' },
			],
		}),
	);
	await submitTerminalCommand(
		page,
		`clear; '${process.execPath}' '${script}' create_workflow '${paramsFile}' '${outFile}'; clear`,
		panel,
	);
	await expect.poll(() => existsSync(outFile), { timeout: 30_000 }).toBe(true);
	expect(JSON.parse(await readFile(outFile, 'utf8')).ok).toBe(true);
}

async function setLocal(page: Page, key: string, value: string): Promise<void> {
	await page.evaluate(
		([k, v]) => {
			localStorage.setItem(k, v);
			window.dispatchEvent(new StorageEvent('storage', { key: k }));
		},
		[key, value] as const,
	);
}

async function resizeWindow(app: ElectronApplication, width: number, height: number): Promise<void> {
	await app.evaluate(
		({ BrowserWindow }, size) => {
			const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
			window?.setSize(size.width, size.height);
		},
		{ width, height },
	);
}

/** The server refuses this terminal's resume, then the Local transport drops. */
async function raiseRecoveryBanner(page: Page, sessionId: string): Promise<Locator> {
	await page.evaluate(async (id) => {
		const seam = window.terminayLocalConnectionFaultTest;
		if (!seam) throw new Error('Local connection fault test seam is unavailable');
		await seam.refuseTerminalAttaches(id);
		await seam.failActiveConnection();
	}, sessionId);
	const banner = terminalPanelForSession(page, sessionId).locator('.terminal-panel-connection-error');
	await expect(banner).toBeVisible({ timeout: RECOVERY_TIMEOUT_MS });
	await expect(banner.getByRole('button', { name: 'Retry connection' })).toBeVisible();
	return banner;
}

async function allowAttaches(page: Page): Promise<void> {
	await page.evaluate(() => window.terminayLocalConnectionFaultTest?.refuseTerminalAttaches(null));
}

/** The topmost element at the centre of the locator is the locator's own. */
async function expectHitTarget(locator: Locator): Promise<void> {
	expect(
		await locator.evaluate((element) => {
			const rect = element.getBoundingClientRect();
			const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
			return hit !== null && (hit === element || element.contains(hit));
		}),
	).toBe(true);
}

async function expectRecovered(page: Page, sessionId: string, marker: string): Promise<void> {
	const panel = terminalPanelForSession(page, sessionId);
	await expect(panel.locator('.terminal-panel-connection-error')).toHaveCount(0, { timeout: RECOVERY_TIMEOUT_MS });
	await submitTerminalCommand(page, `printf '%s\\n' ${marker}`, panel);
	await expect(panel.locator('.xterm-rows')).toContainText(marker, { timeout: 10_000 });
}

async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
	await page.waitForTimeout(250);
	const file = testInfo.outputPath(`${name}.png`);
	await page.screenshot({ path: file });
	await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

type AppHarness = {
	openSettingsWindow: (options: { page: Page; sectionId: string }) => Promise<Page>;
};

/**
 * A light terminal: the default background follows the tab's hue, and its
 * brightness setting at 95% makes the terminal surface pale.
 */
async function useLightTerminalTheme(appHarness: AppHarness, page: Page): Promise<void> {
	const settings = await appHarness.openSettingsWindow({ page, sectionId: 'surface' });
	const row = settings
		.locator('#section-surface .settings-row')
		.filter({ has: settings.getByText('Background', { exact: true }) });
	await row.getByLabel('Tab theme hue brightness').fill('95');
	await expect(row.locator('.settings-tab-hue-brightness-value')).toHaveText('95%');
	await expect(settings.locator('.settings-status')).toContainText('Saved');
	await settings.close();
}

for (const scheme of ['dark', 'light'] as const) {
	test(`the recovery banner sits beside the expanded workflow panel and Retry answers a click (${scheme})`, async ({
		appHarness,
		electronApp,
		mainWindow,
		userDataDir,
	}, testInfo) => {
		test.setTimeout(180_000);
		await mainWindow.emulateMedia({ colorScheme: scheme });
		if (scheme === 'light') await useLightTerminalTheme(appHarness, mainWindow);
		await resizeWindow(electronApp, 1440, 900);
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const terminal = terminalPanelForSession(mainWindow, sessionId);
		await attachWorkflow(mainWindow, userDataDir, terminal);
		await setLocal(mainWindow, PANEL_KEY, 'expanded');
		const workflow = terminal.locator('.workflow-panel');
		await expect(workflow).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });

		// The find bar ends left of the panel and leaves its collapse control usable.
		await terminal.locator('.xterm-screen').click();
		await mainWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+F' : 'Control+F');
		const search = mainWindow.getByRole('search', { name: 'Search terminal output' });
		await expect(search).toBeVisible();
		const panelBox = await boxOf(workflow);
		const searchBox = await boxOf(search);
		expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(panelBox.x);
		expect(searchBox.x).toBeGreaterThanOrEqual((await boxOf(terminal)).x);
		await expectHitTarget(workflow.getByRole('button', { name: 'Collapse workflow' }));
		await shoot(mainWindow, testInfo, `find-beside-panel-${scheme}`);
		await search.getByRole('button', { name: 'Close search' }).click();

		const banner = await raiseRecoveryBanner(mainWindow, sessionId);
		const retry = banner.getByRole('button', { name: 'Retry connection' });
		const bannerBox = await boxOf(banner);
		const retryBox = await boxOf(retry);
		const panelNow = await boxOf(workflow);
		expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(panelNow.x);
		expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(panelNow.x);
		await expectHitTarget(retry);
		await shoot(mainWindow, testInfo, `recovery-banner-beside-panel-${scheme}`);

		// A real pointer click: Playwright refuses if anything else would take it.
		await allowAttaches(mainWindow);
		await retry.click();
		await expectRecovered(mainWindow, sessionId, `retried-by-click-${scheme}`);
	});
}

test('the recovery banner wraps in a narrow terminal and Retry answers Enter beside the collapsed rail', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	await mainWindow.emulateMedia({ colorScheme: 'dark' });
	await resizeWindow(electronApp, 1440, 900);
	const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
	const terminal = terminalPanelForSession(mainWindow, sessionId);
	await attachWorkflow(mainWindow, userDataDir, terminal);
	await setLocal(mainWindow, PANEL_KEY, 'expanded');
	const workflow = terminal.locator('.workflow-panel');
	await expect(workflow).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });

	// Narrow enough that the banner cannot hold its message and button on one line.
	await resizeWindow(electronApp, 900, 700);
	await expect(workflow).toHaveAttribute('data-workflow-mode', /expanded|forced-collapsed/u, { timeout: READY_TIMEOUT_MS });
	const banner = await raiseRecoveryBanner(mainWindow, sessionId);
	const message = banner.locator('p');
	const retry = banner.getByRole('button', { name: 'Retry connection' });
	await expect
		.poll(async () => {
			const bannerBox = await boxOf(banner);
			const panelBox = await boxOf(workflow);
			return bannerBox.x + bannerBox.width - panelBox.x;
		})
		.toBeLessThanOrEqual(0);
	const bannerBox = await boxOf(banner);
	const retryBox = await boxOf(retry);
	const messageBox = await boxOf(message);
	const panelBox = await boxOf(workflow);
	expect(retryBox.x).toBeGreaterThanOrEqual(bannerBox.x);
	expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(bannerBox.x + bannerBox.width);
	expect(retryBox.y + retryBox.height).toBeLessThanOrEqual(bannerBox.y + bannerBox.height);
	expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(panelBox.x);
	// The message wraps around the button rather than under it: the button
	// sits beside the message or, when there is no room, below it.
	const besideMessage = retryBox.x >= messageBox.x + messageBox.width - 1;
	const belowMessage = retryBox.y >= messageBox.y + messageBox.height - 1;
	expect(besideMessage || belowMessage).toBe(true);
	await expectHitTarget(retry);
	await shoot(mainWindow, testInfo, 'recovery-banner-wrapped-narrow');

	// Collapse to the rail: the banner widens to the rail and Retry answers Enter.
	await setLocal(mainWindow, PANEL_KEY, 'collapsed');
	await expect(workflow).toHaveAttribute('data-workflow-mode', /^(forced-)?collapsed$/u, { timeout: READY_TIMEOUT_MS });
	await expect
		.poll(async () => {
			const box = await boxOf(banner);
			const rail = await boxOf(workflow);
			return box.x + box.width - rail.x;
		})
		.toBeLessThanOrEqual(0);
	await expectHitTarget(retry);
	await shoot(mainWindow, testInfo, 'recovery-banner-beside-rail');
	await allowAttaches(mainWindow);
	await retry.focus();
	await expect(retry).toBeFocused();
	await mainWindow.keyboard.press('Enter');
	await expectRecovered(mainWindow, sessionId, 'retried-by-enter');
});

test('the recovery banner is drawn above the narrow-pane workflow overlay', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	await mainWindow.emulateMedia({ colorScheme: 'dark' });
	await resizeWindow(electronApp, 1440, 900);
	const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
	const terminal = terminalPanelForSession(mainWindow, sessionId);
	await attachWorkflow(mainWindow, userDataDir, terminal);
	await setLocal(mainWindow, PANEL_KEY, 'collapsed');
	const workflow = terminal.locator('.workflow-panel');
	await resizeWindow(electronApp, 560, 640);
	await expect(workflow).toHaveAttribute('data-workflow-mode', 'forced-collapsed', { timeout: READY_TIMEOUT_MS });

	const banner = await raiseRecoveryBanner(mainWindow, sessionId);
	const retry = banner.getByRole('button', { name: 'Retry connection' });
	// The narrowest terminal: the banner keeps its button whole and clear of
	// the message, left of the rail.
	{
		const bannerBox = await boxOf(banner);
		const messageBox = await boxOf(banner.locator('p'));
		const buttonBox = await boxOf(retry);
		const rail = await boxOf(workflow);
		expect(buttonBox.x).toBeGreaterThanOrEqual(bannerBox.x);
		expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(bannerBox.x + bannerBox.width);
		expect(bannerBox.x + bannerBox.width).toBeLessThanOrEqual(rail.x);
		expect(
			buttonBox.x >= messageBox.x + messageBox.width - 1 ||
				buttonBox.y >= messageBox.y + messageBox.height - 1,
		).toBe(true);
		await shoot(mainWindow, testInfo, 'recovery-banner-narrowest-pane');
	}
	await workflow.getByRole('button', { name: 'Expand workflow' }).click();
	const overlay = workflow.getByRole('dialog', { name: 'Workflow' });
	await expect(overlay).toBeVisible();
	// The overlay floats over the terminal's right side, where Retry sits; the
	// banner is drawn above it.
	const overlayBox = await boxOf(overlay);
	const retryBox = await boxOf(retry);
	expect(retryBox.x + retryBox.width).toBeGreaterThan(overlayBox.x);
	await expectHitTarget(retry);
	await shoot(mainWindow, testInfo, 'recovery-banner-over-narrow-overlay');

	await allowAttaches(mainWindow);
	await retry.click();
	await expectRecovered(mainWindow, sessionId, 'retried-over-overlay');
});

test('the recovery banner sits above the horizontal workflow drawer', async ({
	electronApp,
	mainWindow,
	userDataDir,
}, testInfo) => {
	test.setTimeout(180_000);
	await mainWindow.emulateMedia({ colorScheme: 'dark' });
	await resizeWindow(electronApp, 1440, 900);
	try {
		const sessionId = await settledTerminalSessionId(mainWindow.locator('.terminal-panel:visible'));
		const terminal = terminalPanelForSession(mainWindow, sessionId);
		await setLocal(mainWindow, LAYOUT_KEY, 'horizontal');
		await setLocal(mainWindow, DRAWER_KEY, 'expanded');
		await attachWorkflow(mainWindow, userDataDir, terminal);
		const drawer = terminal.locator('.workflow-drawer');
		await expect(drawer).toHaveAttribute('data-workflow-mode', 'expanded', { timeout: READY_TIMEOUT_MS });

		const banner = await raiseRecoveryBanner(mainWindow, sessionId);
		const retry = banner.getByRole('button', { name: 'Retry connection' });
		const bannerBox = await boxOf(banner);
		const drawerBox = await boxOf(drawer);
		expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(drawerBox.y);
		await expectHitTarget(retry);
		await shoot(mainWindow, testInfo, 'recovery-banner-above-drawer');

		await allowAttaches(mainWindow);
		await retry.click();
		await expectRecovered(mainWindow, sessionId, 'retried-above-drawer');
	} finally {
		await mainWindow
			.evaluate(
				([layout, drawerKey]) => {
					localStorage.removeItem(layout);
					localStorage.removeItem(drawerKey);
				},
				[LAYOUT_KEY, DRAWER_KEY] as const,
			)
			.catch(() => undefined);
	}
});
