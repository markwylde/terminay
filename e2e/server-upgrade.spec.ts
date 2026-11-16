import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;

/** What `daemon upgrade --check` prints: one line describing the install. */
function checkAnswer(overrides: Record<string, unknown> = {}) {
	return {
		schemaVersion: 1,
		environment: 'user',
		installed: { channel: 'tag', version: '5.1.1', revision: 'aaaa111' },
		available: { version: '5.2.0', revision: 'bbbb222' },
		canUpgrade: true,
		modes: ['in-place'],
		trigger: { kind: 'spawn' },
		unavailable: null,
		lastResult: null,
		...overrides,
	};
}

type FakeUpgrader = Readonly<{
	path: string;
	/** What the next check answers. */
	answer: (value: Record<string, unknown>) => Promise<void>;
	/** What a check answers once a started upgrade has run its course. */
	answerAfterUpgrade: (value: Record<string, unknown>) => Promise<void>;
	/** The argument vectors it was started with, checks excluded. */
	upgrades: () => Promise<string[]>;
}>;

/**
 * A stand-in for the release's `bin/terminay`. A check prints the answer the
 * test last wrote; an upgrade records how it was started, takes a while, and
 * then leaves the answer the test prepared for afterwards.
 */
async function fakeUpgrader(
	root: string,
	options: Readonly<{ upgradeSeconds: number }>,
): Promise<FakeUpgrader> {
	const directory = path.join(root, 'fake-upgrader');
	await mkdir(directory, { recursive: true });
	const script = path.join(directory, 'terminay');
	const check = path.join(directory, 'check.json');
	const after = path.join(directory, 'after.json');
	const calls = path.join(directory, 'calls');
	await writeFile(
		script,
		`#!/bin/sh
if [ "$3" = "--check" ]; then
	cat '${check}'
	exit 0
fi
printf '%s\\n' "$*" >> '${calls}'
sleep ${options.upgradeSeconds}
if [ -f '${after}' ]; then
	cp '${after}' '${check}'
fi
`,
	);
	await chmod(script, 0o755);
	await writeFile(check, `${JSON.stringify(checkAnswer())}\n`);
	return {
		path: script,
		answer: (value) => writeFile(check, `${JSON.stringify(value)}\n`),
		answerAfterUpgrade: (value) =>
			writeFile(after, `${JSON.stringify(value)}\n`),
		upgrades: async () =>
			(await readFile(calls, 'utf8').catch(() => ''))
				.split('\n')
				.filter(Boolean),
	};
}

type StandaloneServer = Readonly<{
	pairingUrl: string;
	stop: () => Promise<void>;
}>;

/** Start the compiled standalone server as a release would: with the upgrader
 * its launcher names. A port is given to bring the same server back. */
