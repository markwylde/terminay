import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { copyFile, cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { _electron as electron } from '@playwright/test';

const HEADLESS_CHROMIUM_ARGS = [
	'--headless',
	'--disable-gpu',
	'--use-mock-keychain',
];

const appPath = resolve(
	process.env.TERMINAY_PACKAGED_APP ?? 'release/0.0.0/mac-arm64/Terminay.app',
);
const developmentLaunch = process.env.TERMINAY_DEV_ELECTRON === '1';
const retainedDiagnosticsRoot = process.env.TERMINAY_RELEASE_DIAGNOSTICS_DIR;
const execFileAsync = promisify(execFile);

test(
	'packaged macOS artifact initializes, restores, reloads, queries, and shuts down canonically',
	{
		skip: process.platform !== 'darwin',
	},
	async () => {
		const userData = await mkdtemp(join(tmpdir(), 'terminay-release-smoke-'));
		const evidence = [];
		try {
			if (process.env.TERMINAY_SEED_WORKSPACE_FILE) {
				await copyFile(
					resolve(process.env.TERMINAY_SEED_WORKSPACE_FILE),
					join(userData, 'workspace.v4.json'),
				);
			}
			if (!developmentLaunch) await requireCanonicalArtifactInventory();
			const fresh = await exerciseLaunch({ mode: 'fresh', userData });
			evidence.push(fresh);
			const restored = await exerciseLaunch({
				expected: fresh.identity,
				mode: 'restored',
				userData,
			});
			evidence.push(restored);

			assert.deepEqual(
				restartedWorkspaceIdentity(restored.identity),
				restartedWorkspaceIdentity(fresh.identity),
				'restarting the packaged artifact must restore the canonical workspace without duplicate seed state',
			);
			assert.ok(
				restored.identity.revision >= fresh.identity.revision,
				'restart may advance recovery state but must never regress its canonical revision',
			);
		} catch (error) {
			await retainDiagnostics(userData, evidence, error);
			throw error;
		} finally {
			await rm(userData, {
				recursive: true,
				force: true,
				maxRetries: 10,
				retryDelay: 100,
			});
		}
	},
);

async function requireCanonicalArtifactInventory() {
	const resources = join(appPath, 'Contents', 'Resources');
	const archive = join(resources, 'app.asar');
	const asarCli = resolve('node_modules/.bin/asar');
	const { stdout } = await execFileAsync(asarCli, ['list', archive], {
		maxBuffer: 8 * 1024 * 1024,
	});
	const entries = new Set(
		stdout
			.split(/\r?\n/u)
			.map((entry) => entry.replaceAll('\\', '/').replace(/^\/+|\/$/gu, ''))
			.filter(Boolean),
	);
	for (const required of [
		'dist-web/server.html',
		'dist-web/manifest.json',
	]) {
		assert.ok(entries.has(required), `packaged app.asar is missing ${required}`);
	}
	await readFile(
		join(resources, 'app.asar.unpacked', 'dist-electron', 'serverUiPreload.cjs'),
		'utf8',
	);
	for (const forbidden of [
		'dist/index.html',
		'dist/server.html',
		'dist-electron/preload.mjs',
		'dist-electron/serverUiPreload.js',
		'dist-electron/rendererRuntime.js',
	]) {
		assert.equal(
			entries.has(forbidden),
			false,
			`legacy workspace artifact must not ship: ${forbidden}`,
		);
	}
	for (const entry of entries) {
		assert.doesNotMatch(
			entry,
			/(?:^|\/)(?:rendererRuntime|legacyRenderer|renderer-bootstrap)(?:[-.].*)?\.(?:js|mjs)$/u,
			`legacy renderer entry chunk must not ship: ${entry}`,
		);
	}
}

async function exerciseLaunch({ expected, mode, userData }) {
	const executablePath = join(
		developmentLaunch ? resolve('node_modules/electron/dist/Electron.app') : appPath,
		'Contents',
		'MacOS',
		developmentLaunch ? 'Electron' : basename(appPath, '.app'),
	);
	const failures = [];
	const mainStderr = { text: '' };
	let electronApp;
	try {
		electronApp = await electron.launch({
			// Every wait here is for a state the application reaches, not for a
			// budget: none of Playwright's waits gives up on a slow machine.
			timeout: 0,
			executablePath,
			args: developmentLaunch ? [resolve('.'), ...packagedChromiumLaunchArgs()] : packagedChromiumLaunchArgs(),
			env: {
				...process.env,
				CI: '1',
				TERMINAY_TEST: '1',
				TERMINAY_USER_DATA_DIR: userData,
				// A release smoke may select diagnostics, never a development renderer.
				VITE_DEV_SERVER_URL: '',
			},
		});
		const mainStderr = { text: '' };
		captureMainProcessFailures(electronApp.process(), failures, mainStderr);
		electronApp.context().setDefaultTimeout(0);
		const window = await electronApp.firstWindow({ timeout: 0 });
		captureRendererFailures(window, failures);

		const identity = await requireCanonicalReadiness(window);
		if (expected !== undefined)
			assert.deepEqual(
				restartedWorkspaceIdentity(identity),
				restartedWorkspaceIdentity(expected),
			);
		await requireNativeMenu(electronApp, window);
		await requireSidebarQuery(window);
		await requireBuiltInExtensionsInstalled(electronApp, window, failures);
		await requireTerminalInputOutput(window, mode);

		await window.reload({ waitUntil: 'domcontentloaded' });
		const reloaded = await requireCanonicalReadiness(window);
		const { revision: reloadedRevision, ...reloadedIdentity } = reloaded;
		const { revision: initialRevision, ...initialIdentity } = identity;
		assert.deepEqual(
			reloadedIdentity,
			initialIdentity,
			'reload must preserve the selected server, project, panel, terminal, and bundle',
		);
		assert.ok(
			reloadedRevision >= initialRevision,
			'reload may commit a one-time workspace migration but must not regress its revision',
		);
		await requireSidebarQuery(window);

		await closeElectronApp(electronApp);
		electronApp = undefined;
		assert.deepEqual(failures, []);
		return { identity, mode };
	} catch (error) {
		const diagnostics = await readDiagnostics(userData);
		throw new Error(
			`${mode} packaged-artifact journey failed: ${error instanceof Error ? error.message : String(error)}\n` +
				`Process/renderer failures:\n${failures.join('\n') || '(none)'}\n` +
				`Main stderr:\n${mainStderr.text || '(none)'}\n` +
				`Diagnostics:\n${diagnostics || '(none)'}`,
			{ cause: error },
		);
	} finally {
		if (electronApp !== undefined) await emergencyClose(electronApp);
	}
}

function restartedWorkspaceIdentity(identity) {
	// A new local launch deliberately creates a new view and terminal after its
	// predecessor exits. Their transient IDs must not be compared across restart.
	const {
		panelId: _panelId,
		revision: _revision,
		sessionId: _sessionId,
		viewId: _viewId,
		...stable
	} = identity;
	return stable;
}

async function requireCanonicalReadiness(window) {
	const app = window.locator('[data-terminay-app-component]');
	await app.waitFor({ state: 'visible' });
	await window.locator('.project-tab').first().waitFor({ state: 'visible' });
	await window.locator('.terminal-tab-content').first().waitFor({ state: 'visible' });

	// This is intentionally assertion-only. A missing seed must fail; this helper
	// must never click New Project/New Terminal or issue a workspace mutation.
	assert.equal(await window.locator('.project-tab').count(), 1);
	assert.equal(await window.locator('.terminal-tab-content').count(), 1);
	const context = await window.evaluate(() => window.terminayHost?.getContext());
	assert.equal(context?.hostKind, 'desktop');
	assert.match(context?.bundleId ?? '', /^[A-Za-z0-9._:-]{8,256}$/u);
	assert.equal(typeof context?.capabilities, 'object');
	assert.match(context?.profileId ?? '', /^[A-Za-z0-9._:-]{1,256}$/u);
	assert.match(context?.windowId ?? '', /^[A-Za-z0-9._:-]{1,256}$/u);

	const projectId = await app.getAttribute('data-terminay-active-project-id');
	const serverId = await app.getAttribute('data-terminay-server-id');
	const revision = await app.getAttribute('data-terminay-workspace-revision');
	const sessionId = await window
		.locator('.terminal-panel:visible')
		.getAttribute('data-terminay-terminal-session-id');
	const panelId = await window
		.locator('.terminal-tab-content:visible')
		.getAttribute('data-panel-id');
	for (const [name, value] of Object.entries({
		panelId,
		projectId,
		revision,
		serverId,
		sessionId,
	})) {
		assert.ok(value, `${name} must be present at canonical readiness`);
	}
	assert.ok(Number.isSafeInteger(Number(revision)) && Number(revision) > 0);
	return Object.freeze({
		bundleId: context.bundleId,
		environmentBinding: context.profileId,
		panelId,
		projectId,
		revision: Number(revision),
		serverId,
		sessionId,
		viewId: context.windowId,
	});
}

async function requireNativeMenu(electronApp, window) {
	const labels = await electronApp.evaluate(({ Menu }) =>
		(Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
	);
	for (const label of ['File', 'Edit', 'View', 'Help'])
		assert.ok(labels.includes(label), `native ${label} menu is required`);
	assert.equal(
		await window.locator('[data-terminay-browser-menu], .browser-menu-bar').count(),
		0,
		'Desktop must not render the browser application menu',
	);
}

async function requireBuiltInExtensionsInstalled(electronApp, window, failures) {
	const nextWindow = electronApp.waitForEvent('window');
	await window.evaluate(async () => {
		const host = window.terminayHost;
		if (!host) throw new Error('canonical Terminay host is unavailable');
		const context = await host.getContext();
		await host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: {
				disposition: 'native-window',
				logicalViewId: 'settings',
				route: '/?auxiliary=settings&section=extensions',
				type: 'route.present',
			},
		});
	});
	const settings = await nextWindow;
	captureRendererFailures(settings, failures);
	try {
		await settings.getByRole('heading', { name: 'Settings' }).waitFor();
		for (const packageName of [
			'terminay-builtin-agents',
			'terminay-language-typescript',
			'terminay-gitea',
			'terminay-github',
		]) {
			const card = settings.locator('.extension-card').filter({ hasText: packageName });
			await card.waitFor({ state: 'visible' });
			assert.equal(await card.count(), 1, `${packageName} must have one extension card`);
			const text = await card.innerText();
			assert.match(text, /Version \d+\.\d+\.\d+/u, `${packageName} must be materialized from the release bundle`);
			assert.doesNotMatch(text, /Not installed|\bfailed\b|\bincompatible\b/iu, `${packageName} must be healthy`);
		}
	} finally {
		await settings.close();
	}
}

