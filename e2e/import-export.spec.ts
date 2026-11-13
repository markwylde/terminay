import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

const SCREENSHOTS = path.resolve('test-results/import-export-screenshots');

type StandaloneServer = Readonly<{ pairingUrl: string; stop: () => Promise<void> }>;

/** The compiled standalone server on a loopback port, with its pairing URL. */
async function startStandaloneServer(root: string): Promise<StandaloneServer> {
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
			'0',
		],
		{ stdio: ['ignore', 'pipe', 'pipe'] },
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
						if (parsed.ready === true && typeof parsed.pairing?.pairingUrl === 'string') {
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

async function openConnectionMenu(window: Page) {
	await window.locator('.project-tabbar').waitFor({ state: 'visible' });
	const menu = window.locator('[role="menu"][aria-label="Connection menu"]:visible').first();
	if (!(await menu.isVisible().catch(() => false)))
		await window.getByRole('button', { name: /Open connection menu/ }).click();
	await expect(menu).toBeVisible();
	return menu;
}

async function expectShowing(window: Page, label: string) {
	await expect(async () => {
		const menu = await openConnectionMenu(window);
		await expect(menu.getByRole('menuitemradio', { name: label, exact: true })).toHaveAttribute(
			'aria-checked',
			'true',
			{ timeout: 2_000 },
		);
	}).toPass({ timeout: 45_000 });
}

const column = (page: Page, label: string) => page.getByTestId(`import-export-column-${label}`);
const row = (page: Page, kind: string, name: string) =>
	page.getByTestId(`import-export-row-${kind}-${name}`);
const cell = (rowLocator: Locator, label: string) =>
	rowLocator.locator(`[data-column="${label}"]`);

async function createMacro(page: Page, title: string, text: string) {
	await page.getByRole('button', { name: 'New macro', exact: true }).click();
	await page.getByLabel('Macro name').fill(title);
	await page.getByLabel('Text to type').first().fill(text);
}

async function saveMacros(page: Page) {
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.locator('.macro-save-state')).toHaveText('Saved');
}

async function openCategory(page: Page, label: string) {
	await page.locator('.settings-nav-item', { hasText: label }).first().click();
}