async function startStandaloneServer(
	root: string,
	upgraderPath: string,
	port = 0,
): Promise<StandaloneServer> {
	const dataRoot = path.join(root, 'standalone-data');
	const projectRoot = path.join(root, 'standalone-project');
	await mkdir(dataRoot, { recursive: true });
	await mkdir(projectRoot, { recursive: true });
	const child: ChildProcess = spawn(
		process.execPath,
		[
			path.resolve('apps/terminay-server/dist/cli.js'),
			'--server-id',
			'build-box',
			'--data-root',
			dataRoot,
			'--project-root',
			projectRoot,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			String(port),
		],
		{
			env: { ...process.env, TERMINAY_UPGRADER: upgraderPath },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let stderr = '';
	child.stderr?.on('data', (chunk) => {
		stderr += String(chunk);
	});
	const stop = async () => {
		if (child.exitCode !== null) return;
		child.kill('SIGTERM');
		await Promise.race([
			once(child, 'exit'),
			new Promise((resolve) => setTimeout(resolve, 5_000)),
		]);
		if (child.exitCode === null) child.kill('SIGKILL');
	};
	try {
		const pairingUrl = await new Promise<string>((resolve, reject) => {
			let buffered = '';
			const timeout = setTimeout(
				() => reject(new Error(`standalone server was not ready: ${stderr}`)),
				20_000,
			);
			child.once('exit', (code) => {
				clearTimeout(timeout);
				reject(new Error(`standalone server exited ${code}: ${stderr}`));
			});
			child.stdout?.on('data', (chunk) => {
				buffered += String(chunk);
				const lines = buffered.split('\n');
				buffered = lines.pop() ?? '';
				for (const line of lines) {
					try {
						const parsed = JSON.parse(line) as {
							ready?: unknown;
							pairing?: { pairingUrl?: unknown };
						};
						if (
							parsed.ready === true &&
							typeof parsed.pairing?.pairingUrl === 'string'
						) {
							clearTimeout(timeout);
							resolve(parsed.pairing.pairingUrl);
						}
					} catch {
						// Only the readiness line is protocol output.
					}
				}
			});
		});
		return { pairingUrl, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

function connectionMenu(window: Page) {
	return window
		.locator('[role="menu"][aria-label="Connection menu"]:visible')
		.first();
}

async function openConnectionMenu(window: Page) {
	await window.locator('.project-tabbar').waitFor({ state: 'visible' });
	const menu = connectionMenu(window);
	if (!(await menu.isVisible().catch(() => false)))
		await window.getByRole('button', { name: /Open connection menu/ }).click();
	await expect(menu).toBeVisible();
	return menu;
}

/** Wait until a window's connection menu marks this server as the one shown. */
async function expectShowing(window: Page, label: string) {
	await expect(async () => {
		const menu = await openConnectionMenu(window);
		await expect(
			menu.getByRole('menuitemradio', { name: label, exact: true }),
		).toHaveAttribute('aria-checked', 'true', { timeout: 2_000 });
	}).toPass({ timeout: 45_000 });
}

/** Pair a standalone server from Settings › Remote Access and wait until the workspace
 * window is showing it. */
async function pairAndLand(
	appHarness: {
		openChildWindow: (action: () => Promise<void>) => Promise<Page>;
	},
	mainWindow: Page,
	server: { pairingUrl: string },
	/** A name to give the connection once it is paired. */
	rename?: string,
) {
	const serverHost = new URL(server.pairingUrl).host;
	const manager = await appHarness.openChildWindow(async () => {
		await mainWindow
			.getByRole('button', { name: /Open connection menu/ })
			.click();
		await mainWindow
			.getByRole('button', { name: 'Manage connections' })
			.click();
	});
	await manager.getByRole('button', { name: 'Add server…' }).click();
	await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
	await manager
		.getByRole('button', { name: 'Continue pairing', exact: true })
		.click();
	await expectShowing(mainWindow, serverHost);
	await mainWindow.keyboard.press('Escape');
	if (rename === undefined) return serverHost;
	await manager.getByRole('button', { name: 'Rename', exact: true }).click();
	const form = manager.getByRole('form', { name: 'Rename connection' });
	await form.getByLabel('Connection name').fill(rename);
	await form.getByRole('button', { name: 'Save name' }).click();
	await expectShowing(mainWindow, rename);
	await mainWindow.keyboard.press('Escape');
	return rename;
}

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

const headerControl = (window: Page) =>
	window.getByRole('button', { name: /Open connection menu/ });
const upgradeIndicator = (window: Page) =>
	window.locator('[data-server-upgrade-indicator]');
const upgradeRow = (scope: ReturnType<typeof connectionMenu>) =>
	scope.locator('[data-server-upgrade-profile-id]');
const confirmationOf = (window: Page) =>
	window.locator('[data-server-upgrade-dialog]');
const notificationsBell = (window: Page) =>
	window.getByRole('button', { name: /^Notifications/ });
const progressCard = (window: Page) =>
	window.locator('[data-server-upgrade-progress]');
const stepState = (window: Page, step: string) =>
	progressCard(window).locator(`[data-step="${step}"]`);

/** The ticklist's step states, in order. */
async function expectTicks(window: Page, states: readonly string[]) {
	for (const [index, step] of [
		'start',
		'install',
		'restart',
		'running',
	].entries())
		await expect(stepState(window, step)).toHaveAttribute(
			'data-step-state',
			states[index] ?? '',
			{ timeout: 120_000 },
		);
}

/**
 * The card's centre, after checking it sits on a backdrop that covers the
 * whole window. The centre is what must not move: the card grows a line or a
 * button as the upgrade goes on, and stays centred.
 */
async function modalCardCentre(window: Page) {
	const modal = window.locator('[data-server-upgrade-modal]');
	await expect(modal).toBeVisible();
	await expect(modal.locator('[data-server-upgrade-progress]')).toBeVisible();
	const viewport = await window.evaluate(() => ({
		width: window.innerWidth,
		height: window.innerHeight,
	}));
	const backdrop = await modal.boundingBox();
	expect(backdrop).toEqual({ x: 0, y: 0, ...viewport });
	const box = await progressCard(window).boundingBox();
	if (box === null) throw new Error('The upgrade card has no box.');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function expectSamePlace(
	actual: { x: number; y: number },
	expected: { x: number; y: number },
) {
	expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(1);
	expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(1);
}

/** A screenshot for the pull request, kept with the run's artifacts. */
async function capture(window: Page, name: string) {
	await window.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

/**
 * The card's header as drawn: the title on one line, cut or not, its tooltip
 * the full title, the versions wholly beneath it in as many lines as they
 * need, and nothing in the card drawn past its edge.
 */
async function expectCardHeader(
	window: Page,
	expected: Readonly<{ cut: boolean; versionLines: 'one' | 'several' }>,
) {
	const card = progressCard(window);
	const title = card.locator('.server-upgrade-progress__title');
	await expect(title).toHaveAttribute(
		'title',
		(await card.getAttribute('aria-label')) ?? '',
	);
	const drawn = await card.evaluate((element) => {
		const titleElement = element.querySelector(
			'.server-upgrade-progress__title',
		) as HTMLElement;
		const versions = element.querySelector(
			'.server-upgrade-progress__versions',
		) as HTMLElement;
		const lines = (target: HTMLElement) =>
			Math.round(
				target.getBoundingClientRect().height /
					Number.parseFloat(getComputedStyle(target).lineHeight),
			);
		const edge = element.getBoundingClientRect();
		const outside = [
			...element.querySelectorAll<HTMLElement>('h2, p, li, span, button'),
		]
			.filter((child) => {
				const box = child.getBoundingClientRect();
				return (
					box.width > 1 &&
					(box.left < edge.left - 0.5 || box.right > edge.right + 0.5)
				);
			})
			.map((child) => child.className || child.tagName);
		return {
			titleLines: lines(titleElement),
			titleCut: titleElement.scrollWidth > titleElement.clientWidth,
			versionLines: lines(versions),
			versionsBelow:
				versions.getBoundingClientRect().top >=
				titleElement.getBoundingClientRect().bottom - 0.5,
			outside,
		};
	});
	expect(drawn.titleLines, 'the title is one line').toBe(1);
	expect(drawn.titleCut, 'the title is cut').toBe(expected.cut);
	expect(drawn.versionsBelow, 'the versions are beneath the title').toBe(true);
	if (expected.versionLines === 'one') expect(drawn.versionLines).toBe(1);
	else expect(drawn.versionLines).toBeGreaterThan(1);
	expect(drawn.outside, 'nothing is drawn past the card edge').toEqual([]);
}

/**
 * Every text and icon of the card against its surface, as WCAG contrast
 * ratios, in the given appearance: text needs 4.5:1, icons and the focus
 * ring 3:1. Returns the surface colour so appearances can be compared.
 */
async function expectLegibleIn(window: Page, scheme: 'light' | 'dark') {
	await window.emulateMedia({ colorScheme: scheme });
	const { surface, ratios, focusStyle } = await progressCard(window).evaluate(
		(element) => {
			const channels = (value: string) =>
				(value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
			const luminance = (value: string) => {
				const [r = 0, g = 0, b = 0] = channels(value).map((channel) => {
					const c = channel / 255;
					return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
				});
				return 0.2126 * r + 0.7152 * g + 0.0722 * b;
			};
			const background = getComputedStyle(element).backgroundColor;
			const ratio = (value: string) => {
				const [light, dark] = [luminance(value), luminance(background)].sort(
					(a, b) => b - a,
				);
				return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
			};
			const found: Record<string, number> = {};
			const add = (key: string, target: Element | null, property = 'color') => {
				if (target !== null)
					found[key] = ratio(
						getComputedStyle(target).getPropertyValue(property),
					);
			};
			add(
				'text:title',
				element.querySelector('.server-upgrade-progress__title'),
			);
			add(
				'text:versions',
				element.querySelector('.server-upgrade-progress__versions'),
			);
			for (const step of element.querySelectorAll('[data-step]')) {
				const state = step.getAttribute('data-step-state');
				add(
					`text:${state} step`,
					step.querySelector('.server-upgrade-progress__label'),
				);
				add(
					`icon:${state} step`,
					step.querySelector('.server-upgrade-progress__icon'),
				);
			}
			add(
				'text:detail',
				element.querySelector('.server-upgrade-progress__detail'),
			);
			add('text:note', element.querySelector('.server-upgrade-progress__note'));
			const close = element.querySelector(
				'.server-upgrade-progress__actions button',
			);
			add('text:close', close);
			let focusStyle: string | undefined;
			if (close !== null && close === document.activeElement) {
				add('icon:focus ring', close, 'outline-color');
				focusStyle = getComputedStyle(close).outlineStyle;
			}
			return { surface: background, ratios: found, focusStyle };
		},
	);
	for (const [key, value] of Object.entries(ratios))
		expect(value, `${scheme}: ${key} contrast`).toBeGreaterThanOrEqual(
			key.startsWith('icon:') ? 3 : 4.5,
		);
	return { surface, focusStyle };
}

/** The card checked and captured in both appearances; the surfaces differ. */
async function captureBothAppearances(window: Page, name: string) {
	const dark = await expectLegibleIn(window, 'dark');
	await capture(window, `${name}-dark`);
	const light = await expectLegibleIn(window, 'light');
	await capture(window, `${name}-light`);
	expect(light.surface).not.toBe(dark.surface);
	await window.emulateMedia({ colorScheme: null });
	return { dark, light };
}

/** Opens the header Notifications list at the upgrade's outcome. */
async function openUpgradeNotice(window: Page, tone?: 'success' | 'failure') {
	await notificationsBell(window).click();
	const menu = window.getByRole('menu', { name: 'Notifications' });
	await expect(menu).toBeVisible();
	return menu.locator(
		tone === undefined
			? '[data-server-upgrade-notice]'
			: `[data-server-upgrade-notice="${tone}"]`,
	);
}

test('a server with an upgrade is marked, confirmed, followed, and told once', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	// Local is updated with Terminay Desktop and never shows a server upgrade.
	await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
	// Long enough to check and capture the card while it installs.
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 15 });
	const server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);

		// The header warns for the server the window is working in.
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
			{ timeout: 30_000 },
		);
		await expect(headerControl(mainWindow)).toHaveAccessibleName(
			/, upgrade to 5\.2\.0 available$/,
		);

		// Its menu row is marked with the version and offers the action.
		let menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('Update available · 5.2.0');
		await menu.getByRole('menuitem', { name: 'Upgrade server…' }).click();

		// The confirmation names both versions and the brief disconnect, and
		// dismissing it sends nothing.
		const confirmation = confirmationOf(mainWindow);
		await expect(confirmation).toContainText(`${serverHost} is running 5.1.1.`);
		await expect(confirmation).toContainText('Version 5.2.0 is available.');
		await expect(confirmation).toContainText(
			'The connection to this server drops briefly while it restarts. Its terminals keep running.',
		);
		expect(await upgrader.upgrades()).toEqual([]);
		await confirmation.getByRole('button', { name: 'Cancel' }).click();
		await expect(confirmation).toHaveCount(0);
		expect(await upgrader.upgrades()).toEqual([]);
		await expect(upgradeIndicator(mainWindow)).toHaveCount(1);

		// Confirmed: the request names the mode and nothing else.
		await upgrader.answerAfterUpgrade(
			checkAnswer({
				installed: { channel: 'tag', version: '5.2.0', revision: 'bbbb222' },
				available: null,
				lastResult: {
					from: '5.1.1',
					to: '5.2.0',
					outcome: 'succeeded',
					// A real upgrader stamps its record when it finishes. This
					// answer is written before the upgrade begins, and an outcome
					// older than the upgrade's start is rightly not taken for its.
					at: new Date(Date.now() + 60_000).toISOString(),
				},
			}),
		);
		menu = await openConnectionMenu(mainWindow);
		await menu.getByRole('menuitem', { name: 'Upgrade server…' }).click();
		await confirmation
			.getByRole('button', { name: 'Upgrade', exact: true })
			.click();
		await expect(confirmation).toHaveCount(0);
		// The confirmation became the upgrade's ticklist.
		const card = progressCard(mainWindow);
		await expect(card).toBeVisible();
		await expect(card).toHaveAttribute('role', 'status');
		await expect(card).toHaveAccessibleName(`Upgrading ${serverHost}`);
		await expect(card).toContainText('5.1.1 → 5.2.0');
		await expect(stepState(mainWindow, 'install')).toContainText(
			'Installing 5.2.0',
		);
		await expectTicks(mainWindow, ['done', 'running', 'waiting', 'waiting']);
		// It is modal over the whole window, centred, with nothing to dismiss.
		const installing = await modalCardCentre(mainWindow);
		await expect(card.getByRole('button')).toHaveCount(0);
		// A short name fits: the title in full on one line, the versions on
		// the line beneath, legible in either appearance.
		await expectCardHeader(mainWindow, { cut: false, versionLines: 'one' });
		await captureBothAppearances(mainWindow, '01-upgrade-installing');
		await expect
			.poll(() => upgrader.upgrades(), { timeout: 15_000 })
			.toEqual(['daemon upgrade --user']);

		// The ticklist ends with every step done, and stays until closed.
		await expect(card).toHaveAttribute(
			'data-server-upgrade-outcome',
			'success',
			{ timeout: 45_000 },
		);
		await expectTicks(mainWindow, ['done', 'done', 'done', 'done']);
		await expect(card).toHaveAccessibleName(`${serverHost} is upgraded`);
		expectSamePlace(await modalCardCentre(mainWindow), installing);
		await expectCardHeader(mainWindow, { cut: false, versionLines: 'one' });
		await captureBothAppearances(mainWindow, '03-upgrade-succeeded');
		await card.getByRole('button', { name: 'Close' }).click();
		await expect(card).toHaveCount(0);
		await expect(mainWindow.locator('[data-server-upgrade-modal]')).toHaveCount(
			0,
		);

		// The outcome is told once, in Notifications, and the warning is gone.
		// Nothing is drawn over the workspace.
		await expect(notificationsBell(mainWindow)).toHaveAccessibleName(
			/Notifications, \d+ notification/,
			{ timeout: 45_000 },
		);
		const notice = await openUpgradeNotice(mainWindow);
		await expect(notice.locator('.terminal-activity-menu__title')).toHaveText(
			`${serverHost} is now on 5.2.0.`,
		);
		await expect(notice).toHaveCount(1);
		await expect(mainWindow.locator('.server-upgrade-notices')).toHaveCount(0);
		await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
		await expect(headerControl(mainWindow)).not.toHaveAccessibleName(/upgrade/);
		await notice.getByRole('button', { name: 'Dismiss' }).click();
		await expect(notice).toHaveCount(0);
		await mainWindow.keyboard.press('Escape');
		menu = await openConnectionMenu(mainWindow);
		// Nothing is on offer any more, but the server can still be asked.
		await expect(upgradeRow(menu)).toHaveAttribute(
			'data-server-upgrade-state',
			'none',
		);
		await expect(upgradeRow(menu)).toContainText('Running 5.2.0');
		await expect(
			upgradeRow(menu).getByRole('menuitem', { name: 'Upgrade server…' }),
		).toHaveCount(0);
		await upgradeRow(menu)
			.getByRole('menuitem', { name: 'Check for updates' })
			.click();
		await expect(upgradeRow(menu).getByRole('status')).toHaveText(
			'Up to date · 5.2.0',
		);
	} finally {
		await server.stop();
	}
});

test('a server that cannot upgrade itself shows why and a command to copy, and Local shows nothing', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 1 });
	await upgrader.answer(
		checkAnswer({
			environment: 'system',
			canUpgrade: false,
			trigger: { kind: 'request-file', path: '/run/terminay-upgrade/request' },
			unavailable: {
				reason: 'The upgrade helper is not installed on this server.',
				command: 'sudo terminay daemon upgrade',
			},
		}),
	);
	const server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		await pairAndLand(appHarness, mainWindow, server);
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
			{ timeout: 30_000 },
		);
		let menu = await openConnectionMenu(mainWindow);
		const row = upgradeRow(menu);
		await expect(row).toContainText('Update available · 5.2.0');
		await expect(row).toContainText(
			'The upgrade helper is not installed on this server.',
		);
		await expect(row.locator('code')).toHaveText(
			'sudo terminay daemon upgrade',
		);
		await expect(
			row.getByRole('button', { name: 'Copy upgrade command' }),
		).toBeVisible();
		await expect(
			menu.getByRole('menuitem', { name: 'Upgrade server…' }),
		).toHaveCount(0);

		// Local, in the same window: no icon, no row, no action.
		await menu
			.getByRole('menuitemradio', { name: 'Local', exact: true })
			.click();
		await expectShowing(mainWindow, 'Local');
		await expect(upgradeIndicator(mainWindow)).toHaveCount(0);
		await expect(headerControl(mainWindow)).not.toHaveAccessibleName(/upgrade/);
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toHaveCount(0);
		expect(await upgrader.upgrades()).toEqual([]);
	} finally {
		await server.stop();
	}
});

