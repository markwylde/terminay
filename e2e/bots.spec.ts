import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, launchDesktopApp, test } from './fixtures';
import { prepareWindow } from './support/app';
import { activeHome, frontHomeTab } from './support/home-tabs';

/**
 * Home › Bots, end to end. The suite runs against a Docker-compatible socket API fixture
 * whose containers host a fake native agent, so it
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
	await page.locator('[data-terminay-home-control="true"]').click();
	await page.locator('[data-terminay-home-section-tab="bots"]').click();
	await expect(activeHome(page)).toHaveAttribute(
		'data-terminay-home-view',
		'bots',
	);
	return frontHomeTab(page);
}

/** Chooses an option in one of the Bots grouped dropdowns. */
async function pick(
	scope: Locator,
	label: string,
	value: string,
): Promise<void> {
	await scope.getByRole('combobox', { name: label, exact: true }).click();
	await scope
		.getByRole('listbox', { name: label, exact: true })
		.locator(`[data-grouped-select-value="${value}"]`)
		.click();
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
	await dialog.locator('[data-terminay-bots-new-agent]').selectOption(CLAUDE);
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
	await pick(editor, 'Source', 'every');
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

test.describe('Home: Bots', () => {
	test('image build opens a compact banner and a live step timeline with failure and retry', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await prepareWindow(mainWindow);
		await mkdir(fakeRoot(tempDir), { recursive: true });
		await writeFile(path.join(fakeRoot(tempDir), 'build-delay'), '2000');
		await writeFile(path.join(fakeRoot(tempDir), 'build-fail'), '');
		const dashboard = await openBots(mainWindow);
		await dashboard.getByRole('button', { name: 'Check again' }).click();
		await dashboard.getByRole('button', { name: 'Build image' }).click();
		const banner = dashboard.locator('[data-terminay-build-banner]');
		await expect(banner).toBeVisible();
		expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(40);
		await banner.click();
		const progress = mainWindow.locator('[data-terminay-build-page]');
		await expect(
			progress.getByRole('heading', { name: 'Building your bot environment' }),
		).toBeVisible();
		await expect(
			progress.locator('[data-terminay-build-step="cached"]'),
		).toBeVisible();
		await expect(
			progress.getByRole('heading', {
				name: 'Image build failed',
				exact: true,
			}),
		).toBeVisible();
		await expect(
			progress.locator('[data-terminay-build-step="failed"]').first(),
		).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('image-build-failed.png'),
		});
		await rm(path.join(fakeRoot(tempDir), 'build-fail'));
		await writeFile(path.join(fakeRoot(tempDir), 'build-delay'), '6000');
		await progress.getByRole('button', { name: 'Retry build' }).click();
		await expect(
			progress.getByRole('heading', { name: 'Building your bot environment' }),
		).toBeVisible();
		await progress.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(progress).toHaveCount(0);
		await dashboard.locator('[data-terminay-build-banner]').click();
		const buildId = await progress.getAttribute('data-terminay-build-id');
		await mainWindow.reload();
		await openBots(mainWindow);
		await mainWindow.locator('[data-terminay-build-banner]').click();
		await expect(progress).toHaveAttribute('data-terminay-build-id', buildId!);
		await expect(
			progress.getByRole('heading', { name: 'Your bot image is ready' }),
		).toBeVisible({ timeout: 30000 });
		await expect(
			progress.getByRole('heading', { name: 'Publishing the local bot image' }),
		).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('image-build-completed.png'),
		});
		await mainWindow.setViewportSize({ width: 430, height: 850 });
		expect(
			await progress.evaluate((el) => el.scrollWidth <= el.clientWidth),
		).toBe(true);
		await mainWindow.screenshot({
			path: testInfo.outputPath('image-build-mobile.png'),
		});
		await mainWindow.setViewportSize({ width: 1280, height: 850 });
		await progress.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(progress).toHaveCount(0);

		// The success notice can be dismissed, and stays dismissed.
		const ready = frontHomeTab(mainWindow).locator(
			'[data-terminay-build-banner-state="completed"]',
		);
		await expect(ready).toContainText('Bot image ready');
		await ready.locator('[data-terminay-build-banner-dismiss]').click();
		await expect(ready).toHaveCount(0);
		await mainWindow.reload();
		await openBots(mainWindow);
		await expect(ready).toHaveCount(0);

		// Once seen, leaving and coming back retires it without a click.
		await mainWindow.evaluate(() =>
			localStorage.removeItem('terminay.bots.buildBannerDismissed'),
		);
		await mainWindow.reload();
		await openBots(mainWindow);
		await expect(ready).toBeVisible();
		await mainWindow.locator('[data-terminay-home-control="true"]').click();
		await mainWindow.locator('[data-terminay-home-section-tab="tabs"]').click();
		await openBots(mainWindow);
		await expect(ready).toHaveCount(0);
	});

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

	test('a bot explains an engine outage in place and can still be deleted with its home', async ({
		mainWindow,
		tempDir,
	}) => {
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Recoverable');
		await setEngineDown(tempDir, true);
		const dashboard = await openBots(mainWindow);
		await dashboard.getByRole('button', { name: 'Check again' }).click();
		await expect(
			dashboard.locator('[data-terminay-bots-engine-reason="not-running"]'),
		).toBeVisible();
		await mainWindow.locator('[data-terminay-home-tab^="bot:"]').click();
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText(
			'not running',
		);
		await chat(tab);
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText(
			'Check again',
		);
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-delete]').click();
		await tab.locator('[data-terminay-bot-delete-home]').check();
		await tab.locator('[data-terminay-bot-delete-confirm]').click();
		await expect(await openBots(mainWindow)).toContainText(
			'Removal is pending',
		);
		await expect(
			(await openBots(mainWindow)).locator('[data-terminay-bot-card]'),
		).toHaveCount(0);
	});

	test('reset at the same socket shows recovery on old and new bots, then rebuilds in place', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await engineReady(mainWindow);
		let tab = await chat(await createBot(mainWindow, 'Before reset'));
		await send(tab, 'before reset');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);
		await expect(tab.locator('[data-terminay-bot-typing]')).toHaveCount(0);
		// Completion is visible before supervisor/relay cleanup finishes. Reset
		// the fixture only after the original execution has released its processes.
		await expect
			.poll(
				async () =>
					(await readdir(fakeRoot(tempDir))).filter((n) => n.startsWith('pid-'))
						.length,
			)
			.toBe(0);
		await setEngineDown(tempDir, true);
		for (const file of await readdir(fakeRoot(tempDir))) {
			if (/^(container|volume|network|image)-/.test(file))
				await rm(path.join(fakeRoot(tempDir), file));
		}
		await setEngineDown(tempDir, false);
		const dashboard = await openBots(mainWindow);
		await dashboard.getByRole('button', { name: 'Check again' }).click();
		await expect(
			dashboard.locator('[data-terminay-bots-engine-reason="engine-changed"]'),
		).toBeVisible();
		tab = await openBotChat(mainWindow, 'Before reset');
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText(
			'Use this engine',
		);
		tab = await createBot(mainWindow, 'After reset');
		const recovery = tab.locator('[data-terminay-bot-recovery]');
		await expect(recovery).toContainText('identity marker is missing');
		await expect(
			recovery.getByRole('button', { name: 'Use this engine' }),
		).toBeInViewport({ ratio: 1 });
		await mainWindow.screenshot({
			path: testInfo.outputPath('engine-reset-recovery.png'),
		});
		await recovery.getByRole('button', { name: 'Use this engine' }).click();
		await expect(recovery.getByRole('alertdialog')).toBeVisible();
		await recovery.locator('[data-terminay-bots-engine-confirm]').click();
		await expect(
			recovery.getByRole('button', { name: 'Build image' }),
		).toBeVisible();
		await recovery.getByRole('button', { name: 'Build image' }).click();
		await expect(
			recovery.locator('[data-terminay-bots-image="building"]'),
		).toHaveCount(0);
		await expect(
			recovery.getByRole('button', { name: 'Create environment' }),
		).toBeVisible();
		await recovery.getByRole('button', { name: 'Create environment' }).click();
		await chat(tab);
		await send(tab, 'after reset');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);
		tab = await openBotChat(mainWindow, 'Before reset');
		await send(tab, 'old bot recovered');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'old bot recovered',
		);
		await expect(tab.locator('.bots-sess')).toHaveCount(2);
		const recoveredOutcome = tab.locator('.bots-sess__m').first();
		await expect(recoveredOutcome).toContainText(/Completed|Failed/, {
			timeout: 30_000,
		});
		if ((await recoveredOutcome.textContent())?.includes('Failed')) {
			await tab.locator('.bots-sess').first().click();
			const detail = tab.locator('[data-terminay-bot-session]');
			await expect(detail).toBeVisible();
			throw new Error(
				`Recovered execution failed: ${await detail.textContent()}`,
			);
		}
		await expect(recoveredOutcome).toContainText('Completed');
		expect(await mainWindow.content()).not.toContain('query failed');
		await mainWindow.screenshot({
			path: testInfo.outputPath('engine-reset-recovered.png'),
		});
	});

	test('first chat builds a missing image and creates its environment without a dashboard build', async ({
		mainWindow,
		tempDir,
	}) => {
		const tab = await chat(await createBot(mainWindow, 'First start'));
		await expect(tab.locator('[data-terminay-bot-recovery]')).toContainText(
			'Build image',
		);
		expect(
			(await readdir(fakeRoot(tempDir))).filter((file) =>
				file.startsWith('image-'),
			),
		).toEqual([]);
		await send(tab, 'build automatically');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);
		await expect(tab.locator('.bots-sess__m').first()).toContainText(
			'Completed',
			{ timeout: 30_000 },
		);
		expect(
			(await readdir(fakeRoot(tempDir))).some((file) =>
				file.startsWith('image-'),
			),
		).toBe(true);
	});

	test('on a phone, Bots is a compact section page with status tabs, avatar rows, and the engine card', async ({
		electronApp,
		mainWindow,
	}, testInfo) => {
		await engineReady(mainWindow);
		await createBot(mainWindow, 'Phone Bot');
		await openBots(mainWindow);
		const nativeWindow = await electronApp.browserWindow(mainWindow);
		const wide = await nativeWindow.evaluate((window) => window.getBounds());
		await nativeWindow.evaluate((window, next) => window.setBounds(next), {
			...wide,
			width: 390,
			height: 780,
		});
		const page = frontHomeTab(mainWindow).locator(
			'[data-compact-section="bots"]',
		);
		await expect(page).toBeVisible({ timeout: 20_000 });
		for (const id of ['all', 'working', 'needs-you', 'stopped'])
			await expect(page.locator(`[data-compact-tab="${id}"]`)).toBeVisible();
		await expect(
			page.locator('[data-compact-tab="all"] [data-compact-tab-count]'),
		).toHaveText('1');
		await expect(page).toContainText('Phone Bot');
		// The engine is one card; it opens the sheet and focus comes back to it.
		const card = page.locator('[data-terminay-bots-engine-card]');
		await card.click();
		const sheet = mainWindow.locator('[data-compact-sheet="true"]');
		await expect(sheet).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bots-phone-engine.png'),
		});
		await mainWindow.keyboard.press('Escape');
		await expect(sheet).toHaveCount(0);
		await expect(card).toBeFocused();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bots-phone.png'),
		});
		await nativeWindow.evaluate((window, next) => window.setBounds(next), wide);
		await expect(page).toHaveCount(0, { timeout: 20_000 });
	});

	test('two bots stay responsive and Overview helper lifecycle events do not refetch or spawn more helpers', async ({
		mainWindow,
		tempDir,
	}) => {
		test.setTimeout(60_000);
		await engineReady(mainWindow);
		for (const name of ['Loop One', 'Loop Two']) {
			const tab = await chat(await createBot(mainWindow, name));
			await send(tab, 'hello');
			await expect(tab.locator('.bots-sess__m').first()).toContainText(
				'Completed',
				{ timeout: 30_000 },
			);
			await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		}
		const helperCount = async () =>
			(await readFile(path.join(fakeRoot(tempDir), 'calls.jsonl'), 'utf8'))
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
				.filter(
					(call) =>
						call.args?.[0] === 'container' &&
						call.args?.[1] === 'create' &&
						String(call.args?.[3]).startsWith('helper-') &&
						call.args.includes('terminay.role=helper'),
				).length;
		for (let pass = 0; pass < 3; pass++) {
			const dashboard = await openBots(mainWindow);
			await expect(dashboard.locator('[data-terminay-bot-card]')).toHaveCount(
				2,
			);
			await dashboard.locator('[data-terminay-bots-search]').fill('Loop');
			await expect(dashboard.locator('[data-terminay-bot-card]')).toHaveCount(
				2,
			);
		}
		expect(await helperCount()).toBe(0);
		const tab = await openBotChat(mainWindow, 'Loop One');
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="environment"]').click();
		await expect(
			tab.locator('[data-terminay-bot-env-state="running"]'),
		).toBeVisible();
		await expect.poll(helperCount).toBe(1);
		await tab.locator('[data-terminay-bot-env-details]').click();
		await tab.locator('[data-terminay-bot-env-refresh]').click();
		await expect.poll(helperCount).toBe(2);
		await expect
			.poll(
				async () =>
					(await readFile(path.join(fakeRoot(tempDir), 'events.jsonl'), 'utf8'))
						.split('\n')
						.filter(
							(line) =>
								line.includes('terminay.role') && line.includes('destroy'),
						).length,
			)
			.toBe(2);
		await openBots(mainWindow);
		// Observe longer than several renderer debounce windows: the old loop
		// repeatedly created helpers throughout this idle period.
		await mainWindow.waitForTimeout(1000);
		expect(await helperCount()).toBe(2);
		const dashboard = await openBots(mainWindow);
		await dashboard.locator('[data-terminay-bots-search]').fill('Two');
		await expect(dashboard.locator('[data-terminay-bot-card]')).toHaveCount(1);
	});

	test('MCP permission failure in the bundled chat path fails visibly before agent launch', async ({
		mainWindow,
		tempDir,
	}) => {
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'MCP denied'));
		await writeFile(
			path.join(fakeRoot(tempDir), 'mcp-state-denied.json'),
			'true',
		);
		await send(tab, 'hello');
		await expect(tab.locator('.bots-sess__m').first()).toContainText('Failed', {
			timeout: 30_000,
		});
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await tab.locator('[data-terminay-bot-session-row]').first().click();
		await expect(tab.locator('[data-terminay-bot-session]')).toContainText(
			'adapter could not use its runtime socket',
		);
		await expect(
			tab.locator('[data-terminay-bot-session-lifetime]'),
		).toContainText('Desktop apps stay open');
		await expect(
			tab.locator('[data-terminay-bot-session-lifetime]'),
		).toContainText('Stopping the bot container ends desktop apps');
		await tab.locator('[data-terminay-bot-runner] summary').click();
		await expect(tab.locator('[data-terminay-bot-runner]')).toContainText(
			'runtime socket permission denied',
		);
		const calls = (
			await readFile(path.join(fakeRoot(tempDir), 'calls.jsonl'), 'utf8')
		)
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
		expect(calls.filter((call) => call.agent)).toEqual([]);
	});

	test('provider completion without MCP tools shows Failed and actionable Runner output', async ({
		mainWindow,
		tempDir,
	}) => {
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'MCP silent failure'));
		await writeFile(
			path.join(fakeRoot(tempDir), 'mcp-state-silent.json'),
			'true',
		);
		await send(tab, 'hi');
		await expect(tab.locator('.bots-sess__m').first()).toContainText('Failed', {
			timeout: 30_000,
		});
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await tab.locator('[data-terminay-bot-session-row]').first().click();
		await expect(tab.locator('[data-terminay-bot-session]')).toContainText(
			'did not connect to terminay_bot',
		);
		await tab.locator('[data-terminay-bot-runner] summary').click();
		await expect(tab.locator('[data-terminay-bot-runner]')).toContainText(
			'MCP startup details',
		);
	});

	test('a failed session wakes its bot with a failure investigation that links back, and the profile switch turns it off', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		test.setTimeout(120_000);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Failure aware'));
		await writeFile(
			path.join(fakeRoot(tempDir), 'mcp-state-denied.json'),
			'true',
		);
		await send(tab, 'hello');
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		const rows = tab.locator('[data-terminay-bot-session-row]');
		const investigation = rows.filter({ hasText: 'Investigate failure' });
		await expect(investigation).toHaveCount(1, { timeout: 30_000 });
		await tab
			.locator('[data-terminay-bot-sessions-origin]')
			.selectOption('failure');
		await expect(rows).toHaveCount(1);
		await investigation.click();
		const failures = tab.locator('[data-terminay-bot-session-failures]');
		await expect(failures).toContainText('Execution failed');
		await expect(failures.locator('.bots-failure')).toHaveCount(1);
		await mainWindow.screenshot({
			path: testInfo.outputPath('failure-investigation.png'),
		});
		const link = failures.locator('[data-terminay-bot-failure-session]');
		const failedId = await link.getAttribute(
			'data-terminay-bot-failure-session',
		);
		await link.click();
		await expect(
			tab.locator(`[data-terminay-bot-session="${failedId}"]`),
		).toBeVisible();
		await expect(
			tab.locator('[data-terminay-bot-sessions-origin]'),
		).toHaveValue('all');

		await tab.locator('[data-terminay-bot-config-tab="profile"]').click();
		const toggle = tab.locator('[data-terminay-bot-investigate-failures]');
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await toggle.click();
		await tab.locator('[data-terminay-bot-profile-save]').click();
		await expect(tab.locator('.bots-done')).toContainText('Saved');
		await mainWindow.screenshot({
			path: testInfo.outputPath('investigate-failures-off.png'),
		});
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await tab.locator('[data-terminay-bot-config-tab="profile"]').click();
		await expect(toggle).toHaveAttribute('aria-checked', 'false');

		await chat(tab);
		await send(tab, 'again');
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		// Two failed chats and the one investigation from the first.
		await expect(
			rows.filter({ has: tab.page().locator('.bots-state--failed') }),
		).toHaveCount(3, {
			timeout: 30_000,
		});
		// An investigation would start straight after the failure; give it time to appear.
		await mainWindow.waitForTimeout(2_000);
		await expect(investigation).toHaveCount(1);
	});

	test('Terminay MCP access is off by default, saves on, and explains when the server has MCP off', async ({
		appHarness,
		mainWindow,
	}, testInfo) => {
		test.setTimeout(120_000);
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Workspace helper');
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="profile"]').click();
		const toggle = tab.locator('[data-terminay-bot-terminay-mcp]');
		const hint = tab.locator('[data-terminay-bot-terminay-mcp-disabled]');
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(hint).toHaveCount(0);
		await toggle.scrollIntoViewIfNeeded();
		await mainWindow.screenshot({
			path: testInfo.outputPath('terminay-mcp-access-off.png'),
		});

		await toggle.click();
		await tab.locator('[data-terminay-bot-profile-save]').click();
		await expect(tab.locator('.bots-done')).toContainText('Saved');
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await tab.locator('[data-terminay-bot-config-tab="profile"]').click();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await toggle.scrollIntoViewIfNeeded();
		await mainWindow.screenshot({
			path: testInfo.outputPath('terminay-mcp-access-on.png'),
		});

		const settings = await appHarness.openSettingsWindow({
			page: mainWindow,
			sectionId: 'terminay-mcp',
		});
		await settings.getByLabel('Enable Terminay MCP server').uncheck();
		await expect(settings.locator('.settings-status')).toContainText('Saved');
		await settings.close();
		await expect(hint).toBeVisible();
		await expect(hint).toContainText('Settings › AI › Terminay MCP');
		await expect(toggle).toBeEnabled();
		await hint.scrollIntoViewIfNeeded();
		await mainWindow.screenshot({
			path: testInfo.outputPath('terminay-mcp-access-server-off.png'),
		});
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
			await expect(tab.locator('.bots-sess__m').first()).toContainText(
				'Stopped',
			);
		}
		// No session process is left behind in the fake engine.
		await expect
			.poll(async () =>
				(await readdir(fakeRoot(tempDir))).filter((n) => n.startsWith('pid-')),
			)
			.toEqual([]);
	});

	test('Files row actions live in the app context menu, by button, right-click and keyboard', async ({
		electronApp,
		mainWindow,
		tempDir,
	}, testInfo) => {
		test.setTimeout(90_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Filer');
		await tab.locator('[data-terminay-bot-config-tab="environment"]').click();
		await tab.locator('[data-terminay-bot-env-tab="files"]').click();
		const files = tab.locator('[data-terminay-bot-files]');
		const row = (name: string) =>
			files.locator(`[data-terminay-bot-file="${name}"]`);
		const more = (name: string) =>
			files.getByRole('button', { name: `More actions for ${name}` });
		const menu = mainWindow.locator('.context-menu');
		const labels = () =>
			menu
				.locator('.context-menu__item .context-menu__label')
				.allTextContents();
		await expect(row('hello')).toBeVisible({ timeout: 30_000 });
		await expect(row('notes')).toBeVisible();

		// The row has one menu button and none of the old inline actions.
		for (const name of ['hello', 'notes']) {
			await expect(more(name)).toBeVisible();
			for (const old of ['Download', 'Rename', 'Delete'])
				await expect(
					row(name).getByRole('button', { name: `${old} ${name}` }),
				).toHaveCount(0);
		}
		const button = (await more('hello').boundingBox())!;
		expect(button.width).toBeGreaterThanOrEqual(24);
		expect(button.height).toBeGreaterThanOrEqual(24);
		const icon = (await more('hello').locator('svg').boundingBox())!;
		expect(icon.width).toBe(16);
		expect(icon.height).toBe(16);
		// The button sits at the table's right edge, inside the cell padding.
		const table = (await files.locator('table.bots-tbl').boundingBox())!;
		expect(
			table.x + table.width - (button.x + button.width),
		).toBeLessThanOrEqual(16);

		// The name column takes the free width; size, changed and actions keep
		// to their content on one line at the right.
		const headers = files.locator('table.bots-tbl thead th');
		const nameHeader = (await headers.nth(0).boundingBox())!;
		expect(nameHeader.width).toBeGreaterThan(table.width * 0.6);
		for (const i of [1, 2, 3]) {
			const box = (await headers.nth(i).boundingBox())!;
			expect(box.width).toBeLessThan(table.width * 0.2);
			expect(box.height).toBeLessThanOrEqual(nameHeader.height + 1);
		}

		// A file's menu, from its button, with its right edge on the button's.
		await more('hello').click();
		await expect(menu).toBeVisible();
		const opened = (await menu.boundingBox())!;
		expect(opened.x).toBeLessThan(button.x);
		expect(
			Math.abs(opened.x + opened.width - (button.x + button.width)),
		).toBeLessThanOrEqual(2);
		await expect(more('hello')).toHaveAttribute('aria-expanded', 'true');
		expect(await labels()).toEqual(['Preview', 'Download', 'Rename', 'Delete']);
		await expect(
			menu.locator('.context-menu__item--danger .context-menu__label'),
		).toHaveText('Delete');
		for (const scheme of ['dark', 'light'] as const) {
			await mainWindow.emulateMedia({ colorScheme: scheme });
			await mainWindow.screenshot({
				path: testInfo.outputPath(`bot-files-row-menu-${scheme}.png`),
			});
		}
		await mainWindow.emulateMedia({ colorScheme: 'dark' });
		// A press on the open menu's own button closes it.
		await more('hello').click();
		await expect(menu).toHaveCount(0);

		// Download goes through the Desktop host save (ADR-0130): the user picks
		// the destination, then the bytes stream from the Files helper.
		const saves = path.join(tempDir, 'saves');
		await mkdir(saves, { recursive: true });
		await electronApp.evaluate(({ dialog }, dir) => {
			dialog.showSaveDialog = (async (
				_window: unknown,
				options: { defaultPath?: string },
			) => ({
				canceled: false,
				filePath: `${dir}/${String(options?.defaultPath).split('/').pop()}`,
			})) as typeof dialog.showSaveDialog;
		}, saves);
		await more('hello').click();
		await menu.locator('.context-menu__item', { hasText: 'Download' }).click();
		await expect
			.poll(() => readFile(path.join(saves, 'hello'), 'utf8').catch(() => ''))
			.toBe('hello');
		await row('notes').click({ button: 'right' });
		await menu.locator('.context-menu__item', { hasText: 'Download' }).click();
		await expect
			.poll(() => existsSync(path.join(saves, 'notes.tar')))
			.toBe(true);
		await expect(files.locator('.bots-note--error')).toHaveCount(0);

		// A folder's menu, by right-click at the pointer.
		await row('notes').click({ button: 'right', position: { x: 60, y: 8 } });
		await expect(menu).toBeVisible();
		expect(await labels()).toEqual(['Open', 'Download', 'Rename', 'Delete']);
		const rowBox = (await row('notes').boundingBox())!;
		const menuBox = (await menu.boundingBox())!;
		expect(Math.abs(menuBox.x - (rowBox.x + 60))).toBeLessThanOrEqual(2);
		await menu.locator('.context-menu__item', { hasText: 'Open' }).click();
		await expect(files).toHaveAttribute('data-terminay-bot-files', 'notes');
		await expect(row('todo.md')).toBeVisible();
		await expect(files.locator('[data-terminay-bot-file]')).toHaveCount(1);
		// No menu on the parent-folder row.
		await expect(
			files.locator('tr', { hasText: '..' }).getByRole('button', {
				name: /More actions/,
			}),
		).toHaveCount(0);
		await more('todo.md').click();
		await menu.locator('.context-menu__item', { hasText: 'Preview' }).click();
		await expect(
			tab.getByRole('complementary', { name: 'Preview' }),
		).toContainText('try the row menu');
		await files.getByRole('button', { name: '/home/bot' }).click();
		await expect(files).toHaveAttribute('data-terminay-bot-files', '.');

		// A credential link is locked and opens no menu by any means.
		const locked = row('.credentials.json');
		await expect(locked).toContainText('Locked');
		await expect(
			locked.getByRole('button', { name: /More actions/ }),
		).toHaveCount(0);
		await locked.click({ button: 'right' });
		await expect(menu).toHaveCount(0);

		// The keyboard: Enter opens with the first item focused, the arrows
		// wrap, Home and End jump, and Escape returns focus to the button.
		await more('hello').focus();
		await mainWindow.keyboard.press('Enter');
		await expect(
			mainWindow.getByRole('menu', { name: 'Actions for hello' }),
		).toBeVisible();
		const item = (name: string) => menu.getByRole('menuitem', { name });
		await expect(item('Preview')).toBeFocused();
		expect(
			await item('Preview').evaluate((el) => getComputedStyle(el).outlineStyle),
		).not.toBe('none');
		await mainWindow.keyboard.press('ArrowDown');
		await expect(item('Download')).toBeFocused();
		await mainWindow.keyboard.press('ArrowUp');
		await mainWindow.keyboard.press('ArrowUp');
		await expect(item('Delete')).toBeFocused();
		await mainWindow.keyboard.press('ArrowDown');
		await expect(item('Preview')).toBeFocused();
		await mainWindow.keyboard.press('End');
		await expect(item('Delete')).toBeFocused();
		await mainWindow.keyboard.press('Home');
		await expect(item('Preview')).toBeFocused();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-files-row-menu-keyboard.png'),
		});
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(more('hello')).toBeFocused();

		// Shift+F10 on a focused row opens the menu at the row, first item focused.
		await files.getByRole('button', { name: 'hello', exact: true }).focus();
		await mainWindow.keyboard.press('Shift+F10');
		await expect(item('Preview')).toBeFocused();
		const nameBox = (await files
			.getByRole('button', { name: 'hello', exact: true })
			.boundingBox())!;
		expect(
			Math.abs((await menu.boundingBox())!.y - (nameBox.y + nameBox.height)),
		).toBeLessThanOrEqual(2);
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		// The row's controls are disabled, so send the keyboard's contextmenu.
		await locked.dispatchEvent('contextmenu', { button: 0 });
		await expect(menu).toHaveCount(0);

		// Rename through the menu; the field keeps focus.
		await more('hello').click();
		await menu.locator('.context-menu__item', { hasText: 'Rename' }).click();
		const field = row('hello').locator('input[name="name"]');
		await expect(field).toBeFocused();
		await field.fill('greeting.txt');
		await field.press('Enter');
		await expect(row('greeting.txt')).toBeVisible();
		await expect(row('hello')).toHaveCount(0);

		// Delete asks first: Cancel and Escape both keep the file.
		await more('greeting.txt').click();
		await menu.locator('.context-menu__item', { hasText: 'Delete' }).click();
		const confirm = row('greeting.txt').getByRole('button', {
			name: 'Delete greeting.txt',
		});
		await expect(confirm).toBeFocused();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-files-row-delete-confirm.png'),
		});
		await row('greeting.txt').getByRole('button', { name: 'Cancel' }).click();
		await expect(row('greeting.txt')).toBeVisible();
		await expect(more('greeting.txt')).toBeFocused();
		await more('greeting.txt').click();
		await menu.locator('.context-menu__item', { hasText: 'Delete' }).click();
		await expect(confirm).toBeFocused();
		await mainWindow.keyboard.press('Escape');
		await expect(confirm).toHaveCount(0);
		await expect(more('greeting.txt')).toBeFocused();
		await more('greeting.txt').click();
		await menu.locator('.context-menu__item', { hasText: 'Delete' }).click();
		await confirm.click();
		await expect(row('greeting.txt')).toHaveCount(0);

		// A confirmation does not survive a change of folder.
		await more('notes').click();
		await menu.locator('.context-menu__item', { hasText: 'Delete' }).click();
		await expect(
			row('notes').getByRole('button', { name: 'Delete notes' }),
		).toBeVisible();
		await files.getByRole('button', { name: 'notes', exact: true }).click();
		await expect(files).toHaveAttribute('data-terminay-bot-files', 'notes');
		await files.getByRole('button', { name: '/home/bot' }).click();
		await expect(more('notes')).toBeVisible();
		await expect(
			row('notes').getByRole('button', { name: 'Delete notes' }),
		).toHaveCount(0);

		// An entry removed elsewhere takes its open menu with it.
		await more('notes').click();
		await expect(menu).toBeVisible();
		await writeFile(path.join(fakeRoot(tempDir), 'files-remove'), 'notes\n');
		await expect(row('notes')).toHaveCount(0, { timeout: 10_000 });
		await expect(menu).toHaveCount(0);
	});

	test('Files rows stay bound to their folder while listing replies arrive late', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Delayed files');
		await tab.locator('[data-terminay-bot-config-tab="environment"]').click();
		await tab.locator('[data-terminay-bot-env-tab="files"]').click();
		const files = tab.locator('[data-terminay-bot-files]');
		const row = (name: string) =>
			files.locator(`[data-terminay-bot-file="${name}"]`);
		await expect(row('hello')).toBeVisible({ timeout: 30_000 });
		const root = fakeRoot(tempDir);
		await writeFile(
			path.join(root, 'files-list-delay'),
			JSON.stringify({ '.': 2000, notes: 800 }),
		);
		// A watch invalidation starts a slow refresh of the old folder.
		await writeFile(path.join(root, 'files-remove'), 'missing-entry\n');
		await expect
			.poll(() => existsSync(path.join(root, 'files-list-pending-home')))
			.toBe(true);
		await files.getByRole('button', { name: 'More actions for notes' }).click();
		await mainWindow
			.getByRole('menuitem', { name: 'Open', exact: true })
			.click();
		await expect(files).toHaveAttribute('data-terminay-bot-files', 'notes');
		// Previous-folder rows must disappear immediately, before the reply.
		expect(await row('hello').count()).toBe(0);
		await expect(row('todo.md')).toBeVisible();
		await expect
			.poll(() => existsSync(path.join(root, 'files-list-delivered-home')))
			.toBe(true);
		await rm(path.join(root, 'files-list-delay'));
		// A transport round trip fences the delivered old reply.
		await files
			.getByRole('button', { name: 'More actions for todo.md' })
			.click();
		await mainWindow
			.getByRole('menuitem', { name: 'Preview', exact: true })
			.click();
		await expect(
			tab.getByRole('complementary', { name: 'Preview' }),
		).toContainText('try the row menu');
		await expect(row('todo.md')).toBeVisible();
		await expect(row('hello')).toHaveCount(0);
	});

	test('an out-of-date container offers Update now even with Files open, and updates itself before the next run', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		test.setTimeout(120_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Wren'));
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await send(tab, 'hello');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		const shot = (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });

		// The bot's container, as the fake engine stores it.
		// Absent while a recreate is between removal and creation.
		const containerFile = async () => {
			const names = (await readdir(fakeRoot(tempDir))).filter((name) =>
				/^container-terminay-bot-[a-z0-9]+\.json$/.test(name),
			);
			return names.length === 1
				? path.join(fakeRoot(tempDir), names[0]!)
				: undefined;
		};
		const fingerprint = async () => {
			const file = await containerFile();
			if (!file) return undefined;
			try {
				return JSON.parse(await readFile(file, 'utf8')).Config.Labels[
					'terminay.fingerprint'
				] as string;
			} catch {
				return undefined;
			}
		};
		// A release changed the image: the running container is now out of date.
		const makeStale = async () => {
			const file = await containerFile();
			if (!file) throw new Error('the bot has no container');
			const container = JSON.parse(await readFile(file, 'utf8'));
			container.Config.Labels['terminay.fingerprint'] = 'stale';
			if (container.Labels) container.Labels['terminay.fingerprint'] = 'stale';
			await writeFile(file, JSON.stringify(container));
		};
		const current = await fingerprint();
		expect(current).toBeTruthy();
		await makeStale();

		// Above Chat, an update is not an engine problem: no engine card.
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await chat(tab);
		await expect(
			tab.locator('[data-terminay-bot-recovery] .bots-engine'),
		).toBeHidden();
		await expect(tab.getByRole('button', { name: 'Check again' })).toBeHidden();

		// The Overview says an update is ready, in plain words.
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="environment"]').click();
		await tab.locator('[data-terminay-bot-env-tab="overview"]').click();
		const outdated = tab.locator('[data-terminay-bot-env-outdated]');
		await expect(outdated).toContainText(
			'An update is ready. It installs before the next run, while no shell or desktop is open.',
		);
		await shot('update-ready-overview');

		// With Files open, the engine is already removing the helper when the
		// update asks it to: Update now still succeeds, with no conflict.
		await writeFile(path.join(fakeRoot(tempDir), 'helper-rm-race'), '');
		await tab.locator('[data-terminay-bot-env-tab="files"]').click();
		await expect(
			tab.locator('[data-terminay-bot-files] [data-terminay-bot-file="hello"]'),
		).toBeVisible({ timeout: 30_000 });
		await tab.locator('[data-terminay-bot-env-tab="overview"]').click();
		await outdated.locator('[data-terminay-bot-env-update]').click();
		await expect(outdated).toHaveCount(0, { timeout: 30_000 });
		await expect(tab.locator('.bots-note--error')).toHaveCount(0);
		await expect(
			tab.locator('[data-terminay-bot-env-state="running"]'),
		).toBeVisible();
		await expect.poll(fingerprint, { timeout: 30_000 }).toBe(current);
		await expect(
			tab.locator('[data-terminay-bot-env-state="running"]'),
		).toBeVisible({ timeout: 30_000 });
		await expect(outdated).toHaveCount(0);
		await shot('updated-overview');
		await rm(path.join(fakeRoot(tempDir), 'helper-rm-race'), { force: true });

		// Out of date again: the next run applies the update by itself.
		await makeStale();
		await chat(tab);
		await send(tab, 'again');
		await expect(tab.locator('.bots-sess')).toHaveCount(2, {
			timeout: 30_000,
		});
		await expect(transcript).toContainText('again');
		await expect.poll(fingerprint, { timeout: 30_000 }).toBe(current);
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="environment"]').click();
		await tab.locator('[data-terminay-bot-env-tab="overview"]').click();
		await expect(
			tab.locator('[data-terminay-bot-env-state="running"]'),
		).toBeVisible();
		await expect(outdated).toHaveCount(0);
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
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'hello',
		);
		await send(tab, 'again');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'again',
		);
		await expect(tab.locator('.bots-sess')).toHaveCount(3);
	});

	test('chat times every message, marks unread replies until left, and lists a repeating trigger once', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Wren'));
		await send(tab, 'hello');
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		// A reply read as it arrives opens no divider.
		await expect(tab.locator('[data-terminay-bot-unread]')).toHaveCount(0);
		await expect(transcript.locator('.bots-msg')).toHaveCount(2);
		await expect(transcript.locator('.bots-msg time')).toHaveCount(2);

		const row = await newTrigger(tab, 'Every so often', 'check in');
		await row.locator('[data-terminay-bot-trigger-run]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await expect(
			tab
				.locator('[data-terminay-bot-session-row]')
				.filter({ hasText: 'Every so often' }),
		).toHaveAttribute('data-terminay-bot-session-state', 'completed', {
			timeout: 30_000,
		});

		await chat(tab);
		await expect(transcript.locator('.bots-msg')).toHaveCount(3);
		const divider = tab.locator('[data-terminay-bot-unread]');
		await expect(divider).toHaveText('1 new message');
		await expect(
			transcript.locator('[data-terminay-bot-unread] + .bots-msg'),
		).toContainText('Wren');

		const upcoming = tab.locator('[data-terminay-bot-upcoming] li');
		await expect(upcoming).toHaveCount(1);
		await expect(upcoming).toContainText('Every so often');
		await expect(upcoming.getByLabel('Repeats')).toBeVisible();
		await mainWindow.screenshot({});

		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await chat(tab);
		await expect(transcript.locator('.bots-msg')).toHaveCount(3);
		await expect(divider).toHaveCount(0);
	});

	test('any message can grow a thread: reply action, reply bar, panel, drafts and deletion', async ({
		mainWindow,
		electronApp,
		tempDir,
	}, testInfo) => {
		test.setTimeout(180_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Weaver'));
		const transcript = tab.locator('[data-terminay-bot-transcript]').first();
		const panel = tab.locator('[data-terminay-bot-thread]');
		const panelComposer = panel.locator('[data-terminay-bot-composer]');
		const panelReplies = panel.locator('.bots-thread__body > .bots-tx').last();
		const menu = mainWindow.locator('.context-menu');
		const labels = () =>
			menu
				.locator('.context-menu__item .context-menu__label')
				.allTextContents();
		const shot = (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });

		// A top-level exchange: the user's message and the bot's reply.
		await send(tab, 'Plan the release');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await expect(transcript.locator(':scope > .bots-msg')).toHaveCount(2);
		const botMessage = transcript.locator(':scope > .bots-msg').nth(1);
		const userMessage = transcript.locator(':scope > .bots-msg').first();

		// Hovering a message reveals Reply in thread.
		await botMessage.hover();
		const action = botMessage.locator('[data-terminay-bot-reply-in-thread]');
		await expect(action).toBeVisible();
		await shot('thread-hover-action');
		await action.click();
		await expect(panel).toBeVisible();
		await expect(panelComposer).toBeFocused();
		await expect(panel.locator('[data-terminay-bot-thread-count]')).toHaveText(
			'No replies yet',
		);
		await expect(tab.locator('.bots-rail')).toHaveCount(0);

		// A reply from the panel starts an execution, which answers in the thread.
		await panelComposer.fill('Ship it to staging');
		await panelComposer.press('Enter');
		await expect(panelReplies).toContainText('Ship it to staging');
		await expect(panelReplies.locator(':scope > .bots-msg')).toHaveCount(2, {
			timeout: 30_000,
		});
		await expect(panelReplies).toContainText('secret');
		await expect(
			panel.locator('[data-terminay-bot-thread-count]'),
		).toHaveAttribute('data-terminay-bot-thread-count', '2');
		// The main stream keeps its two messages and gains a reply bar.
		await expect(transcript.locator(':scope > .bots-msg')).toHaveCount(2);
		const bar = botMessage.locator('[data-terminay-bot-thread-replies]');
		await expect(bar).toHaveAttribute('data-terminay-bot-thread-replies', '2');
		await expect(bar).toContainText('2 replies');
		await expect(bar).toContainText('Last reply');
		await shot('thread-panel');

		// Quote a reply inside the panel: it goes to the thread's draft.
		await panelReplies
			.locator('.bots-md[data-terminay-message-key]')
			.filter({ hasText: 'secret' })
			.click({ button: 'right' });
		expect(await labels()).toEqual(['Quote', 'Edit message', 'Delete message']);
		await menu.getByRole('menuitem', { name: 'Quote', exact: true }).click();
		await expect(panelComposer).toHaveValue('> secret\n\n');
		await expect(panelComposer).toBeFocused();
		await panelComposer.fill('draft A');

		// Edit and delete a reply inside the panel.
		await panelReplies
			.locator('[data-terminay-message-key]')
			.filter({ hasText: 'Ship it to staging' })
			.click({ button: 'right' });
		await menu
			.getByRole('menuitem', { name: 'Edit message', exact: true })
			.click();
		const editor = mainWindow.getByRole('dialog', { name: 'Edit message' });
		await editor.getByLabel('Message text').fill('Ship it to production');
		await editor.getByRole('button', { name: 'Save message' }).click();
		await expect(editor).toHaveCount(0);
		await expect(panelReplies).toContainText('Ship it to production');
		await panelReplies
			.locator('.bots-md[data-terminay-message-key]')
			.filter({ hasText: 'secret' })
			.click({ button: 'right' });
		await menu
			.getByRole('menuitem', { name: 'Delete message', exact: true })
			.click();
		await expect(panelReplies.locator(':scope > .bots-msg')).toHaveCount(1);
		await expect(bar).toHaveAttribute('data-terminay-bot-thread-replies', '1');
		await expect(bar).toContainText('1 reply');
		await expect(panelComposer).toHaveValue('draft A');

		// Escape closes the panel and returns focus to the root.
		await panelComposer.press('Escape');
		await expect(panel).toHaveCount(0);
		await expect(tab.locator('.bots-rail')).toBeVisible();
		await expect(
			botMessage.locator('.bots-md[data-terminay-message-key]'),
		).toBeFocused();
		await bar.hover();
		await shot('thread-reply-bar');

		// Each thread keeps its own draft.
		await userMessage.click({ button: 'right' });
		expect(await labels()).toEqual([
			'Quote',
			'Reply in thread',
			'Edit message',
			'Delete message',
		]);
		await menu
			.getByRole('menuitem', { name: 'Reply in thread', exact: true })
			.click();
		await expect(panelComposer).toHaveValue('');
		// A pending file belongs to the thread it was attached in.
		await panel.locator('[data-terminay-bot-attach-input]').setInputFiles({
			name: 'notes.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('notes'),
		});
		await expect(
			panel.locator('[data-terminay-bot-pending-images] li'),
		).toHaveCount(1);
		await bar.click();
		await expect(panelComposer).toHaveValue('draft A');
		await expect(
			panel.locator('[data-terminay-bot-pending-images] li'),
		).toHaveCount(0);

		// On a narrow window the panel covers the chat.
		const nativeWindow = await electronApp.browserWindow(mainWindow);
		const bounds = await nativeWindow.evaluate((window) => window.getBounds());
		await nativeWindow.evaluate((window, next) => window.setBounds(next), {
			...bounds,
			width: 760,
		});
		await expect
			.poll(() => panel.evaluate((el) => getComputedStyle(el).position))
			.toBe('absolute');
		await shot('thread-panel-narrow');
		await nativeWindow.evaluate(
			(window, next) => window.setBounds(next),
			bounds,
		);

		// Deleting the root deletes its thread and closes the panel.
		await botMessage
			.locator('.bots-md[data-terminay-message-key]')
			.click({ button: 'right' });
		expect(await labels()).toEqual([
			'Quote',
			'Reply in thread',
			'Edit message',
			'Delete message and replies',
		]);
		await menu
			.getByRole('menuitem', {
				name: 'Delete message and replies',
				exact: true,
			})
			.click();
		await expect(panel).toHaveCount(0);
		await expect(transcript.locator(':scope > .bots-msg')).toHaveCount(1);

		// Clearing the chat closes an open thread.
		await userMessage.hover();
		await userMessage.locator('[data-terminay-bot-reply-in-thread]').click();
		await expect(panel).toBeVisible();
		await tab.getByRole('button', { name: 'Clear chat', exact: true }).click();
		await mainWindow
			.getByRole('alertdialog', { name: 'Clear chat history?' })
			.getByRole('button', { name: 'Clear chat', exact: true })
			.click();
		await expect(panel).toHaveCount(0);
		await expect(transcript.locator(':scope > .bots-msg')).toHaveCount(0);
	});

	test('Quote puts any message into the composer as a blockquote, by pointer and keyboard', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		test.setTimeout(120_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Quill'));
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		const composer = tab.locator('[data-terminay-bot-composer]');
		const menu = mainWindow.locator('.context-menu');
		const item = (name: string) =>
			menu.getByRole('menuitem', { name, exact: true });
		const labels = () =>
			menu
				.locator('.context-menu__item .context-menu__label')
				.allTextContents();
		const shot = (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });
		const caretAtEnd = () =>
			composer.evaluate(
				(el: HTMLTextAreaElement) =>
					el.selectionStart === el.value.length &&
					el.selectionEnd === el.value.length,
			);
		const select = (target: Locator, word: string) =>
			target.evaluate((el, text) => {
				const walker = el.ownerDocument.createTreeWalker(
					el,
					NodeFilter.SHOW_TEXT,
				);
				for (let node = walker.nextNode(); node; node = walker.nextNode()) {
					const at = node.textContent?.indexOf(text) ?? -1;
					if (at < 0) continue;
					const range = el.ownerDocument.createRange();
					range.setStart(node, at);
					range.setEnd(node, at + text.length);
					const selection = el.ownerDocument.getSelection()!;
					selection.removeAllRanges();
					selection.addRange(range);
					return;
				}
				throw new Error(`no ${text}`);
			}, word);
		const clearSelection = () =>
			mainWindow.evaluate(() => document.getSelection()?.removeAllRanges());

		await send(tab, 'Build passed.\r\n\r\nDeployed to staging.');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await expect(transcript.locator('.bots-msg')).toHaveCount(2);
		const mine = transcript.locator('.bots-msg--user').first();
		const reply = transcript
			.locator('.bots-md[data-terminay-message-key]')
			.filter({ hasText: 'secret' });

		// Right-click a bot message: Quote comes first, above Edit and Delete.
		await reply.click({ button: 'right' });
		await expect(menu).toBeVisible();
		expect(await labels()).toEqual([
			'Quote',
			'Reply in thread',
			'Edit message',
			'Delete message',
		]);
		await shot('bot-message-quote-menu');
		await item('Quote').click();
		await expect(menu).toHaveCount(0);
		await expect(composer).toHaveValue('> secret\n\n');
		await expect(composer).toBeFocused();
		expect(await caretAtEnd()).toBe(true);
		await mainWindow.keyboard.type('Thanks');
		await expect(composer).toHaveValue('> secret\n\nThanks');

		// The user's own multi-line message is appended after the draft.
		await mine.click({ button: 'right' });
		await item('Quote').click();
		await expect(composer).toHaveValue(
			'> secret\n\nThanks\n\n> Build passed.\n>\n> Deployed to staging.\n\n',
		);
		await expect(composer).toBeFocused();
		expect(await caretAtEnd()).toBe(true);
		await mainWindow.keyboard.type('Which staging?');
		// Quoting sends nothing.
		await expect(transcript.locator('.bots-msg')).toHaveCount(2);

		// A selection inside the message quotes only that; Edit still edits all of it.
		await composer.fill('');
		await select(mine, 'Deployed');
		await mine.click({ button: 'right' });
		await item('Quote').click();
		await expect(composer).toHaveValue('> Deployed\n\n');
		await select(mine, 'Deployed');
		await mine.click({ button: 'right' });
		await item('Edit message').click();
		const editor = mainWindow.getByRole('dialog', { name: 'Edit message' });
		await expect(editor.getByLabel('Message text')).toHaveValue(
			'Build passed.\n\nDeployed to staging.',
		);
		await mainWindow.keyboard.press('Escape');
		await expect(editor).toHaveCount(0);

		// A selection in another message is ignored: the whole reply is quoted.
		await composer.fill('');
		await select(mine, 'Build');
		await reply.click({ button: 'right' });
		await item('Quote').click();
		await expect(composer).toHaveValue('> secret\n\n');
		await clearSelection();

		// Keyboard: Shift+F10 opens the menu at the message with Quote focused.
		await composer.fill('');
		await reply.focus();
		await mainWindow.keyboard.press('Shift+F10');
		await expect(item('Quote')).toBeFocused();
		const box = (await reply.boundingBox())!;
		expect(
			Math.abs((await menu.boundingBox())!.y - (box.y + box.height)),
		).toBeLessThanOrEqual(2);
		await mainWindow.keyboard.press('ArrowDown');
		await expect(item('Reply in thread')).toBeFocused();
		await mainWindow.keyboard.press('End');
		await expect(item('Delete message')).toBeFocused();
		await mainWindow.keyboard.press('ArrowDown');
		await expect(item('Quote')).toBeFocused();
		await mainWindow.keyboard.press('ArrowUp');
		await expect(item('Delete message')).toBeFocused();
		await mainWindow.keyboard.press('Home');
		await expect(item('Quote')).toBeFocused();
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(reply).toBeFocused();
		await mainWindow.keyboard.press('Shift+F10');
		await expect(item('Quote')).toBeFocused();
		await mainWindow.keyboard.press('Enter');
		await expect(composer).toHaveValue('> secret\n\n');
		await expect(composer).toBeFocused();

		// Pending files are kept; a message with no text offers no Quote.
		const input = tab.locator('[data-terminay-bot-attach-input]');
		const image = Buffer.from(
			await mainWindow.evaluate(() => {
				const canvas = document.createElement('canvas');
				canvas.width = 40;
				canvas.height = 40;
				const g = canvas.getContext('2d')!;
				g.fillStyle = '#3a7';
				g.fillRect(0, 0, 40, 40);
				return canvas.toDataURL('image/png').split(',')[1]!;
			}),
			'base64',
		);
		await input.setInputFiles({
			name: 'pic.png',
			mimeType: 'image/png',
			buffer: image,
		});
		const thumbs = tab.locator('[data-terminay-bot-pending-images] li');
		await expect(thumbs).toHaveCount(1);
		await reply.click({ button: 'right' });
		await item('Quote').click();
		await expect(composer).toHaveValue('> secret\n\n> secret\n\n');
		await expect(thumbs).toHaveCount(1);
		await composer.fill('');
		await tab.locator('[data-terminay-bot-send]').click();
		await expect(thumbs).toHaveCount(0);
		const imageOnly = transcript.locator('.bots-msg--user').nth(1);
		await expect(imageOnly.locator('img')).toBeVisible({ timeout: 30_000 });
		await imageOnly.click({ button: 'right' });
		await expect(menu).toBeVisible();
		expect(await labels()).toEqual([
			'Reply in thread',
			'Edit message',
			'Delete message',
		]);
		await mainWindow.keyboard.press('Escape');

		// A quoted reply, in the composer and once sent.
		await mine.click({ button: 'right' });
		await item('Quote').click();
		await mainWindow.keyboard.type('Which staging?');
		await composer.evaluate((el) => {
			el.scrollTop = 0;
		});
		await shot('bot-message-quote-composer');
		await tab.locator('[data-terminay-bot-send]').click();
		await expect(
			transcript
				.locator('.bots-msg--user')
				.filter({ hasText: 'Which staging?' }),
		).toContainText('> Build passed.');
		await expect(composer).toHaveValue('');
		await shot('bot-message-quote-sent');
	});

	test('a narrow bot tab keeps its header to the avatar, name and a settings menu', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await createBot(
			mainWindow,
			'Codexia with a rather long name that cannot fit on a phone',
		);
		await chat(tab);
		await mainWindow.setViewportSize({ width: 390, height: 800 });
		// A phone-width Home may open its sidebar as a drawer over the tab;
		// close it. A compact Home has no sidebar toggle at all.
		const sidebar = mainWindow.locator('[data-compact-sidebar-toggle="true"]');
		if (
			(await sidebar.count()) > 0 &&
			(await sidebar.getAttribute('aria-pressed')) === 'true'
		) {
			await sidebar.click();
			await expect(sidebar).toHaveAttribute('aria-pressed', 'false');
		}

		const botTab = tab.locator('[data-terminay-bot-tab]');
		const header = botTab.locator('.bots-ahead');
		const name = header.locator('.bots-ahead__name b');
		const settings = header.locator('[data-terminay-bot-settings]');
		await expect(settings).toBeVisible();
		await expect(header.locator('.bots-ahead__name span')).toBeHidden();
		await expect(
			header.locator('[data-terminay-bot-mode-button="configure"]'),
		).toBeHidden();
		await expect(
			header.getByRole('button', { name: 'Disable bot' }),
		).toBeHidden();
		// The chip is hidden from sight but still read out.
		const chip = header.locator('.bots-chip');
		expect((await chip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
		await expect(chip).toHaveText(/\S/);
		// The name ends before the settings control and never overlaps it.
		const nameBox = (await name.boundingBox())!;
		const gearBox = (await settings.boundingBox())!;
		expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(gearBox.x);
		expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
			true,
		);
		expect(
			await header.evaluate((el) => el.scrollWidth <= el.clientWidth),
		).toBe(true);
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-header-narrow.png'),
		});

		// The menu marks Chat, focuses it, and switches to Configure.
		await settings.click();
		const menu = header.getByRole('menu', { name: 'Bot settings' });
		await expect(menu).toBeVisible();
		await expect(settings).toHaveAttribute('aria-expanded', 'true');
		const chatItem = menu.getByRole('menuitemradio', { name: 'Chat' });
		await expect(chatItem).toHaveAttribute('aria-checked', 'true');
		await expect(chatItem).toBeFocused();
		await expect(
			menu.getByRole('menuitem', { name: 'Disable bot' }),
		).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-header-narrow-menu.png'),
		});
		await mainWindow.keyboard.press('ArrowDown');
		await expect(
			menu.getByRole('menuitemradio', { name: 'Configure' }),
		).toBeFocused();
		await mainWindow.keyboard.press('Enter');
		await expect(menu).toHaveCount(0);
		await expect(botTab).toHaveAttribute('data-terminay-bot-mode', 'configure');
		await expect(settings).toBeFocused();

		// Escape closes the menu and returns focus to the control.
		await settings.click();
		await expect(
			menu.getByRole('menuitemradio', { name: 'Configure' }),
		).toHaveAttribute('aria-checked', 'true');
		await mainWindow.keyboard.press('Escape');
		await expect(menu).toHaveCount(0);
		await expect(settings).toBeFocused();

		// Disabling from the menu shows a Disabled chip; enabling hides it again.
		await settings.click();
		await menu.getByRole('menuitem', { name: 'Disable bot' }).click();
		await expect(chip).toHaveText('Disabled');
		await expect(chip).toBeVisible();
		expect((await chip.boundingBox())!.width).toBeGreaterThan(1);
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-header-narrow-disabled.png'),
		});
		await settings.click();
		await menu.getByRole('menuitem', { name: 'Enable bot' }).click();
		await expect(chip).not.toHaveText('Disabled');
		expect((await chip.boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);

		// Back to Chat from the menu.
		await settings.click();
		await menu.getByRole('menuitemradio', { name: 'Chat' }).click();
		await expect(botTab).toHaveAttribute('data-terminay-bot-mode', 'chat');

		// A wide tab keeps the full header and no settings control.
		await mainWindow.setViewportSize({ width: 1280, height: 850 });
		await expect(settings).toBeHidden();
		await expect(
			header.locator('[data-terminay-bot-mode-button="configure"]'),
		).toBeVisible();
		await expect(
			header.getByRole('button', { name: 'Disable bot' }),
		).toBeVisible();
		await expect(header.locator('.bots-ahead__name span')).toBeVisible();
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-header-wide.png'),
		});
	});

	test('a trigger status says Disabled only when the trigger or its bot is off', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Kestrel');
		const row = await newTrigger(tab, 'Every so often', 'check in');
		const status = row.locator('[data-terminay-bot-trigger-status]');
		const toggle = row.getByRole('switch');

		// Enabled and armed, before it has ever fired.
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await expect(status).toHaveText('Waiting');
		await expect(status).toHaveAttribute(
			'data-terminay-bot-trigger-status',
			'done',
		);
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-enabled-waiting.png'),
		});

		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'false');
		await expect(status).toHaveText('Disabled');
		await expect(status).toHaveAttribute(
			'data-terminay-bot-trigger-status',
			'idle',
		);
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-disabled.png'),
		});

		// Re-enabling never leaves a Disabled status beside a switch that is on.
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await expect(status).toHaveText('Waiting');
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-reenabled-waiting.png'),
		});

		// Disabling the bot shows its switched-on trigger as Disabled.
		await tab.getByRole('button', { name: 'Disable bot' }).click();
		await expect(status).toHaveText('Disabled');
		await expect(status).toHaveAttribute(
			'data-terminay-bot-trigger-status',
			'idle',
		);
		await expect(toggle).toHaveAttribute('aria-checked', 'true');
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-bot-disabled.png'),
		});
		// The header button; a disabled bot also offers an inline Enable bot link.
		await tab.locator('.bots-btn').getByText('Enable bot').click();
		await expect(status).toHaveText('Waiting');
	});

	test('a trigger the bot reports as needing a human pauses as Needs you, posts once, and Resume clears it', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await createBot(mainWindow, 'Plover');
		// The fake agent reports needs-human when its prompt names fixture-portal-refused.
		const row = await newTrigger(
			tab,
			'Support tickets',
			'fixture-portal-refused check',
		);
		const id = (await row.getAttribute('data-terminay-bot-trigger')) ?? '';
		const status = row.locator('[data-terminay-bot-trigger-status]');
		const editor = mainWindow.locator('[data-terminay-bot-trigger-editor]');

		// The editor offers the failure settings, with their defaults.
		await row.locator('.bots-trigrow__name').click();
		const settings = editor.locator(
			'section[aria-label="If something goes wrong"]',
		);
		await expect(
			settings.getByRole('combobox', { name: 'Startup retries', exact: true }),
		).toContainText('3');
		await pick(editor, 'Startup retries', '1');
		await settings.scrollIntoViewIfNeeded();
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-failure-settings.png'),
		});
		await editor.locator('[data-terminay-bot-trigger-save]').click();
		await expect(editor).toHaveCount(0);

		// One run: the bot reports it needs a human, so the trigger pauses.
		await row.locator('[data-terminay-bot-trigger-run]').click();
		await expect(status).toHaveText('Needs you', { timeout: 30_000 });
		await expect(status).toHaveAttribute(
			'data-terminay-bot-trigger-status',
			'need',
		);
		const needsYou = row.locator(
			`[data-terminay-bot-trigger-needs-you="${id}"]`,
		);
		await expect(needsYou).toContainText('refused the login');
		await expect(needsYou).toContainText('Add the support portal password');
		// Its firings are skipped while it waits, so nothing is coming up.
		await expect(row.locator('.bots-trigrow__when.bots-mono')).toHaveText(
			'Paused',
		);
		await expect(tab.locator('[data-terminay-bot-upcoming-strip]')).toHaveCount(
			0,
		);
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-needs-you.png'),
		});

		// The editor explains the pause, and saving keeps it.
		await row.locator('.bots-trigrow__name').click();
		await expect(
			editor.locator(`[data-terminay-bot-trigger-needs-you="${id}"]`),
		).toContainText('paused until you choose Resume');
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-editor-needs-you.png'),
		});
		await editor.locator('[data-terminay-bot-trigger-save]').click();
		await expect(editor).toHaveCount(0);
		await expect(status).toHaveText('Needs you');

		// The bot told the user once, in Chat.
		await chat(tab);
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript).toContainText('refused the login');
		await expect(
			transcript.getByText('The support portal refused the login.', {
				exact: false,
			}),
		).toHaveCount(1);
		await mainWindow.screenshot({
			path: testInfo.outputPath('chat-needs-you-post.png'),
		});

		// Resume clears it.
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await row.locator(`[data-terminay-bot-trigger-resume="${id}"]`).click();
		await expect(status).toHaveText('Waiting');
		await expect(needsYou).toHaveCount(0);
		await expect(row.locator('.bots-trigrow__when.bots-mono')).not.toHaveText(
			'Paused',
		);
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-resumed.png'),
		});
	});

	test('a bot post raises a notification until the user acts on its Chat, and the row opens that Chat', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		test.setTimeout(120_000);
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Lark'));
		const bell = mainWindow.getByRole('button', { name: /^Notifications/ });
		const menu = mainWindow.getByRole('menu', { name: 'Notifications' });
		const botRow = menu.locator('[data-notification-bot]');
		const transcript = tab.locator('[data-terminay-bot-transcript]');

		// Being on screen is not reading: a reply that lands while Chat is in
		// front and the user does nothing is published after the settle period,
		// as an agent's terminal finishing is.
		await send(tab, 'hello');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await expect(mainWindow.locator('.notifications-count')).toHaveText('1', {
			timeout: 15_000,
		});
		// Clicking into the Chat is acting on it, and clears the notification.
		await transcript.click();
		await expect(mainWindow.locator('.notifications-count')).toHaveCount(0);

		// So does asking for the bot from its sidebar row, though its Chat is
		// already in front.
		await send(tab, 'again');
		await expect(transcript.locator('.bots-msg')).toHaveCount(4, {
			timeout: 30_000,
		});
		await expect(mainWindow.locator('.notifications-count')).toHaveText('1', {
			timeout: 15_000,
		});
		await mainWindow.locator('[data-terminay-home-sidebar-bot]').click();
		await expect(mainWindow.locator('.notifications-count')).toHaveCount(0);
		await bell.click();
		await expect(botRow).toHaveCount(0);
		await bell.click();

		// A post while the tab shows Configure is not read, so it raises a row.
		const trigger = await newTrigger(tab, 'Ping', 'check in');
		await trigger.locator('[data-terminay-bot-trigger-run]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		const sessions = tab
			.locator('[data-terminay-bot-session-row]')
			.filter({ hasText: 'Ping' });
		await expect(sessions.first()).toHaveAttribute(
			'data-terminay-bot-session-state',
			'completed',
			{ timeout: 30_000 },
		);
		await expect(mainWindow.locator('.notifications-count')).toHaveText('1', {
			timeout: 15_000,
		});
		// Home's control, the Bots item and the bot's own sidebar row count
		// posts, so a second unread post from the same bot reads 2 there while
		// the header still counts one notification.
		const homeControl = mainWindow.locator(
			'[data-terminay-home-control="true"]',
		);
		const homeUnread = mainWindow.locator(
			'[data-terminay-home-control-unread]',
		);
		const botsUnread = mainWindow.locator(
			'[data-terminay-home-section-badge="bots"]',
		);
		const larkUnread = mainWindow.locator(
			'[data-terminay-home-sidebar-bot-unread]',
		);
		await expect(homeUnread).toHaveText('1');
		await expect(botsUnread).toHaveText('1');
		await expect(larkUnread).toHaveText('1');
		await expect(homeControl).toHaveAccessibleName('Home, 1 unread message');
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await trigger.locator('[data-terminay-bot-trigger-run]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await expect(
			sessions.and(
				tab.locator('[data-terminay-bot-session-state="completed"]'),
			),
		).toHaveCount(2, { timeout: 30_000 });
		await expect(homeUnread).toHaveText('2', { timeout: 15_000 });
		await expect(botsUnread).toHaveText('2');
		await expect(larkUnread).toHaveText('2');
		await expect(mainWindow.locator('.notifications-count')).toHaveText('1');
		await expect(homeControl).toHaveAccessibleName('Home, 2 unread messages');
		await expect(
			mainWindow.locator('[data-terminay-home-section-tab="bots"]'),
		).toHaveAccessibleName('Bots, 2 unread messages');
		await expect(
			mainWindow.locator('[data-terminay-home-sidebar-bot]'),
		).toHaveAccessibleName('Lark, 2 unread messages');
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-unread-counts.png'),
		});
		await bell.click();
		await expect(botRow).toHaveCount(1);
		await expect(botRow).toContainText('2 new messages');
		await expect(botRow).toContainText('Lark');
		// Let the popover finish fading in.
		await mainWindow.waitForTimeout(300);
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-notification-row.png'),
		});

		// Dismissing it changes no tab, and the device's own divider still
		// marks the post when Chat is opened.
		await botRow.getByRole('button', { name: 'Dismiss Lark' }).click();
		await expect(botRow).toHaveCount(0);
		await expect(mainWindow.locator('.notifications-count')).toHaveCount(0);
		await expect(homeUnread).toHaveCount(0);
		await expect(botsUnread).toHaveCount(0);
		await expect(larkUnread).toHaveCount(0);
		await expect(
			tab.locator('[data-terminay-bot-mode-button="configure"]'),
		).toHaveAttribute('aria-pressed', 'true');
		await bell.click();
		await expect(menu).toHaveCount(0);
		await chat(tab);
		await expect(tab.locator('[data-terminay-bot-unread]')).toHaveText(
			'2 new messages',
		);

		// Activating a row opens the bot's Chat and clears the notification.
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await trigger.locator('[data-terminay-bot-trigger-run]').click();
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await expect(mainWindow.locator('.notifications-count')).toHaveText('1', {
			timeout: 30_000,
		});
		await expect(larkUnread).toHaveText('1');
		await bell.click();
		await botRow.locator('.terminal-activity-menu__item').click();
		await expect(menu).toHaveCount(0);
		await expect(
			tab.locator('[data-terminay-bot-mode-button="chat"]'),
		).toHaveAttribute('aria-pressed', 'true');
		await expect(tab.locator('[data-terminay-bot-composer]')).toBeVisible();
		await expect(mainWindow.locator('.notifications-count')).toHaveCount(0);
		// Reading the post in Chat clears every count.
		await expect(homeUnread).toHaveCount(0);
		await expect(botsUnread).toHaveCount(0);
		await expect(larkUnread).toHaveCount(0);
		await expect(homeControl).toHaveAccessibleName('Home');
		await bell.click();
		await expect(botRow).toHaveCount(0);
		await mainWindow.waitForTimeout(300);
		await mainWindow.screenshot({
			path: testInfo.outputPath('bot-notification-cleared.png'),
		});
	});

	test('a trigger opens its own sessions, and the filter clears from the chip, the tab and a session request', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Wren'));
		await send(tab, 'hello');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30_000 },
		);
		const alpha = await newTrigger(tab, 'Alpha check', 'check alpha');
		const beta = await newTrigger(tab, 'Beta check', 'check beta');
		const alphaId = await alpha.getAttribute('data-terminay-bot-trigger');
		const betaId = await beta.getAttribute('data-terminay-bot-trigger');
		await alpha.locator('[data-terminay-bot-trigger-run]').click();
		await beta.locator('[data-terminay-bot-trigger-run]').click();

		const rows = tab.locator('[data-terminay-bot-session-row]');
		const chip = tab.locator('[data-terminay-bot-sessions-trigger]');
		const outcome = tab.locator('[data-terminay-bot-sessions-outcome]');
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await expect(
			rows.and(tab.locator('[data-terminay-bot-session-state="completed"]')),
		).toHaveCount(3, { timeout: 30_000 });

		// The row action lists only that trigger's sessions, newest selected.
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await alpha
			.locator(`[data-terminay-bot-trigger-sessions="${alphaId}"]`)
			.click();
		await expect(chip).toHaveAttribute(
			'data-terminay-bot-sessions-trigger',
			alphaId ?? '',
		);
		await expect(chip).toContainText('Alpha check');
		await expect(rows).toHaveCount(1);
		await expect(rows).toContainText('Alpha check');
		await expect(tab.locator('.bots-srow--on')).toContainText('Alpha check');
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-sessions-filtered.png'),
		});

		// Removing the chip keeps the other filters.
		await outcome.selectOption('completed');
		await tab.locator('[data-terminay-bot-sessions-trigger-clear]').click();
		await expect(chip).toHaveCount(0);
		await expect(outcome).toHaveValue('completed');
		await expect(rows).toHaveCount(3);

		// Choosing the Sessions tab clears only the trigger filter.
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await alpha
			.locator(`[data-terminay-bot-trigger-sessions="${alphaId}"]`)
			.click();
		await expect(chip).toHaveCount(1);
		await tab.locator('[data-terminay-bot-config-tab="sessions"]').click();
		await expect(chip).toHaveCount(0);
		await expect(rows).toHaveCount(3);

		// A saved trigger's sheet offers Sessions; a new trigger's does not.
		await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
		await tab.locator('[data-terminay-bot-trigger-new]').click();
		const editor = mainWindow.locator('[data-terminay-bot-trigger-editor]');
		await expect(editor).toBeVisible();
		await expect(
			editor.locator('[data-terminay-bot-trigger-editor-sessions]'),
		).toHaveCount(0);
		await editor.getByRole('button', { name: 'Cancel' }).click();
		await beta.locator('.bots-trigrow__main').click();
		await expect(editor).toBeVisible();
		await editor.evaluate((node) =>
			Promise.all(
				(node.closest('.bots-trigsheet') ?? node)
					.getAnimations({ subtree: true })
					.map((animation) => animation.finished),
			),
		);
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-editor-sessions-action.png'),
		});
		await editor
			.locator(`[data-terminay-bot-trigger-editor-sessions="${betaId}"]`)
			.click();
		await expect(chip).toHaveAttribute(
			'data-terminay-bot-sessions-trigger',
			betaId ?? '',
		);
		await expect(rows).toHaveCount(1);
		await expect(rows).toContainText('Beta check');

		// A trigger that never ran keeps its filter and says nothing matches.
		const gamma = await newTrigger(tab, 'Gamma check', 'check gamma');
		await gamma.locator('[data-terminay-bot-trigger-sessions]').click();
		await expect(chip).toContainText('Gamma check');
		await expect(rows).toHaveCount(0);
		await expect(
			tab.locator('[data-terminay-bot-panel="sessions"]'),
		).toContainText('No sessions match.');
		await mainWindow.screenshot({
			path: testInfo.outputPath('trigger-sessions-empty.png'),
		});

		// Opening another trigger's session from the rail clears the filter.
		await chat(tab);
		await tab.locator('.bots-sess').filter({ hasText: 'Alpha check' }).click();
		await expect(
			tab.locator('[data-terminay-bot-panel="sessions"]'),
		).toBeVisible();
		await expect(chip).toHaveCount(0);
		await expect(tab.locator('.bots-srow--on')).toContainText('Alpha check');
	});

	test('a new message completes while an older execution is held', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Wagtail'));
		await send(tab, 'hold');
		await expect(tab.locator('[data-terminay-bot-stop]')).toBeVisible({
			timeout: 30000,
		});
		await send(tab, 'next');
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'secret',
			{ timeout: 30000 },
		);
		await expect(tab.locator('.bots-sess')).toHaveCount(2);
		await expect(tab.locator('[data-terminay-bot-stop]')).toHaveCount(1);
		await tab.locator('[data-terminay-bot-stop]').click();
	});

	test('the composer grows with its text to a maximum, then scrolls, and shrinks when sent', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		await mainWindow.setViewportSize({ width: 1280, height: 850 });
		const tab = await chat(await createBot(mainWindow, 'Heron'));
		const composer = tab.locator('[data-terminay-bot-composer]');
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		const box = () =>
			composer.evaluate((el) => ({
				height: el.getBoundingClientRect().height,
				scrolls: el.scrollHeight > el.clientHeight + 1,
				line: Number.parseFloat(getComputedStyle(el).lineHeight),
			}));
		const shot = (name: string) =>
			tab
				.locator('[data-terminay-bot-composer-form]')
				.screenshot({ path: testInfo.outputPath(`${name}.png`) });
		// Heights are written as whole pixels, so allow rounding.
		const near = (target: number) =>
			expect
				.poll(async () => Math.abs((await box()).height - target))
				.toBeLessThan(2);
		const lines = (count: number) =>
			Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n');

		// Empty: three lines, nothing to scroll.
		const empty = await box();
		expect(empty.line).toBeCloseTo(19.5, 0);
		expect(Math.abs(empty.height - 3 * empty.line)).toBeLessThan(2);
		expect(empty.scrolls).toBe(false);
		await shot('composer-empty');

		// Shift+Enter adds lines and grows the box; nothing is sent.
		await composer.click();
		for (let i = 1; i <= 5; i++) {
			if (i > 1) await mainWindow.keyboard.press('Shift+Enter');
			await mainWindow.keyboard.type(`line ${i}`);
		}
		await expect(composer).toHaveValue(lines(5));
		await near(5 * empty.line);
		expect((await box()).scrolls).toBe(false);
		await expect(transcript.locator('.bots-msg')).toHaveCount(0);
		await shot('composer-grown');

		// One long line wraps and grows the box.
		await composer.fill('');
		await composer.fill('wrap '.repeat(400).trim());
		await expect
			.poll(async () => (await box()).height)
			.toBeGreaterThan(4 * empty.line);

		// Forty inserted lines stop at twelve, then scroll.
		await composer.fill('');
		await composer.click();
		await mainWindow.keyboard.insertText(lines(40));
		await near(12 * empty.line);
		expect((await box()).scrolls).toBe(true);
		await composer.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await shot('composer-max');

		// A short window lowers the maximum to 40vh with no text change.
		await mainWindow.setViewportSize({ width: 1280, height: 400 });
		await near(160);
		expect((await box()).scrolls).toBe(true);
		await mainWindow.setViewportSize({ width: 1280, height: 850 });
		await near(12 * empty.line);

		// Deleting text shrinks it; never under three lines.
		await composer.fill(lines(4));
		await near(4 * empty.line);
		await composer.fill('one\ntwo');
		await near(3 * empty.line);
		await composer.fill('');
		await near(empty.height);

		// Narrowing re-wraps the text and grows the box.
		await composer.fill('narrow '.repeat(60).trim());
		const wide = (await box()).height;
		await tab.locator('[data-terminay-bot-composer-form]').evaluate((el) => {
			(el as HTMLElement).style.maxWidth = '320px';
		});
		await expect
			.poll(async () => (await box()).height)
			.toBeGreaterThan(wide + empty.line);
		await tab.locator('[data-terminay-bot-composer-form]').evaluate((el) => {
			(el as HTMLElement).style.maxWidth = '';
		});
		await near(wide);

		// A multi-line draft comes back at its height.
		await composer.fill(lines(6));
		await near(6 * empty.line);
		await openBots(mainWindow);
		await openBotChat(mainWindow, 'Heron');
		await expect(composer).toHaveValue(lines(6));
		await near(6 * empty.line);

		// Enter sends and the box returns to three lines.
		await composer.press('Enter');
		await expect(transcript).toContainText('line 6', { timeout: 30_000 });
		await expect(composer).toHaveValue('');
		await near(empty.height);
	});

	test('images are attached by button, paste and drop, refused when invalid, and sent inline', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Magpie'));
		const composer = tab.locator('[data-terminay-bot-composer]');
		const form = tab.locator('[data-terminay-bot-composer-form]');
		const thumbs = tab.locator(
			'[data-terminay-bot-pending-images] [data-terminay-bot-pending-kind="image"]',
		);
		const refusal = tab.locator('[data-terminay-bot-attach-error]');
		const shot = async (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });
		const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
		// Real PNGs, drawn in the renderer, so thumbnails have something to show.
		const png = async (color: string): Promise<Buffer> =>
			Buffer.from(
				await mainWindow.evaluate((fill) => {
					const canvas = document.createElement('canvas');
					canvas.width = 160;
					canvas.height = 100;
					const g = canvas.getContext('2d')!;
					g.fillStyle = fill;
					g.fillRect(0, 0, 160, 100);
					g.fillStyle = '#fff';
					g.font = 'bold 28px sans-serif';
					g.fillText('IMG', 50, 60);
					return canvas.toDataURL('image/png').split(',')[1]!;
				}, color),
				'base64',
			);
		const transfer = (
			target: Locator,
			kind: 'paste' | 'drop',
			file: { name: string; type: string; base64: string },
		) =>
			target.evaluate(
				(el, { kind, file }) => {
					const bytes = Uint8Array.from(atob(file.base64), (c) =>
						c.charCodeAt(0),
					);
					const data = new DataTransfer();
					data.items.add(new File([bytes], file.name, { type: file.type }));
					if (kind === 'paste')
						el.dispatchEvent(
							new ClipboardEvent('paste', {
								clipboardData: data,
								bubbles: true,
								cancelable: true,
							}),
						);
					else {
						for (const type of ['dragenter', 'dragover', 'drop'])
							el.dispatchEvent(
								new DragEvent(type, {
									dataTransfer: data,
									bubbles: true,
									cancelable: true,
								}),
							);
					}
				},
				{ kind, file },
			);

		// Attach with the paperclip button, through the file picker.
		const chooser = mainWindow.waitForEvent('filechooser');
		await tab.locator('[data-terminay-bot-attach]').click();
		await (await chooser).setFiles({
			name: 'blue.png',
			mimeType: 'image/png',
			buffer: await png('#3b82f6'),
		});
		await expect(thumbs).toHaveCount(1);
		// Paste a screenshot; plain-text paste still reaches the draft.
		await transfer(composer, 'paste', {
			name: 'image.png',
			type: 'image/png',
			base64: (await png('#e8b931')).toString('base64'),
		});
		await expect(thumbs).toHaveCount(2);
		await expect(
			tab.getByRole('button', { name: 'Remove pasted-1.png' }),
		).toBeVisible();
		await composer.fill('');
		await composer.focus();
		await mainWindow.keyboard.insertText('typed text');
		await expect(composer).toHaveValue('typed text');
		// Drop an image onto the composer.
		await transfer(form, 'drop', {
			name: 'green.png',
			type: 'image/png',
			base64: (await png('#45c874')).toString('base64'),
		});
		await expect(thumbs).toHaveCount(3);
		await shot('composer-pending-images');

		// An oversized image and an oversized file are refused; pending stay unchanged.
		const input = tab.locator('[data-terminay-bot-attach-input]');
		await input.setInputFiles({
			name: 'huge.png',
			mimeType: 'image/png',
			buffer: Buffer.concat([pngHeader, Buffer.alloc(2 * 1024 * 1024)]),
		});
		await expect(refusal).toContainText('Images must be 2 MiB');
		await expect(thumbs).toHaveCount(3);
		await input.setInputFiles({
			name: 'huge.zip',
			mimeType: 'application/zip',
			buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
		});
		await expect(refusal).toContainText('Files must be 5 MiB');
		await expect(thumbs).toHaveCount(3);
		await input.setInputFiles({
			name: 'red.png',
			mimeType: 'image/png',
			buffer: await png('#ee6258'),
		});
		await expect(thumbs).toHaveCount(4);
		await input.setInputFiles({
			name: 'fifth.png',
			mimeType: 'image/png',
			buffer: await png('#a3abb9'),
		});
		await expect(refusal).toContainText('at most 4');
		await expect(thumbs).toHaveCount(4);
		await shot('composer-refusal');

		// Removing a thumbnail drops that image.
		for (const name of ['red.png', 'green.png', 'pasted-1.png'])
			await tab.getByRole('button', { name: `Remove ${name}` }).click();
		await expect(thumbs).toHaveCount(1);

		// A send the server refuses (its name is too long to store) keeps the
		// draft and the pending images.
		const longName = `${'n'.repeat(300)}.png`;
		await input.setInputFiles({
			name: longName,
			mimeType: 'image/png',
			buffer: await png('#a3abb9'),
		});
		await expect(thumbs).toHaveCount(2);
		await tab.locator('[data-terminay-bot-send]').click();
		await expect(tab.locator('[data-terminay-bot-chat-error]')).toContainText(
			'file name',
		);
		await expect(composer).toHaveValue('typed text');
		await expect(thumbs).toHaveCount(2);
		await tab.getByRole('button', { name: `Remove ${longName}` }).click();

		// An image-only message posts with Enter and shows the image inline.
		await composer.fill('');
		await expect(tab.locator('[data-terminay-bot-send]')).toBeEnabled();
		await composer.press('Enter');
		await expect(thumbs).toHaveCount(0);
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript.locator('img[alt="blue.png"]')).toBeVisible({
			timeout: 30_000,
		});
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await expect(tab.locator('[data-terminay-bot-send]')).toBeDisabled();
		await shot('chat-image-sent');
	});

	test('any file is attached as a chip, sent beside an image and downloaded intact', async ({
		electronApp,
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Jackdaw'));
		const composer = tab.locator('[data-terminay-bot-composer]');
		const form = tab.locator('[data-terminay-bot-composer-form]');
		const pending = (kind: 'image' | 'file') =>
			tab.locator(
				`[data-terminay-bot-pending-images] [data-terminay-bot-pending-kind="${kind}"]`,
			);
		const input = tab.locator('[data-terminay-bot-attach-input]');
		const shot = async (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });
		const zip = Buffer.concat([
			Buffer.from('504b0304', 'hex'),
			Buffer.from('terminay zip payload '.repeat(4000)),
		]);
		const image = Buffer.from(
			await mainWindow.evaluate(() => {
				const canvas = document.createElement('canvas');
				canvas.width = 160;
				canvas.height = 100;
				const g = canvas.getContext('2d')!;
				g.fillStyle = '#7c5cff';
				g.fillRect(0, 0, 160, 100);
				g.fillStyle = '#fff';
				g.font = 'bold 28px sans-serif';
				g.fillText('IMG', 50, 60);
				return canvas.toDataURL('image/png').split(',')[1]!;
			}),
			'base64',
		);

		// The picker has no type filter; a zip shows as a chip with its size.
		// A file that becomes unreadable reports an inline error and keeps the composer usable.
		await form.evaluate((el) => {
			const file = new File(['unreadable'], 'gone.zip');
			file.slice = () => {
				const head = new Blob();
				head.arrayBuffer = async () => {
					throw new Error('File is no longer available');
				};
				return head;
			};
			const data = new DataTransfer();
			data.items.add(file);
			el.dispatchEvent(
				new DragEvent('drop', {
					dataTransfer: data,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
		await expect(tab.locator('[data-terminay-bot-attach-error]')).toContainText(
			'could not be read',
		);
		await expect(pending('file')).toHaveCount(0);
		await expect(input).not.toHaveAttribute('accept', /.+/);
		const chooser = mainWindow.waitForEvent('filechooser');
		await tab.locator('[data-terminay-bot-attach]').click();
		await (await chooser).setFiles({
			name: 'logs.zip',
			mimeType: 'application/zip',
			buffer: zip,
		});
		await expect(pending('file')).toHaveCount(1);
		await expect(pending('file')).toContainText('logs.zip');
		await expect(pending('file')).toContainText('KB');
		// A dropped PDF is a chip too.
		await form.evaluate((el) => {
			const data = new DataTransfer();
			data.items.add(
				new File(['%PDF-1.7 report'], 'report.pdf', {
					type: 'application/pdf',
				}),
			);
			for (const type of ['dragenter', 'dragover', 'drop'])
				el.dispatchEvent(
					new DragEvent(type, {
						dataTransfer: data,
						bubbles: true,
						cancelable: true,
					}),
				);
		});
		await expect(pending('file')).toHaveCount(2);
		// A zip claiming to be a PNG is still a chip: content decides.
		await input.setInputFiles({
			name: 'x.png',
			mimeType: 'image/png',
			buffer: zip,
		});
		await expect(pending('file')).toHaveCount(3);
		await tab.getByRole('button', { name: 'Remove x.png' }).click();
		await tab.getByRole('button', { name: 'Remove report.pdf' }).click();
		await input.setInputFiles({
			name: 'purple.png',
			mimeType: 'image/png',
			buffer: image,
		});
		await expect(pending('image')).toHaveCount(1);
		await expect(pending('file')).toHaveCount(1);
		await composer.fill('Here are the logs');
		await shot('composer-image-and-zip');

		// Sent: the image inline and the zip as a download chip.
		await composer.press('Enter');
		await expect(pending('file')).toHaveCount(0);
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript.locator('img[alt="purple.png"]')).toBeVisible({
			timeout: 30_000,
		});
		const chip = transcript.locator('[data-terminay-bot-file-chip="logs.zip"]');
		await expect(chip).toBeVisible();
		await expect(chip).toContainText('KB');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		await shot('chat-image-and-zip-sent');

		// Activating the chip saves the exact bytes through the host save.
		const target = path.join(tempDir, 'saved-logs.zip');
		await electronApp.evaluate(({ dialog }, filePath) => {
			dialog.showSaveDialog = (async () => ({
				canceled: false,
				filePath,
			})) as typeof dialog.showSaveDialog;
		}, target);
		await chip.click();
		await expect
			.poll(async () =>
				existsSync(target) ? (await readFile(target)).length : 0,
			)
			.toBe(zip.length);
		expect((await readFile(target)).equals(zip)).toBe(true);
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
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-out',
		);

		// The fake `codex login --device-auth` prints its code and succeeds.
		await tab.locator('[data-terminay-bot-device-start]').click();
		await expect(
			tab.locator('[data-terminay-bot-device-terminal]'),
		).toContainText('TEST-CODE', { timeout: 30_000 });
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-in',
			{
				timeout: 30_000,
			},
		);
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'device',
		);
		await tab
			.locator('[data-terminay-bot-device-terminal] button', {
				hasText: 'Close',
			})
			.click();

		await tab.locator('[data-terminay-bot-device-signout]').click();
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-out',
			{
				timeout: 30_000,
			},
		);
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'none',
		);
	});

	test('a Claude bot signs in with Claude in its own container, and signs out', async ({
		mainWindow,
		tempDir,
	}) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const dashboard = await openBots(mainWindow);
		await dashboard.locator('[data-terminay-bots-new]').first().click();
		const dialog = mainWindow.locator('[data-terminay-bots-new-dialog]');
		await dialog.locator('[data-terminay-bots-new-name]').fill('Claudia');
		await dialog.locator('[data-terminay-bots-new-agent]').selectOption(CLAUDE);
		await dialog.locator('[data-terminay-bots-new-create]').click();
		const tab = frontHomeTab(mainWindow);
		const device = tab.locator('[data-terminay-bot-device]');
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-out',
		);

		// The fake Claude CLI waits for the browser authorization code.
		await tab.locator('[data-terminay-bot-device-start]').click();
		await expect(
			tab.locator('[data-terminay-bot-device-terminal]'),
		).toContainText('TEST-CODE', { timeout: 30_000 });
		await expect(
			tab.locator('[data-terminay-bot-device-terminal]'),
		).toContainText('Paste code here:');
		const codeInput = tab.locator(
			'[data-terminay-bot-device-terminal] .xterm-helper-textarea',
		);
		await codeInput.pressSequentially('TEST-CODE');
		await codeInput.press('Enter');
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-in',
			{
				timeout: 30_000,
			},
		);
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'device',
		);
		await tab
			.locator('[data-terminay-bot-device-terminal] button', {
				hasText: 'Close',
			})
			.click();

		await tab.locator('[data-terminay-bot-device-signout]').click();
		await expect(device).toHaveAttribute(
			'data-terminay-bot-device',
			'signed-out',
			{
				timeout: 30_000,
			},
		);
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
		await expect(
			tab.locator('[data-terminay-bot-panel="profile"]'),
		).toBeVisible();
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'none',
		);
	});

	test('a message that failed to start can be dismissed or retried in place', async ({
		mainWindow,
		tempDir,
	}, testInfo) => {
		await setEngineDown(tempDir, false);
		await engineReady(mainWindow);
		const tab = await chat(await createBot(mainWindow, 'Kestrel', 'none'));
		const warnings = tab.locator('[data-terminay-bot-start-failure]');
		const shot = async (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });

		// A failed start leaves a warning with Retry and Dismiss.
		await send(tab, 'first try');
		await expect(warnings).toHaveCount(1);
		await expect(warnings).toContainText('not signed in');
		await shot('start-failure-warning');

		// Dismiss hides it, and it stays hidden after reopening Chat.
		await warnings.locator('[data-terminay-bot-start-failure-dismiss]').click();
		await expect(warnings).toHaveCount(0);
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await chat(tab);
		await expect(tab.locator('[data-terminay-bot-transcript]')).toContainText(
			'first try',
		);
		await expect(warnings).toHaveCount(0);
		await shot('start-failure-dismissed');

		// Fail again, sign in, then Retry the same message.
		await send(tab, 'hello again');
		await expect(warnings).toHaveCount(1);
		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await tab.locator('[data-terminay-bot-config-tab="profile"]').click();
		const token = tab.locator('[data-terminay-bot-token="ANTHROPIC_API_KEY"]');
		await token
			.locator('[data-terminay-bot-token-input="ANTHROPIC_API_KEY"]')
			.fill(TOKEN);
		await token.locator('button[type="submit"]').click();
		await expect(token).toHaveAttribute(
			'data-terminay-bot-token-configured',
			'true',
		);
		await tab
			.locator('[data-terminay-bot-signin-option="ANTHROPIC_API_KEY"]')
			.click();
		await expect(tab.locator('[data-terminay-bot-signin]')).toHaveAttribute(
			'data-terminay-bot-signin',
			'token',
		);
		await chat(tab);
		await expect(warnings).toHaveCount(1);
		await warnings.locator('[data-terminay-bot-start-failure-retry]').click();
		await expect(warnings).toHaveCount(0);
		const transcript = tab.locator('[data-terminay-bot-transcript]');
		await expect(transcript).toContainText('secret', { timeout: 30_000 });
		// Retry posts no second copy of the message.
		await expect(transcript.getByText('hello again')).toHaveCount(1);
		await expect(tab.locator('[data-terminay-bot-typing]')).toHaveCount(0, {
			timeout: 30_000,
		});
		await shot('start-failure-retried');
	});
});