test('Import & Export copies items between attached servers and through a bundle file', async ({
	appHarness,
	electronApp,
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(360_000);
	await mkdir(SCREENSHOTS, { recursive: true });
	await mainWindow.locator('.project-tabbar').waitFor({ state: 'visible' });
	const server = await startStandaloneServer(tempDir);
	try {
		// Pair build-box (pairing shows it in this window), then come back to Local.
		const serverHost = new URL(server.pairingUrl).host;
		const manager = await appHarness.openChildWindow(async () => {
			await mainWindow.getByRole('button', { name: /Open connection menu/ }).click();
			await mainWindow.getByRole('button', { name: 'Manage connections' }).click();
		});
		await manager.getByRole('button', { name: 'Add server…' }).click();
		await manager.getByLabel('Pairing URL').fill(server.pairingUrl);
		await manager.getByRole('button', { name: 'Continue pairing', exact: true }).click();
		await expectShowing(mainWindow, serverHost);
		await manager.close();
		const menu = await openConnectionMenu(mainWindow);
		await menu.getByRole('menuitemradio', { name: 'Local', exact: true }).click();
		await expectShowing(mainWindow, 'Local');
		await mainWindow.keyboard.press('Escape');

		// Two macros on Local.
		const settings = await appHarness.openMacrosSettings(mainWindow);
		await createMacro(settings, 'IE Copy Me', 'echo copied');
		await createMacro(settings, 'IE Clash', 'echo first');
		await saveMacros(settings);
		await settings.close();

		// The menu command opens Settings at Import & Export.
		const ie = await appHarness.openChildWindow(() =>
			sendAppCommand(mainWindow, 'open-import-export'),
		);
		await expect(ie.locator('.settings-nav-item--active')).toContainText('Import & Export');
		await expect(ie.locator('.import-export')).toBeVisible({ timeout: 30_000 });

		// Local is the source by default; build-box is remembered and can be attached.
		const local = column(ie, 'Local');
		await expect(local.getByRole('radio', { name: 'Source' })).toBeChecked({ timeout: 30_000 });
		const remote = column(ie, serverHost);
		await expect(remote).toContainText('Not attached');
		await remote.getByRole('button', { name: 'Attach' }).click();
		const remoteTarget = remote.getByRole('checkbox', { name: 'Target' });
		await expect(remoteTarget).toBeEnabled({ timeout: 45_000 });

		const copyMe = row(ie, 'macro', 'IE Copy Me');
		const clash = row(ie, 'macro', 'IE Clash');
		await expect(cell(copyMe, 'Local')).toContainText('present');
		await expect(cell(copyMe, serverHost)).toContainText('missing');

		// Filters: text and kind chip.
		await ie.getByLabel('Filter items by name').fill('IE C');
		await ie.locator('.import-export__chips').getByRole('button', { name: /^Macros/ }).click();
		await expect(ie.locator('.import-export__chips').getByRole('button', { name: /^Macros/ })).toHaveAttribute('aria-pressed', 'true');
		await expect(ie.locator('[data-testid^="import-export-row-"]')).toHaveCount(2);
		await ie.screenshot({ path: path.join(SCREENSHOTS, '01-matrix.png') });

		// Choose rows from the keyboard and a target.
		await copyMe.getByRole('checkbox').focus();
		await ie.keyboard.press('Space');
		await clash.getByRole('checkbox').focus();
		await ie.keyboard.press('Space');
		await remoteTarget.check();
		await expect(ie.getByTestId('import-export-summary')).toContainText(`2 items from Local → ${serverHost}`);
		await ie.getByRole('button', { name: /^Review/ }).click();
		await expect(ie.getByTestId('import-export-node-macro-IE Copy Me')).toContainText('Will be added');
		await ie.getByRole('button', { name: 'Apply', exact: true }).click();
		await expect(ie.getByTestId('import-export-result-macro-IE Copy Me')).toContainText('Added');
		await expect(ie.getByTestId('import-export-result-macro-IE Clash')).toContainText('Added');
		await ie.screenshot({ path: path.join(SCREENSHOTS, '03-results.png') });
		await ie.getByRole('button', { name: 'Done', exact: true }).click();

		// The matrix refreshes from the servers without a reload.
		await expect(cell(copyMe, serverHost)).toContainText('same', { timeout: 30_000 });
		await expect(cell(clash, serverHost)).toContainText('same');

		// Change "IE Clash" on Local; review must ask before replacing it.
		await openCategory(ie, 'Macros');
		await ie.locator('.macro-nav-item', { hasText: 'IE Clash' }).getByRole('button').click();
		await ie.getByLabel('Text to type').first().fill('echo second');
		await saveMacros(ie);
		await openCategory(ie, 'Import & Export');
		await expect(cell(clash, serverHost)).toContainText('differs', { timeout: 30_000 });
		await clash.getByRole('checkbox').check();
		await column(ie, serverHost).getByRole('checkbox', { name: 'Target' }).check();
		await ie.getByRole('button', { name: /^Review/ }).click();
		const clashNode = ie.getByTestId('import-export-node-macro-IE Clash');
		await expect(clashNode).toContainText('Differs on this server');
		await expect(clashNode.getByRole('radio')).toHaveCount(3);
		for (const choice of await clashNode.getByRole('radio').all())
			await expect(choice).not.toBeChecked();
		const apply = ie.getByRole('button', { name: 'Apply', exact: true });
		await expect(apply).toBeDisabled();
		await ie.screenshot({ path: path.join(SCREENSHOTS, '02-review.png') });
		await clashNode.getByRole('radio', { name: 'Replace' }).check();
		await expect(apply).toBeEnabled();
		await apply.click();
		await expect(ie.getByTestId('import-export-result-macro-IE Clash')).toContainText('Replaced');
		await ie.getByRole('button', { name: 'Done', exact: true }).click();
		await expect(cell(clash, serverHost)).toContainText('same', { timeout: 30_000 });

		// Export a bundle through the save dialog.
		const bundlePath = path.join(tempDir, 'ie-bundle.json');
		await electronApp.evaluate(({ dialog }, filePath) => {
			dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as typeof dialog.showSaveDialog;
		}, bundlePath);
		await copyMe.getByRole('checkbox').check();
		await ie.getByRole('button', { name: 'Export selected…' }).click();
		await expect(ie.getByRole('alertdialog', { name: 'Export' })).toContainText('plain text');
		await ie.getByRole('button', { name: 'Save…' }).click();
		await expect(ie.getByRole('status').filter({ hasText: 'Exported.' })).toBeVisible();
		const exported = JSON.parse(await readFile(bundlePath, 'utf8')) as {
			format: string;
			version: number;
			items: { kind: string; name: string }[];
		};
		expect(exported.format).toBe('terminay.import-export');
		expect(exported.version).toBe(1);
		expect(exported.items.map((item) => item.name)).toEqual(['IE Copy Me']);
		expect(JSON.stringify(exported)).not.toMatch(/"(id|revision|serverId)"/);

		// Import it: a read-only column named after the file, same as Local.
		const fileInput = ie.getByTestId('import-export-file-input');
		await fileInput.setInputFiles(bundlePath);
		const bundleColumn = column(ie, 'ie-bundle.json');
		await expect(bundleColumn).toBeVisible();
		await expect(bundleColumn.getByRole('checkbox', { name: 'Target' })).toHaveCount(0);
		await expect(cell(copyMe, 'ie-bundle.json')).toContainText('same');

		// A bundle carrying an id is refused and adds nothing.
		const badPath = path.join(tempDir, 'ie-bad.json');
		const bad = JSON.parse(await readFile(bundlePath, 'utf8')) as {
			items: Record<string, unknown>[];
		};
		bad.items[0] = { ...bad.items[0], id: 'macro-1' };
		await writeFile(badPath, JSON.stringify(bad));
		await fileInput.setInputFiles(badPath);
		await expect(ie.getByRole('alert')).toContainText('ie-bad.json was not imported');
		await expect(column(ie, 'ie-bad.json')).toHaveCount(0);
	} finally {
		await server.stop();
	}
});