async function requireSidebarQuery(window) {
	const sidebar = window.locator('.file-explorer-sidebar');
	if (!(await sidebar.isVisible()))
		await window.getByLabel('Toggle file explorer').click();
	await sidebar.waitFor({ state: 'visible' });
	await window.locator('.sidebar-pane').first().waitFor({ state: 'visible' });
	assert.equal(await window.getByText(/^query failed$/iu).count(), 0);
	assert.equal(await window.getByText(/missing project scope/iu).count(), 0);
}

async function requireTerminalInputOutput(window, mode) {
	const marker = `terminay-release-${mode}-${Date.now()}`;
	const panel = window.locator('.terminal-panel:visible');
	const rows = panel.locator('.xterm-rows');
	await panel.locator('.xterm-helper-textarea').focus();
	await window.keyboard.type(`printf '${marker}\\n'`);
	await window.keyboard.press('Enter');
	await rows.getByText(marker, { exact: true }).waitFor();
}

function captureRendererFailures(window, failures) {
	window.on('console', (message) => {
		if (message.type() === 'error') failures.push(`console: ${message.text()}`);
	});
	window.on('pageerror', (error) => failures.push(`page: ${error.message}`));
	window.on('requestfailed', (request) =>
		failures.push(
			`request: ${request.url()} (${request.failure()?.errorText ?? 'failed'})`,
		),
	);
	window.on('crash', () => failures.push('renderer crash'));
}