test('generic command source editor tests without sessions and Disable blocks manual wakes', async ({
	mainWindow,
}, testInfo) => {
	await engineReady(mainWindow);
	const tab = await createBot(mainWindow, 'Source watcher');
	await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
	await expect(tab.locator('[data-terminay-bot-trigger-empty]')).toBeVisible();
	await mainWindow.screenshot({
		path: testInfo.outputPath('triggers-empty.png'),
	});
	await tab.locator('[data-terminay-bot-trigger-start="command"]').click();
	const editor = tab.locator('[data-terminay-bot-trigger-editor]');
	await expect(
		editor.getByRole('combobox', { name: 'Source', exact: true }),
	).toContainText('Command result');
	await editor.getByRole('combobox', { name: 'Source', exact: true }).click();
	await mainWindow.screenshot({
		path: testInfo.outputPath('triggers-source-picker.png'),
		animations: 'disabled',
	});
	await editor
		.getByRole('combobox', { name: 'Source', exact: true })
		.press('Escape');
	await editor.getByLabel('Name', { exact: true }).fill('Watch incoming items');
	await editor.getByLabel('Command / shell script').fill('fixture-items');
	await editor.getByLabel('Check every', { exact: true }).fill('1');
	await pick(editor, 'Unit', 'minutes');
	await pick(editor, 'Fire when', 'items');
	await editor
		.getByLabel('Prompt', { exact: true })
		.fill('Inspect each item for risks.');
	await editor
		.getByRole('button', { name: 'Test source', exact: true })
		.click();
	await expect(editor).toContainText('2 events would fire');
	await editor.locator('[data-terminay-bot-trigger-save]').click();
	const row = tab
		.locator('[data-terminay-bot-trigger]')
		.filter({ hasText: 'Watch incoming items' });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Run now', exact: true }).click();
	await expect(row).toContainText('Completed', { timeout: 30000 });
	await tab.getByRole('button', { name: 'Disable bot', exact: true }).click();
	await expect(tab).toContainText('Sources and automatic wake-ups are paused');
	await expect(
		row.getByRole('button', { name: 'Run now', exact: true }),
	).toBeDisabled();
	await tab
		.locator('.bots-ahead')
		.getByRole('button', { name: 'Enable bot', exact: true })
		.click();
	await expect(
		row.getByRole('button', { name: 'Run now', exact: true }),
	).toBeEnabled();
});

