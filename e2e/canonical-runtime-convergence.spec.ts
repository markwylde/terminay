import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type CanonicalIdentity = Readonly<{
	bundleId: string;
	profileId: string;
	projectIds: readonly string[];
	revision: number;
	serverId: string;
	activeSessionId: string;
	terminalTabCount: number;
	windowId: string;
}>;

async function canonicalIdentity(page: Page): Promise<CanonicalIdentity> {
	await expect(page.locator('[data-terminay-app-component]')).toBeVisible();
	await expect(page.locator('.project-tab')).not.toHaveCount(0);
	await expect(page.locator('.terminal-panel')).not.toHaveCount(0);
	const context = await page.evaluate(() => window.terminayHost?.getContext());
	expect(context?.hostKind).toBe('desktop');
	expect(context?.bundleId).toMatch(/^[A-Za-z0-9._:-]{8,256}$/u);
	const shell = page.locator('.app-shell');
	const revision = Number(
		await shell.getAttribute('data-terminay-workspace-revision'),
	);
	expect(Number.isSafeInteger(revision) && revision > 0).toBe(true);
	return {
		bundleId: context?.bundleId ?? '',
		profileId: context?.profileId ?? '',
		projectIds: await page.locator('.project-tab').evaluateAll((tabs) =>
			tabs.map((tab) => tab.getAttribute('data-project-id') ?? ''),
		),
		revision,
		serverId: context?.serverId ?? '',
	activeSessionId:
			(await page
				.locator('.project-workspace--active .terminal-panel:visible')
				.getAttribute('data-terminay-terminal-session-id')) ?? '',
		// Dockview mounts only the active terminal body. Tab content is the
		// visible, production-owned presentation for inactive terminal sessions.
		terminalTabCount: await page
			.locator('.project-workspace--active .terminal-tab-content')
			.count(),
		windowId: context?.windowId ?? '',
	};
}

function stableIdentity(value: CanonicalIdentity) {
	const { revision: _revision, ...identity } = value;
	return identity;
}

test('clean canonical development launch is ready without renderer self-healing', async ({
	electronApp,
	mainWindow,
}) => {
	const identity = await canonicalIdentity(mainWindow);
	expect(identity.projectIds).toHaveLength(1);
	expect(identity.activeSessionId).toBeTruthy();
	expect(identity.terminalTabCount).toBe(1);
	expect(identity.projectIds.every(Boolean)).toBe(true);

	const menu = await electronApp.evaluate(({ Menu }) =>
		(Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
	);
	expect(menu).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']));
	expect(mainWindow.locator('[data-terminay-browser-menu]')).toHaveCount(0);

	await mainWindow.getByLabel('Toggle file explorer').click();
	await expect(mainWindow.locator('.file-explorer-sidebar')).toBeVisible();
	await expect(mainWindow.getByText(/^query failed$/iu)).toHaveCount(0);
	await electronApp.evaluate(({ Menu }) => {
		const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
			for (const item of items) {
				if (item.label === 'Toggle File Explorer Sidebar') return item;
				const nested = item.submenu == null ? undefined : find(item.submenu.items);
				if (nested !== undefined) return nested;
			}
			return undefined;
		};
		const command = find(Menu.getApplicationMenu()?.items ?? []);
		if (command === undefined) throw new Error('native sidebar command is absent');
		command.click();
	});
	await expect(mainWindow.locator('.file-explorer-sidebar')).toBeHidden();
	await mainWindow.getByLabel('Toggle file explorer').click();
	await expect(mainWindow.locator('.file-explorer-sidebar')).toBeVisible();
	const sidebarProject = await mainWindow
		.locator('.app-shell')
		.getAttribute('data-terminay-active-project-id');

	await mainWindow.getByLabel('New terminal tab').click();
	await expect.poll(async () => (await canonicalIdentity(mainWindow)).terminalTabCount).toBe(2);
	const expanded = await canonicalIdentity(mainWindow);
	expect(expanded.projectIds).toEqual(identity.projectIds);
	expect(expanded.terminalTabCount).toBe(2);
	expect(expanded.activeSessionId).not.toBe(identity.activeSessionId);
	expect(mainWindow.locator('.file-explorer-sidebar')).toBeVisible();
	expect(
		await mainWindow
			.locator('.app-shell')
			.getAttribute('data-terminay-active-project-id'),
	).toBe(sidebarProject);
	await expect(mainWindow.getByText(/^query failed$/iu)).toHaveCount(0);

	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	const reloaded = await canonicalIdentity(mainWindow);
	expect(reloaded).toEqual(expanded);
});

test('canonical Desktop quits cleanly with a hydrated workspace', async ({
	electronApp,
	mainWindow,
}) => {
	await canonicalIdentity(mainWindow);
	const process = electronApp.process();
	const exited = new Promise<{ code: number | null; signal: string | null }>(
		(resolve) => process.once('exit', (code, signal) => resolve({ code, signal })),
	);
	// A hydrated Local workspace contains a live shell. Confirm the real native
	// quit warning rather than letting Electron wait indefinitely for input.
	await electronApp.evaluate(({ dialog }) => {
		dialog.showMessageBox = async () => ({
			checkboxChecked: false,
			response: 0,
		});
	});
	await electronApp.close();
	expect(await exited).toEqual({ code: 0, signal: null });
});

test('populated canonical workspace reloads without duplicate projects or sessions', async ({
	mainWindow,
}) => {
	await canonicalIdentity(mainWindow);
	await mainWindow.getByLabel('Create project on This server').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	const populated = await canonicalIdentity(mainWindow);
	expect(new Set(populated.projectIds).size).toBe(2);
	expect(populated.terminalTabCount).toBe(1);
	expect(populated.activeSessionId).toBeTruthy();

	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	const restored = await canonicalIdentity(mainWindow);
	expect(stableIdentity(restored)).toEqual(stableIdentity(populated));
	expect(restored.revision).toBe(populated.revision);
});
