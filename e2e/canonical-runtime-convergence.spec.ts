import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type CanonicalIdentity = Readonly<{
	bundleId: string;
	profileId: string;
	projectIds: readonly string[];
	revision: number;
	serverId: string;
	sessionIds: readonly string[];
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
		sessionIds: await page
			.locator('.terminal-panel')
			.evaluateAll((panels) =>
				panels.map(
					(panel) =>
						panel.getAttribute('data-terminay-terminal-session-id') ?? '',
				),
			),
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
	expect(identity.sessionIds).toHaveLength(1);
	expect(identity.projectIds.every(Boolean)).toBe(true);
	expect(identity.sessionIds.every(Boolean)).toBe(true);

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
	await expect
		.poll(async () => new Set((await canonicalIdentity(mainWindow)).sessionIds).size)
		.toBe(2);
	const expanded = await canonicalIdentity(mainWindow);
	expect(expanded.projectIds).toEqual(identity.projectIds);
	expect(new Set(expanded.sessionIds).size).toBe(2);
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
	await electronApp.close();
	expect(electronApp.process().exitCode).not.toBeNull();
	expect(electronApp.process().signalCode).toBeNull();
});

test('populated canonical workspace reloads without duplicate projects or sessions', async ({
	mainWindow,
}) => {
	await canonicalIdentity(mainWindow);
	await mainWindow.getByLabel('Create project on This server').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	const populated = await canonicalIdentity(mainWindow);
	expect(new Set(populated.projectIds).size).toBe(2);
	expect(new Set(populated.sessionIds).size).toBe(2);

	await mainWindow.reload({ waitUntil: 'domcontentloaded' });
	const restored = await canonicalIdentity(mainWindow);
	expect(stableIdentity(restored)).toEqual(stableIdentity(populated));
	expect(restored.revision).toBe(populated.revision);
});