test('generic network and file sources preview real checks without starting sessions', async ({
	mainWindow,
}) => {
	test.setTimeout(90000);
	await engineReady(mainWindow);
	const tab = await createBot(mainWindow, 'Network watcher');
	await tab.locator('[data-terminay-bot-config-tab="triggers"]').click();
	await tab.locator('[data-terminay-bot-trigger-new]').click();
	const editor = tab.locator('[data-terminay-bot-trigger-editor]');
	await editor.getByLabel('Name', { exact: true }).fill('Observe status');
	await editor.getByLabel('Prompt', { exact: true }).fill('Inspect the event.');
	await pick(editor, 'Source', 'http');
	await editor
		.getByLabel('URL', { exact: true })
		.fill('https://fixture.invalid/status');
	await pick(editor, 'If Terminay Server was offline', 'once');
	await editor
		.getByRole('button', { name: 'Test source', exact: true })
		.click();
	await expect(editor).toContainText('0 events would fire');
	await pick(editor, 'Source', 'sse');
	await editor
		.getByLabel('URL', { exact: true })
		.fill('https://fixture.invalid/events');
	await editor
		.getByRole('button', { name: 'Test source', exact: true })
		.click();
	await expect(editor).toContainText('1 event would fire', { timeout: 20000 });
	await pick(editor, 'Source', 'files');
	await editor
		.getByLabel('File or folder path', { exact: true })
		.fill('/home/bot/incoming');
	await editor
		.getByRole('button', { name: 'Test source', exact: true })
		.click();
	await expect(editor).toContainText('0 events would fire', { timeout: 20000 });
	await expect(editor).toContainText('Continuous watching keeps it running.');
});