test('a server that restarts and rolls back says why and keeps its warning', async ({
	appHarness,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(300_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	// Long enough that the server is still mid-upgrade when it goes away.
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 120 });
	let server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		const serverHost = await pairAndLand(appHarness, mainWindow, server);
		const port = Number(new URL(server.pairingUrl).port);
		let menu = await openConnectionMenu(mainWindow);
		await menu
			.getByRole('menuitem', { name: 'Upgrade server…' })
			.click({ timeout: 30_000 });
		await confirmationOf(mainWindow)
			.getByRole('button', { name: 'Upgrade', exact: true })
			.click();

		const card = progressCard(mainWindow);
		await expect(card).toBeVisible();
		await expect(stepState(mainWindow, 'install')).toHaveAttribute(
			'data-step-state',
			'running',
		);
		const installing = await modalCardCentre(mainWindow);
		await expect(card.getByRole('button')).toHaveCount(0);

		// The server goes away mid-upgrade. The drop is the restart step, not a
		// stall, and the card stays where it was.
		await server.stop();
		await expectTicks(mainWindow, ['done', 'done', 'running', 'waiting']);
		await expect(card).toContainText('Disconnected while the server restarts', {
			timeout: 60_000,
		});
		expectSamePlace(await modalCardCentre(mainWindow), installing);
		await expect(mainWindow.getByText('Terminal stream stalled')).toHaveCount(
			0,
		);
		await expect(mainWindow.getByText('Connection lost')).toHaveCount(0);
		await captureBothAppearances(mainWindow, '02-upgrade-restarting');

		// The previous release comes back.
		await upgrader.answer(
			checkAnswer({
				lastResult: {
					from: '5.1.1',
					to: '5.2.0',
					outcome: 'rolled-back',
					reason: 'the new release did not become ready',
					at: new Date().toISOString(),
				},
			}),
		);
		server = await startStandaloneServer(tempDir, upgrader.path, port);

		// The window reconnects by itself: nobody presses Retry. While the
		// server was away the workspace may have given way to the reconnecting
		// screen, so what was being followed has to outlive it.
		await mainWindow
			.locator('.project-tabbar')
			.waitFor({ state: 'visible', timeout: 120_000 });

		// The ticklist ends on the failed step, with why and what runs now.
		await expect(card).toHaveAttribute(
			'data-server-upgrade-outcome',
			'failure',
			{
				timeout: 120_000,
			},
		);
		await expectTicks(mainWindow, ['done', 'done', 'done', 'failed']);
		await expect(stepState(mainWindow, 'running')).toContainText(
			'the new release did not become ready. 5.1.1 is running again.',
		);
		await expect(card).toHaveAccessibleName(`${serverHost} was not upgraded`);
		expectSamePlace(await modalCardCentre(mainWindow), installing);
		// The failed step, its reason and Close are legible in either
		// appearance, and Close shows where keyboard focus is.
		const close = card.getByRole('button', { name: 'Close' });
		await close.focus();
		await mainWindow.keyboard.press('Shift');
		const ended = await captureBothAppearances(
			mainWindow,
			'04-upgrade-rolled-back',
		);
		expect(ended.dark.focusStyle).toBe('solid');
		expect(ended.light.focusStyle).toBe('solid');
		await close.click();
		await expect(card).toHaveCount(0);

		await expect(notificationsBell(mainWindow)).toHaveAccessibleName(
			/Notifications, \d+ notification/,
			{ timeout: 120_000 },
		);
		const notice = await openUpgradeNotice(mainWindow, 'failure');
		await expect(notice.locator('.terminal-activity-menu__title')).toHaveText(
			`Upgrading ${serverHost} failed: the new release did not become ready. 5.1.1 is running again.`,
		);
		await expect(notice).toHaveCount(1);
		await mainWindow.keyboard.press('Escape');
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			'5.2.0',
		);
		// The row carries the same outcome for a device that attaches later.
		menu = await openConnectionMenu(mainWindow);
		await expect(upgradeRow(menu)).toContainText('5.1.1 is running again.');
		await expect(
			menu.getByRole('menuitem', { name: 'Upgrade server…' }),
		).toBeVisible();
	} finally {
		await server.stop();
	}
});