function packagedChromiumLaunchArgs() {
	if (process.platform !== 'darwin') return [];
	if (process.env.TERMINAY_ELECTRON_HEADLESS === '0') return [];
	if (process.env.TERMINAY_ELECTRON_HEADLESS === '1') return HEADLESS_CHROMIUM_ARGS;
	try {
		const session = execFileSync('/bin/launchctl', ['managername'], {
			encoding: 'utf8',
		}).trim();
		return session === 'Aqua' ? [] : HEADLESS_CHROMIUM_ARGS;
	} catch {
		return HEADLESS_CHROMIUM_ARGS;
	}
}

function captureMainProcessFailures(process, failures, mainStderr) {
	let stderr = '';
	process.stderr?.on('data', (chunk) => {
		stderr = `${stderr}${String(chunk)}`.slice(-32_000);
		if (mainStderr) mainStderr.text = stderr;
		for (const pattern of [
			/Object has been destroyed/iu,
			/uncaught exception/iu,
			/unhandled rejection/iu,
		]) {
			if (pattern.test(stderr)) failures.push(`main: ${pattern.source}`);
		}
	});
}

async function closeElectronApp(electronApp) {
	// Playwright disposes the ElectronApplication connection as part of close(),
	// so obtain the ChildProcess before closing and await its final exit event.
	// `ElectronApplication.close()` resolves after the inspector connection closes,
	// which can precede the macOS process exit by a short interval.
	const electronProcess = electronApp.process();
	await electronApp.close();
	await waitForProcessExit(electronProcess);
	assert.equal(electronProcess.signalCode, null, 'clean shutdown must not use a signal');
	assert.equal(electronProcess.exitCode, 0, 'clean shutdown must exit successfully');
}

