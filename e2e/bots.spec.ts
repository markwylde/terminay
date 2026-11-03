import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { activeHome, frontHomeTab } from './support/home-tabs';

/**
 * Home › Bots, end to end. The suite runs against a Docker-compatible socket API fixture
 * whose containers host a fake ACP agent, so it
 * needs no container engine, image, or agent account. Writing `engine-down`
 * into the fake root makes the engine unreachable. A message containing
 * `hold` keeps its turn open until it is
 * cancelled, and one containing `ignore-cancel` also ignores the cancel.
 */

const CLAUDE = 'com.terminay.builtin-agents/claude-code';
const CODEX = 'com.terminay.builtin-agents/codex';
const TOKEN = 'e2e-token-value-7f3a';

const fakeRoot = (tempDir: string) => path.join(tempDir, 'fake-bots');

async function setEngineDown(tempDir: string, down: boolean): Promise<void> {
	await mkdir(fakeRoot(tempDir), { recursive: true });
	const flag = path.join(fakeRoot(tempDir), 'engine-down');
	if (down) await writeFile(flag, '');
	else await rm(flag, { force: true });
}

async function openBots(page: Page): Promise<Locator> {
	await page.getByRole('button', { name: 'Home', exact: true }).click();
	await page.locator('[data-terminay-home-section-tab="bots"]').click();
	await expect(activeHome(page)).toHaveAttribute(
		'data-terminay-home-view',
		'bots',
	);
	return frontHomeTab(page);
}

async function engineReady(page: Page): Promise<void> {
	const dashboard = await openBots(page);
	await dashboard.getByRole('button', { name: 'Check again' }).click();
	await expect(
		dashboard.locator('[data-terminay-bots-engine="ready"]'),
	).toBeVisible();
	const build = dashboard.getByRole('button', { name: 'Build image' });
	if (await build.isVisible()) await build.click();
	await expect(
		dashboard.locator('[data-terminay-bots-image="current"]'),
	).toBeVisible({ timeout: 30_000 });
}

/** Creates a Claude Code bot, signs it in with an API key, and returns its tab. */
async function createBot(
	page: Page,
	name: string,
	signIn: 'token' | 'none' = 'token',
): Promise<Locator> {
	const dashboard = await openBots(page);
	await dashboard.locator('[data-terminay-bots-new]').first().click();
	const dialog = page.locator('[data-terminay-bots-new-dialog]');
	await dialog.locator('[data-terminay-bots-new-name]').fill(name);
	await dialog
		.locator('[data-terminay-bots-new-agent]')
		.selectOption(CLAUDE);
	await dialog.locator('[data-terminay-bots-new-create]').click();
	const tab = frontHomeTab(page);
	await expect(
		tab.locator('[data-terminay-bot-panel="profile"]'),
	).toBeVisible();
	if (signIn === 'none') {
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'none',
		);
		return tab;
	}
	const token = tab.locator('[data-terminay-bot-token="ANTHROPIC_API_KEY"]');
	await token
		.locator('[data-terminay-bot-token-input="ANTHROPIC_API_KEY"]')
		.fill(TOKEN);
	await token.locator('button[type="submit"]').click();
	await expect(token).toHaveAttribute(
		'data-terminay-bot-token-configured',
		'true',
	);
	// The choice is saved to the server, and checks once the profile returns.
	await tab
		.locator('[data-terminay-bot-signin-option="ANTHROPIC_API_KEY"]')
		.click();
	await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
		'data-terminay-bot-signin',
		'token',
	);
	return tab;
}

async function chat(tab: Locator): Promise<Locator> {
	await tab.locator('[data-terminay-bot-mode-button="chat"]').click();
	return tab;
}

async function send(tab: Locator, text: string): Promise<void> {
	await tab.locator('[data-terminay-bot-composer]').fill(text);
	await tab.locator('[data-terminay-bot-send]').click();
}

async function newTrigger(
	tab: Locator,
	name: string,
	prompt: string,
): Promise<Locator> {
	await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
	await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
	await tab.locator('[data-terminay-bot-trigger-new]').click();
	const page = tab.page();
	const editor = page.locator('[data-terminay-bot-trigger-editor]');
	await editor.locator('[data-terminay-bot-trigger-field="name"]').fill(name);
	await editor.locator('[data-terminay-bot-trigger-kind="every"]').click();
	await editor
		.locator('[data-terminay-bot-trigger-field="prompt"]')
		.fill(prompt);
	await editor.locator('[data-terminay-bot-trigger-save]').click();
	await expect(editor).toHaveCount(0);
	const row = tab
		.locator('[data-terminay-bot-trigger]')
		.filter({ hasText: name });
	await expect(row).toHaveCount(1);
	return row;
}

