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

test.describe('Home › Bots', () => {
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
			'MCP adapter could not connect',
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
		const failedId = await link.getAttribute('data-terminay-bot-failure-session');
		await link.click();
		await expect(
			tab.locator(`[data-terminay-bot-session="${failedId}"]`),
		).toBeVisible();
		await expect(tab.locator('[data-terminay-bot-sessions-origin]')).toHaveValue(
			'all',
		);

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
		await expect(rows.filter({ has: tab.page().locator('.bots-state--failed') })).toHaveCount(3, {
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
		await mainWindow.screenshot({
		});

		await tab.locator('[data-terminay-bot-mode-button="configure"]').click();
		await chat(tab);
		await expect(transcript.locator('.bots-msg')).toHaveCount(3);
		await expect(divider).toHaveCount(0);
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
			'[data-terminay-bot-pending-images] .bots-composer__image',
		);
		const refusal = tab.locator('[data-terminay-bot-attach-error]');
		const shot = async (name: string) =>
			mainWindow.screenshot({ path: testInfo.outputPath(`${name}.png`) });
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

		// A non-image and an oversized image are refused; pending stay unchanged.
		const input = tab.locator('[data-terminay-bot-attach-input]');
		await input.setInputFiles({
			name: 'notes.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('not an image'),
		});
		await expect(refusal).toContainText('PNG, JPEG, GIF and WebP');
		await expect(thumbs).toHaveCount(3);
		await input.setInputFiles({
			name: 'huge.png',
			mimeType: 'image/png',
			buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
		});
		await expect(refusal).toContainText('2 MiB');
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

		// A send the server refuses keeps the draft and the pending images.
		await input.setInputFiles({
			name: 'fake.png',
			mimeType: 'image/png',
			buffer: Buffer.from('this is not really a png'),
		});
		await expect(thumbs).toHaveCount(2);
		await tab.locator('[data-terminay-bot-send]').click();
		await expect(tab.locator('[data-terminay-bot-chat-error]')).toContainText(
			'PNG, JPEG, GIF and WebP',
		);
		await expect(composer).toHaveValue('typed text');
		await expect(thumbs).toHaveCount(2);
		await tab.getByRole('button', { name: 'Remove fake.png' }).click();

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