async function emergencyClose(electronApp) {
	let electronProcess;
	try {
		electronProcess = electronApp.process();
	} catch {
		// The app may already have shut down and disposed Playwright's connection.
		return;
	}
	if (hasExited(electronProcess)) return;
	// The journey has already failed: end the application outright, and wait
	// for it to be gone.
	electronProcess.kill('SIGKILL');
	await waitForProcessExit(electronProcess).catch(() => undefined);
}

function hasExited(process) {
	return process.exitCode !== null || process.signalCode !== null;
}

async function waitForProcessExit(process) {
	if (hasExited(process)) return;
	await new Promise((resolve, reject) => {
		const onExit = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		const cleanup = () => {
			process.off('exit', onExit);
			process.off('error', onError);
		};
		process.once('exit', onExit);
		process.once('error', onError);
	});
}

async function readDiagnostics(userData) {
	const logDirectory = join(userData, 'logs');
	try {
		const { readdir } = await import('node:fs/promises');
		const files = (await readdir(logDirectory))
			.filter((name) => name.endsWith('.jsonl'))
			.sort();
		const contents = await Promise.all(
			files.map((name) => readFile(join(logDirectory, name), 'utf8')),
		);
		return contents.join('\n').slice(-32_000);
	} catch {
		return '';
	}
}

async function retainDiagnostics(userData, evidence, error) {
	if (!retainedDiagnosticsRoot) return;
	await mkdir(retainedDiagnosticsRoot, { recursive: true });
	await cp(join(userData, 'logs'), join(retainedDiagnosticsRoot, 'logs'), {
		recursive: true,
		force: true,
	}).catch(() => undefined);
	await cp(join(userData, 'extensions'), join(retainedDiagnosticsRoot, 'extensions'), {
		recursive: true,
		force: true,
	}).catch(() => undefined);
	await import('node:fs/promises').then(({ writeFile }) =>
		writeFile(
			join(retainedDiagnosticsRoot, 'packaged-smoke.json'),
			`${JSON.stringify(
				{
					error: error instanceof Error ? error.stack : String(error),
					evidence,
				},
				null,
				2,
			)}\n`,
		),
	);
}
