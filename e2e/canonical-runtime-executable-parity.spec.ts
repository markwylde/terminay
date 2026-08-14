import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
	type Page,
} from '@playwright/test';

type RuntimeEvidence = Readonly<{
	bundleId: string;
	capabilities: unknown;
	menu: readonly string[];
	panels: readonly string[];
	profileId: string;
	projects: readonly string[];
	revision: number;
	serverId: string;
	sessions: readonly string[];
	sidebarProjectId: string;
}>;

async function launchComposition(
	mode: 'development' | 'production-built',
	userDataDir: string,
): Promise<ElectronApplication> {
	return electron.launch({
		args: ['.'],
		env: {
			...process.env,
			CI: '1',
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: userDataDir,
			...(mode === 'development'
				? { VITE_DEV_SERVER_URL: 'http://127.0.0.1:9/' }
				: { VITE_DEV_SERVER_URL: '' }),
		},
	});
}

async function observeRuntime(app: ElectronApplication): Promise<RuntimeEvidence> {
	const page = await app.firstWindow();
	await page.waitForLoadState('domcontentloaded');
	await expect(page.locator('[data-terminay-app-component]')).toBeVisible();
	await expect(page.locator('.project-tab')).toHaveCount(1);
	await expect(page.locator('.terminal-panel')).toHaveCount(1);
	const context = await page.evaluate(() => window.terminayHost?.getContext());
	if (context === undefined) throw new Error('canonical host context is unavailable');
	const menu = await app.evaluate(({ Menu }) =>
		(Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
	);
	await page.getByLabel('Toggle file explorer').click();
	await expect(page.locator('.file-explorer-sidebar')).toBeVisible();
	await expect(page.getByText(/^query failed$/iu)).toHaveCount(0);
	const shell = page.locator('.app-shell');
	const sidebarProjectId =
		(await shell.getAttribute('data-terminay-active-project-id')) ?? '';
	return {
		bundleId: context.bundleId,
		capabilities: context.capabilities,
		menu,
		panels: await page
			.locator('.terminal-tab-content')
			.evaluateAll((items) => items.map((item) => item.getAttribute('data-panel-id') ?? '')),
		profileId: context.profileId,
		projects: await page
			.locator('.project-tab')
			.evaluateAll((items) => items.map((item) => item.getAttribute('data-project-id') ?? '')),
		revision: Number(await shell.getAttribute('data-terminay-workspace-revision')),
		serverId: context.serverId,
		sessions: await page.locator('.terminal-panel').evaluateAll((items) =>
			items.map(
				(item) => item.getAttribute('data-terminay-terminal-session-id') ?? '',
			),
		),
		sidebarProjectId,
	};
}

async function closeCleanly(app: ElectronApplication): Promise<void> {
	await app.close();
	expect(app.process().exitCode).not.toBeNull();
	expect(app.process().signalCode).toBeNull();
}

test('development and production-built processes expose identical canonical runtime state', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-runtime-parity-'));
	let development: ElectronApplication | undefined;
	let production: ElectronApplication | undefined;
	try {
		development = await launchComposition('development', path.join(root, 'development'));
		const developmentEvidence = await observeRuntime(development);
		await closeCleanly(development);
		development = undefined;

		production = await launchComposition('production-built', path.join(root, 'production'));
		const productionEvidence = await observeRuntime(production);
		expect(productionEvidence).toEqual(developmentEvidence);
		await closeCleanly(production);
		production = undefined;
	} finally {
		if (development !== undefined && development.process().exitCode === null)
			await development.close().catch(() => development?.process().kill('SIGKILL'));
		if (production !== undefined && production.process().exitCode === null)
			await production.close().catch(() => production?.process().kill('SIGKILL'));
		await rm(root, { recursive: true, force: true });
	}
});
