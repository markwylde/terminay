import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
	_electron as electron,
	expect,
	test,
	type ElectronApplication,
} from '@playwright/test';

const execFileAsync = promisify(execFile);

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

async function buildExtractedPackagedExecutable(outputDirectory: string): Promise<string> {
	const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
	await execFileAsync(
		path.resolve('node_modules/.bin/electron-builder'),
		[
			'--dir',
			'--linux',
			`--${architecture}`,
			'--publish',
			'never',
			`--config.directories.output=${outputDirectory}`,
		],
		{
			env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
			maxBuffer: 16 * 1024 * 1024,
			timeout: 180_000,
		},
	);
	const directories = await readdir(outputDirectory, { withFileTypes: true });
	const extracted = directories.find(
		(entry) => entry.isDirectory() && entry.name.startsWith('linux-') && entry.name.endsWith('-unpacked'),
	);
	if (extracted === undefined)
		throw new Error(
			`electron-builder did not produce an extracted Linux application in ${outputDirectory}`,
		);
	return path.join(outputDirectory, extracted.name, 'terminay');
}

async function launchDevelopmentComposition(userDataDir: string): Promise<ElectronApplication> {
	// This is the repository Electron process produced by the canonical
	// development build/orchestration, with app.isPackaged=false.
	return electron.launch({
		args: ['.'],
		env: {
			...process.env,
			CI: '1',
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: userDataDir,
		},
	});
}

async function launchExtractedPackagedComposition(
	executablePath: string,
	userDataDir: string,
): Promise<ElectronApplication> {
	// Launch the executable copied into electron-builder's extracted application
	// directory. No repository Electron entry or development renderer selector is
	// involved in this process.
	return electron.launch({
		executablePath,
		env: {
			...process.env,
			CI: '1',
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: userDataDir,
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

test('development orchestration and extracted packaged app expose identical canonical runtime state', async () => {
	test.setTimeout(240_000);
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-runtime-parity-'));
	let development: ElectronApplication | undefined;
	let packaged: ElectronApplication | undefined;
	try {
		const packagedExecutable = await buildExtractedPackagedExecutable(
			path.join(root, 'electron-builder-output'),
		);

		development = await launchDevelopmentComposition(path.join(root, 'development'));
		expect(await development.evaluate(({ app }) => app.isPackaged)).toBe(false);
		const developmentEvidence = await observeRuntime(development);
		await closeCleanly(development);
		development = undefined;

		packaged = await launchExtractedPackagedComposition(
			packagedExecutable,
			path.join(root, 'packaged'),
		);
		expect(await packaged.evaluate(({ app }) => app.isPackaged)).toBe(true);
		const packagedEvidence = await observeRuntime(packaged);
		expect(packagedEvidence).toEqual(developmentEvidence);
		await closeCleanly(packaged);
		packaged = undefined;
	} finally {
		if (development !== undefined && development.process().exitCode === null)
			await development.close().catch(() => development?.process().kill('SIGKILL'));
		if (packaged !== undefined && packaged.process().exitCode === null)
			await packaged.close().catch(() => packaged?.process().kill('SIGKILL'));
		await rm(root, { recursive: true, force: true });
	}
});