test('a long server name and long versions keep the card and the confirmation tidy', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(240_000);
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const from = '6.10.0-main.3420.canary';
	const to = '6.10.0-main.3421.canary.0f9c2d7e41b8a6c3d5e7f9a1b2c4d6e8f0a1b3c5';
	const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 15 });
	await upgrader.answer(
		checkAnswer({
			installed: { channel: 'tag', version: from, revision: 'aaaa111' },
			available: { version: to, revision: 'bbbb222' },
		}),
	);
	const server = await startStandaloneServer(tempDir, upgrader.path);
	try {
		const name = await pairAndLand(
			appHarness,
			mainWindow,
			server,
			'Pop Terminay — the build cluster in the basement rack',
		);
		await expect(upgradeIndicator(mainWindow)).toHaveAttribute(
			'data-server-upgrade-indicator',
			to,
			{ timeout: 30_000 },
		);

		// The confirmation's title is one line, cut, with the whole as a tooltip.
		const menu = await openConnectionMenu(mainWindow);
		await menu.getByRole('menuitem', { name: 'Upgrade server…' }).click();
		const confirmation = confirmationOf(mainWindow);
		await expect(confirmation).toBeVisible();
		const heading = mainWindow
			.locator('[data-in-page-window="server-upgrade"]')
			.locator('.in-page-window__title');
		await expect(heading).toHaveText(`Upgrade ${name}`);
		await expect(heading).toHaveAttribute('title', `Upgrade ${name}`);
		expect(
			await heading.evaluate((element) => ({
				oneLine:
					element.getBoundingClientRect().height <=
					Number.parseFloat(getComputedStyle(element).lineHeight) * 1.5,
				cut: element.scrollWidth > element.clientWidth,
			})),
		).toEqual({ oneLine: true, cut: true });
		// Its body wraps the long name and versions inside the window.
		const summary = confirmation.locator('.server-upgrade-dialog__summary');
		await expect(summary).toContainText(to);
		expect(
			await summary.evaluate((element) => {
				const window = element.closest('.in-page-window');
				const outer = (window ?? element).getBoundingClientRect();
				const range = document.createRange();
				range.selectNodeContents(element);
				const text = range.getBoundingClientRect();
				return (
					element.scrollWidth <= element.clientWidth &&
					text.right <= outer.right - 1
				);
			}),
		).toBe(true);
		await capture(mainWindow, '05-long-name-confirmation');

		await upgrader.answerAfterUpgrade(
			checkAnswer({
				installed: { channel: 'tag', version: to, revision: 'bbbb222' },
				available: null,
				lastResult: {
					from,
					to,
					outcome: 'succeeded',
					at: new Date(Date.now() + 60_000).toISOString(),
				},
			}),
		);
		await confirmation
			.getByRole('button', { name: 'Upgrade', exact: true })
			.click();

		// The card cuts the long title on one line and keeps the whole as its
		// tooltip and name; the long versions wrap beneath it, in full.
		const card = progressCard(mainWindow);
		await expect(card).toHaveAccessibleName(`Upgrading ${name}`);
		await expect(card.locator('.server-upgrade-progress__versions')).toHaveText(
			`${from} → ${to}`,
		);
		await expect(stepState(mainWindow, 'install')).toHaveAttribute(
			'data-step-state',
			'running',
		);
		await expectCardHeader(mainWindow, { cut: true, versionLines: 'several' });
		await captureBothAppearances(mainWindow, '06-long-name-installing');

		// So does the outcome's title.
		await expect(card).toHaveAttribute(
			'data-server-upgrade-outcome',
			'success',
			{ timeout: 60_000 },
		);
		await expect(card).toHaveAccessibleName(`${name} is upgraded`);
		await expectCardHeader(mainWindow, { cut: true, versionLines: 'several' });
		await captureBothAppearances(mainWindow, '07-long-name-succeeded');

		// At phone width the card fits the screen and still draws nothing past
		// its edge.
		await resize(mainWindow, electronApp, PHONE);
		await expect(async () => {
			const box = await card.boundingBox();
			expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
				PHONE.width - 32,
			);
		}).toPass({ timeout: 10_000 });
		await expectCardHeader(mainWindow, { cut: true, versionLines: 'several' });
		await captureBothAppearances(mainWindow, '08-long-name-phone');
		await card.getByRole('button', { name: 'Close' }).click();
		await expect(card).toHaveCount(0);
	} finally {
		await server.stop();
	}
});