async function openBotChat(page: Page, name: string): Promise<Locator> {
	const dashboard = await openBots(page);
	await dashboard
		.locator('[data-terminay-bot-card]')
		.filter({ hasText: name })
		.getByRole('button', { name: 'Chat' })
		.click();
	const tab = frontHomeTab(page);
	await expect(tab.locator('[data-terminay-bot-composer]')).toBeVisible();
	return tab;
}

test.describe('Home › Bots', () => {
	test('a bot is created while Docker is down, and chats once Docker is up', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, true);
		const dashboard = await openBots(mainWindow);
		await expect(
			dashboard.locator('[data-terminay-bots-engine-reason="not-running"]'),
		).toBeVisible();

		const tab = await createBot(mainWindow, 'Wren');

		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		await mainWindow.locator('[data-terminay-home-tab^="bot:"]').click();
		await chat(tab);
		await send(tab, 'hello');

		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript).toContainText('hello');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await expect(tab.locator('[data-terminay-bot-typing]')).toHaveCount(0, {
			timeout: 30_000,
		});
		// The token never reaches the page.
		expect(await mainWindow.content()).not.toContain(TOKEN);
	});

	test('a bot explains an engine outage in place and can still be deleted with its home', async ({ mainWindow, tempDir }) => {
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Recoverable');
		await setEngineDown(tempDir, true);
		const dashboard = await openBots(mainWindow);
		await dashboard.getByRole('button', { name: 'Check again' }).click();
		await expect(dashboard.locator('[data-terminay-bots-engine-reason="not-running"]')).toBeVisible();
		await mainWindow.locator('[data-terminay-home-tab^="bot:"]').click();
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText('not running');
		await chat(tab);
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText('Check again');
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-delete]').click();
		await tab.locator('[data-terminay-bot-delete-home]').check();
		await tab.locator('[data-terminay-bot-delete-confirm]').click();
		await expect(await openBots(mainWindow)).toContainText('Removal is pending');
		await expect((await openBots(mainWindow)).locator('[data-terminay-bot-card]')).toHaveCount(0);
	});

	test('Stop ends a held turn, whether the agent honours the cancel or not', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Kite'));

		for (const prompt of ['hold', 'hold ignore-cancel']) {
			await send(tab, prompt);
			const stop = tab.locator('[data-terminay-bot-stop]');
			await expect(stop).toBeVisible({ timeout: 30_000 });
			await stop.click();
			await expect(stop).toHaveCount(0, { timeout: 30_000 });
            await expect(tab.locator('.bots-sess__m').first()).toContainText('Stopped');
		}
		// No session process is left behind in the fake engine.
		await expect
			.poll(async () =>
				(await readdir(fakeRoot(tempDir))).filter((n) => n.startsWith('pid-')),
			)
			.toEqual([]);
	});

	test('deleting a bot can keep its home', async ({ mainWindow, tempDir }) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Moth'));
		await send(tab, 'hello');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);
		const botId = await tab
			.locator('[data-terminay-bot-tab]')
			.getAttribute('data-terminay-bot-tab');
		expect(botId).toMatch(/^[a-z0-9]{12}$/);
		const home = path.join(
			fakeRoot(tempDir),
			`volume-terminay-bot-${botId}-home.json`,
		);
		expect(existsSync(home)).toBe(true);

		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-delete]').click();
		await expect(
			tab.locator('[data-terminay-bot-delete-home]'),
		).not.toBeChecked();
		await tab.locator('[data-terminay-bot-delete-confirm]').click();

		const dashboard = await openBots(mainWindow);
		await expect(
			dashboard.locator(`[data-terminay-bot-card="${botId}"]`),
		).toHaveCount(0);
		expect(existsSync(home)).toBe(true);
	});
	test('Run now and later messages use separate executions with one shared log', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Finch'));
		await send(tab, 'hello');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);

		const row = await newTrigger(tab, 'Nightly check', 'check the build');
		await row.locator('[data-terminay-bot-trigger-run]').click();

		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		const fired = tab
			.locator('[data-terminay-bot-session-row]')
			.filter({ hasText: 'Nightly check' });
		await expect(fired).toHaveCount(1, { timeout: 30_000 });
		await expect(fired).toHaveAttribute(
			'data-terminay-bot-session-state',
			'completed',
			{ timeout: 30_000 },
		);

		await chat(tab);
        await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText('hello');
        await send(tab,'again');
        await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText('again');
        await expect(tab.locator('.bots-sess')).toHaveCount(3);

	});

    test('a new message completes while an older execution is held',async({mainWindow,tempDir})=>{
        await setEngineDown(tempDir,false);await engineReady(mainWindow);const tab=await chat(await createBot(mainWindow,'Wagtail'));
        await send(tab,'hold');await expect(tab.locator('[data-terminay-bot-stop]')).toBeVisible({timeout:30000});
        await send(tab,'next');await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText('secret',{timeout:30000});
        await expect(tab.locator('.bots-sess')).toHaveCount(2);await expect(tab.locator('[data-terminay-bot-stop]')).toHaveCount(1);await tab.locator('[data-terminay-bot-stop]').click();
    });

	test('a turn running when Terminay is killed comes back interrupted', async ({
		electronApp,
		mainWindow,
		tempDir,
		userDataDir,
	}, testInfo) => {
		test.setTimeout(180_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Plover'));
		await send(tab, 'hold');
		await expect(tab.locator('[data-terminay-bot-stop]')).toBeVisible({
			timeout: 30_000,
		});
		// Stop shows while the turn is still queued; wait until the agent is
		// actually holding it.
		await expect
			.poll(
				async () =>
					(await readdir(fakeRoot(tempDir))).some((n) => n.startsWith('pid-')),
				{ timeout: 30_000 },
			)
			.toBe(true);

		// A crash, not a quit: a quit ends sessions cleanly as stopped.
		// The launched process can be a wrapper; kill Electron's main process.
		const mainPid = await electronApp.evaluate(() => process.pid);
		// Playwright starts the app as a process group. A crash takes the whole
		// group: helpers and engine children left behind would hold the app's
		// pipes open, and the test worker could never finish.
		const group = electronApp.process().pid;
		try {
			if (group) process.kill(-group, 'SIGKILL');
			process.kill(mainPid, 'SIGKILL');
		} catch {
			/* already gone */
		}
		await expect
			.poll(() => {
				try {
					process.kill(mainPid, 0);
					return true;
				} catch {
					return false;
				}
			})
			.toBe(false);
		const relaunched = await launchDesktopApp({
			tempDir,
			userDataDir,
			testInfo,
		});
		try {
			const window = await prepareWindow(
				await relaunched.electronApp.firstWindow(),
			);
			const again = await openBotChat(window, 'Plover');
			await again
				.locator('[data-terminay-bot-mode-button="configure"]')
				.click();
			await again.locator('[data-terminay-bot-config-tab="sessions"]').click();
			await expect(
				again.locator('[data-terminay-bot-session-state="interrupted"]'),
			).toHaveCount(1, { timeout: 30_000 });
			// The held agent did not survive the restart.
			await expect
				.poll(async () =>
					(await readdir(fakeRoot(tempDir))).filter((n) =>
						n.startsWith('pid-'),
					),
				)
				.toEqual([]);
		} finally {
			await relaunched.close().catch(() => undefined);
		}
	});

	test('a Codex bot signs in with ChatGPT in its own container, and signs out', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const dashboard = await openBots(mainWindow);
		await dashboard.locator('[data-terminay-bots-new]').first().click();
		const dialog = mainWindow.locator('[data-terminay-bots-new-dialog]');
		await dialog.locator('[data-terminay-bots-new-name]').fill('Tern');
		await dialog.locator('[data-terminay-bots-new-agent]').selectOption(CODEX);
		await dialog.locator('[data-terminay-bots-new-create]').click();
		const tab = frontHomeTab(mainWindow);
		const device = tab.locator('[data-terminay-bot-device]');
		await expect(device).toHaveAttribute('data-terminay-bot-device', 'signed-out');

		// The fake `codex login --device-auth` prints its code and succeeds.
		await tab.locator('[data-terminay-bot-device-start]').click();
		await expect(tab.locator('[data-terminay-bot-device-terminal]')).toContainText(
			'TEST-CODE',
			{ timeout: 30_000 },
		);
		await expect(device).toHaveAttribute('data-terminay-bot-device', 'signed-in', {
			timeout: 30_000,
		});
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'device',
		);
		await tab
			.locator('[data-terminay-bot-device-terminal] button', { hasText: 'Close' })
			.click();

		await tab.locator('[data-terminay-bot-device-signout]').click();
		await expect(device).toHaveAttribute('data-terminay-bot-device', 'signed-out', {
			timeout: 30_000,
		});
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'none',
		);
	});

	test('a bot that is not signed in refuses a message and links to Sign-in', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Shrike', 'none'));
		await send(tab, 'hello');
		const note = tab.locator('[data-terminay-bot-chat-error]');
		await expect(note).toContainText('not signed in');
		await tab.locator('[data-terminay-bot-open-signin]').click();
		await expect(tab.locator('[data-terminay-bot-panel="profile"]')).toBeVisible();
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'none',
		);
	});
});
