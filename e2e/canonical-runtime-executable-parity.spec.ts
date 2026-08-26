import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
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

function captureProcessDiagnostics(app: ElectronApplication): () => string {
	let output = '';
	for (const stream of [app.process().stdout, app.process().stderr]) {
		stream?.setEncoding('utf8');
		stream?.on('data', (chunk) => {
			output += String(chunk);
		});
	}
	return () => output;
}

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
			ELECTRON_ENABLE_LOGGING: '1',
			TEMP: path.dirname(userDataDir),
			TERMINAY_E2E_TEMP_DIR: path.dirname(userDataDir),
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: userDataDir,
			TMP: path.dirname(userDataDir),
			TMPDIR: path.dirname(userDataDir),
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
			ELECTRON_ENABLE_LOGGING: '1',
			TEMP: path.dirname(userDataDir),
			TERMINAY_E2E_TEMP_DIR: path.dirname(userDataDir),
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: userDataDir,
			TMP: path.dirname(userDataDir),
			TMPDIR: path.dirname(userDataDir),
		},
	});
}

async function observeRuntime(app: ElectronApplication): Promise<RuntimeEvidence> {
	const page = await app.firstWindow();
	await page.waitForLoadState('domcontentloaded');
	// A fresh packaged composition creates its Local server, workspace, and
	// built-in extension floor after Chromium has reached DOMContentLoaded.
	// CI's extracted app can legitimately need longer than Playwright's 5s
	// assertion default before the canonical root is rendered.
	await expect(page.locator('[data-terminay-app-component]')).toBeVisible({
		timeout: 30_000,
	});
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
	// Playwright disposes ElectronApplication.process() as part of close(). Keep
	// the process handle before closing so the exit assertion observes the real
	// process rather than a disposed Playwright wrapper.
	const process = app.process();
	await app.close();
	expect(process.exitCode).not.toBeNull();
	expect(process.signalCode).toBeNull();
}

async function terminateFailedComposition(app: ElectronApplication): Promise<void> {
	const process = app.process();
	if (process.exitCode !== null || process.signalCode !== null) return;
	const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
	process.kill('SIGKILL');
	await Promise.race([
		exited,
		new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
	]);
}

test('development orchestration and extracted packaged app expose identical canonical runtime state', async () => {
	test.setTimeout(240_000);
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-runtime-parity-'));
	let development: ElectronApplication | undefined;
	let packaged: ElectronApplication | undefined;
	let developmentDiagnostics = () => '';
	let packagedDiagnostics = () => '';
	try {
		const packagedExecutable = await test.step(
			'build fresh extracted packaged application',
			() =>
				buildExtractedPackagedExecutable(
					path.join(root, 'electron-builder-output'),
				),
		);
		const developmentUserData = path.join(root, 'development');
		const packagedUserData = path.join(root, 'packaged');
		await Promise.all([
			mkdir(developmentUserData, { recursive: true }),
			mkdir(packagedUserData, { recursive: true }),
		]);

		development = await test.step('launch and observe development composition', async () => {
			const app = await launchDevelopmentComposition(developmentUserData);
			developmentDiagnostics = captureProcessDiagnostics(app);
			expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(false);
			return app;
		});
		const developmentEvidence = await test.step('observe development contract', async () => {
			try {
				return await observeRuntime(development!);
			} catch (error) {
				throw new Error(
					`development contract observation failed: ${error instanceof Error ? error.message : String(error)}\n` +
						`Development process diagnostics:\n${developmentDiagnostics() || '(none)'}`,
					{ cause: error },
				);
			}
		});
		await test.step('close development composition cleanly', () => closeCleanly(development!));
		development = undefined;

		packaged = await test.step('launch extracted packaged composition', async () => {
			const app = await launchExtractedPackagedComposition(
				packagedExecutable,
				packagedUserData,
			);
			packagedDiagnostics = captureProcessDiagnostics(app);
			expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);
			return app;
		});
		const packagedEvidence = await test.step('observe packaged contract', async () => {
			try {
				return await observeRuntime(packaged!);
			} catch (error) {
				throw new Error(
					`packaged contract observation failed: ${error instanceof Error ? error.message : String(error)}\n` +
						`Packaged process diagnostics:\n${packagedDiagnostics() || '(none)'}`,
					{ cause: error },
				);
			}
		});
		// These two identities are minted per fresh local runtime. The parity
		// contract is their shape and every stable UI/runtime fact, not equality
		// across independently initialized data roots.
		expect(developmentEvidence.profileId).toMatch(/^local:/u);
		expect(packagedEvidence.profileId).toMatch(/^local:/u);
		expect(developmentEvidence.serverId).toMatch(/^desktop-/u);
		expect(packagedEvidence.serverId).toMatch(/^desktop-/u);
		const { profileId: _developmentProfileId, serverId: _developmentServerId, ...stableDevelopmentEvidence } = developmentEvidence;
		const { profileId: _packagedProfileId, serverId: _packagedServerId, ...stablePackagedEvidence } = packagedEvidence;
		expect(stablePackagedEvidence).toEqual(stableDevelopmentEvidence);
		await test.step('close packaged composition cleanly', () => closeCleanly(packaged!));
		packaged = undefined;
	} finally {
		if (development !== undefined && development.process().exitCode === null)
			await terminateFailedComposition(development);
		if (packaged !== undefined && packaged.process().exitCode === null)
			await terminateFailedComposition(packaged);
		// Chromium child processes may release profile partitions shortly after
		// the Electron main process exits. Retry removal so a failed first
		// attempt cannot poison Playwright's retry with ENOTEMPTY.
		await rm(root, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
	}
});