test.describe('server upgrade at phone width', () => {
	test('the connection glyph warns, the switcher lists the row, and the confirmation fits', async ({
		appHarness,
		electronApp,
		mainWindow,
		tempDir,
	}) => {
		test.setTimeout(240_000);
		await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
		const upgrader = await fakeUpgrader(tempDir, { upgradeSeconds: 1 });
		await upgrader.answer(checkAnswer({ modes: ['in-place', 'recreate'] }));
		const server = await startStandaloneServer(tempDir, upgrader.path);
		try {
			await pairAndLand(appHarness, mainWindow, server);
			await expect(upgradeIndicator(mainWindow)).toHaveCount(1, {
				timeout: 30_000,
			});
			await resize(mainWindow, electronApp, PHONE);
			await expect(
				mainWindow.locator('[data-compact-chrome="true"]'),
			).toBeVisible();

			// With no server glyph on the row, the title block carries it.
			const breadcrumb = mainWindow.locator('[data-compact-breadcrumb="true"]');
			await expect(breadcrumb).toHaveAccessibleName(
				/ — Server upgrade 5\.2\.0 available$/,
			);
			await expect(
				breadcrumb.locator('[data-compact-breadcrumb-alert="true"]'),
			).toBeVisible();

			await breadcrumb.click();
			// The drawer lists server updates in its Servers panel, on the rail.
			const drawer = mainWindow.getByRole('dialog', {
				name: 'Switch terminal',
			});
			const servers = drawer.locator('[data-compact-switcher-server="true"]');
			await servers.click();
			await expect(servers).toHaveAttribute('aria-pressed', 'true');
			const panel = drawer.locator('[data-compact-servers-panel="true"]');
			await expect(panel).toBeVisible();
			const row = panel.locator('[data-server-upgrade-profile-id]');
			await expect(row).toContainText('Update available · 5.2.0');
			// Only the attached connection has reachability and an upgrade. Local
			// is saved but not attached: a switch to it, and nothing else.
			const local = panel.getByRole('radio', { name: 'Local', exact: true });
			await expect(local).toHaveAttribute('aria-checked', 'false');
			await expect(local.locator('.compact-drawer__server-dot')).toHaveCount(0);
			await expect(row).toHaveCount(1);
			await expect(row).not.toHaveAttribute(
				'data-server-upgrade-profile-id',
				(await local.getAttribute('data-compact-server-row')) ?? '',
			);
			const current = panel.locator(
				'[data-compact-server-row][aria-checked="true"]',
			);
			await expect(current).toHaveCount(1);
			await expect(current.locator('.compact-drawer__server-dot')).toHaveCount(
				1,
			);
			await expect(
				panel.getByRole('button', { name: /Rename|Forget|Edit|Remove/ }),
			).toHaveCount(0);
			// The panel offers no search and no edit control.
			await expect(
				drawer.getByRole('button', { name: 'Search terminals and projects' }),
			).toHaveCount(0);
			await expect(
				drawer.locator('[data-compact-switcher-edit="true"]'),
			).toHaveCount(0);
			await row.getByRole('button', { name: 'Upgrade server…' }).click();

			// Both modes, in place preselected, and what recreate costs.
			const confirmation = confirmationOf(mainWindow);
			await expect(confirmation).toBeVisible();
			await expect(
				confirmation.getByRole('radio', { name: /Upgrade in place/ }),
			).toBeChecked();
			const recreate = confirmation.getByRole('radio', {
				name: /Recreate the container/,
			});
			await expect(recreate).not.toBeChecked();
			await expect(confirmation).toContainText(
				'Ends every terminal on this server.',
			);
			await expect(confirmation).toContainText('Its terminals keep running.');
			await recreate.check();
			await expect(confirmation).toContainText(
				'Every terminal on this server ends.',
			);
			await expect(confirmation).not.toContainText('keep running');

			// Every control of the confirmation is inside the phone's viewport.
			for (const name of ['Cancel', 'Upgrade']) {
				const box = await confirmation
					.getByRole('button', { name, exact: true })
					.boundingBox();
				expect(box, `${name} is drawn`).not.toBeNull();
				expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
					PHONE.width,
				);
				expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(
					PHONE.height,
				);
			}
			await confirmation.getByRole('button', { name: 'Cancel' }).click();
			await expect(confirmation).toHaveCount(0);
			expect(await upgrader.upgrades()).toEqual([]);
		} finally {
			await server.stop();
		}
	});
});
