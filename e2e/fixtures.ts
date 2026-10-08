import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
} from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
	test as base,
	type ElectronApplication,
	_electron as electron,
	expect,
	type Page,
	type TestInfo,
} from '@playwright/test';
import { stageImmutableRendererArtifact } from '../scripts/immutable-renderer-artifact.mjs';
import {
	openChildWindow,
	openMacroLauncher,
	openMacrosWindow,
	openRecordingsWindow,
	openRemoteControlWindow,
	openSettingsWindow,
	prepareWindow,
	sendAppCommand,
} from './support/app';
import {
	createDialogController,
	type DialogController,
} from './support/dialogs';
import {
	createFixtureWorkspace,
	type FixtureWorkspace,
	type WorkspaceOptions,
} from './support/workspace';

type ElectronFixtures = {
	appHarness: {
		dialogs: (page?: Page) => Promise<DialogController>;
		openChildWindow: (action: () => Promise<void>) => Promise<Page>;
		openMacroLauncher: (
			page?: Page,
			options?: { attempts?: number },
		) => Promise<void>;
		openMacrosWindow: (page?: Page) => Promise<Page>;
		openRecordingsWindow: (page?: Page) => Promise<Page>;
		openRemoteControlWindow: (page?: Page) => Promise<Page>;
		openSettingsWindow: (options?: {
			page?: Page;
			sectionId?: string;
		}) => Promise<Page>;
		prepareWindow: (page: Page) => Promise<Page>;
		sendAppCommand: (
			command: import('../src/types/terminay').AppCommand,
			page?: Page,
		) => Promise<void>;
	};
	createWorkspace: (options?: WorkspaceOptions) => Promise<FixtureWorkspace>;
	electronApp: ElectronApplication;
	mainWindow: Page;
	tempDir: string;
	userDataDir: string;
};

const desktopAppReadyTimeoutMs = 15_000;

const FAILURE_DIAGNOSTIC_EVENTS = 200;
const FAILURE_DIAGNOSTIC_LINE = 600;
const FAILURE_TERMINAL_ROWS = 15;

/**
 * Say what the application recorded when a test fails. A timed-out locator
 * says only that something never appeared; the error banner's own words and
 * the server's Git, folder, and failure events say why. They go to standard
 * output so a continuous-integration log carries them without its artifacts.
 */
async function printFailureDiagnostics(
	electronApp: ElectronApplication,
	userDataDir: string,
): Promise<void> {
	const lines: string[] = [];
	for (const page of electronApp.windows()) {
		if (page.isClosed()) continue;
		const banners = await page
			.locator('.error-banner__message')
			.allTextContents()
			.catch(() => []);
		for (const banner of banners) lines.push(`error banner: ${banner}`);
		// What the terminal on screen last showed: whether a typed command ran.
		const rows = await page
			.locator(
				'.project-workspace--active .terminal-panel:visible .xterm-rows > div',
			)
			.allTextContents()
			.catch(() => []);
		const shown = rows.map((row) => row.trimEnd()).filter((row) => row !== '');
		for (const row of shown.slice(-FAILURE_TERMINAL_ROWS))
			lines.push(`terminal: ${row}`.slice(0, FAILURE_DIAGNOSTIC_LINE));
		// What each sidebar pane of the folder on screen says.
		const panes = await page
			.locator('.project-workspace--active .sidebar-pane')
			.evaluateAll((elements) =>
				elements.map((element) =>
					(element as HTMLElement).innerText.replace(/\s+/gu, ' ').trim(),
				),
			)
			.catch(() => []);
		for (const pane of panes)
			lines.push(`pane: ${pane}`.slice(0, FAILURE_DIAGNOSTIC_LINE));
		const workspace = await page
			.locator('.project-workspace--active')
			.first()
			.evaluate((element) => ({
				folder: element.getAttribute('data-terminay-folder-id'),
				kind: element.getAttribute('data-terminay-folder-kind'),
				root: element.getAttribute('data-terminay-project-root'),
			}))
			.catch(() => null);
		if (workspace !== null)
			lines.push(`workspace: ${JSON.stringify(workspace)}`);
		const focused = await page
			.evaluate(() => {
				const element = document.activeElement;
				return element === null
					? 'nothing'
					: `${element.tagName.toLowerCase()}.${element.className}`;
			})
			.catch(() => 'unknown');
		lines.push(
			`focus: ${focused}; window focused: ${await page.evaluate(() => document.hasFocus()).catch(() => 'unknown')}`,
		);
	}
	const directory = path.join(userDataDir, 'logs');
	const files = (await readdir(directory).catch(() => []))
		.filter((name) => name.endsWith('.jsonl'))
		.sort();
	const events: string[] = [];
	for (const file of files) {
		const text = await readFile(path.join(directory, file), 'utf8').catch(
			() => '',
		);
		for (const line of text.split('\n')) {
			if (line.length === 0) continue;
			try {
				const event = JSON.parse(line) as {
					event?: string;
					fields?: unknown;
					message?: string;
					severity?: string;
					timestamp?: string;
				};
				// Per-frame port tracing and Electron's development notice are
				// recorded as warnings and would bury everything else.
				if (
					/terminay-port-diagnostic|Electron Security Warning/u.test(
						event.message ?? '',
					)
				)
					continue;
				if (
					event.severity !== 'warning' &&
					event.severity !== 'error' &&
					!/git|folder|worktree|watch/u.test(event.event ?? '')
				)
					continue;
				events.push(
					`${event.timestamp ?? ''} ${event.severity ?? ''} ${event.event ?? ''} ${event.message ?? ''} ${JSON.stringify(event.fields ?? {})}`.slice(
						0,
						FAILURE_DIAGNOSTIC_LINE,
					),
				);
			} catch {
				// A line still being written is not an event yet.
			}
		}
	}
	lines.push(...events.slice(-FAILURE_DIAGNOSTIC_EVENTS));
	if (lines.length === 0) return;
	console.log(
		`\n[failure diagnostics]\n${lines.join('\n')}\n[end failure diagnostics]`,
	);
}

/** Claude Code home the agent runtime spec's fixture driver writes into. */
export function agentFixtureClaudeHome(tempDir: string): string {
	return path.join(tempDir, 'agent-fixture-claude-home');
}

const contentTypes: Record<string, string> = {
	'.css': 'text/css',
	'.html': 'text/html',
	'.ico': 'image/x-icon',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.mjs': 'text/javascript',
	'.png': 'image/png',
	'.svg': 'image/svg+xml',
	'.webp': 'image/webp',
};

async function createStaticServer(
	distRoot: string,
): Promise<{ close: () => Promise<void>; url: string }> {
	const server: Server = createServer(async (request, response) => {
		try {
			const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
			const pathname =
				requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
			const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
			let filePath: string | null = null;

			for (const root of [distRoot]) {
				const candidate = path.resolve(root, relativePath);
				if (!candidate.startsWith(root)) {
					continue;
				}

				const candidateStat = await stat(candidate).catch(() => null);
				if (candidateStat?.isFile()) {
					filePath = candidate;
					break;
				}
			}

			if (!filePath) {
				response.writeHead(404);
				response.end('Not found');
				return;
			}

			response.writeHead(200, {
				'content-type':
					contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
			});
			createReadStream(filePath).pipe(response);
		} catch {
			response.writeHead(500);
			response.end('Internal server error');
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		throw new Error('Failed to start E2E static server.');
	}

	return {
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
		url: `http://127.0.0.1:${address.port}/`,
	};
}

async function closeElectronAppGracefully(
	electronApp: ElectronApplication,
): Promise<void> {
	const closeTimeoutMs = 2_500;

	const raceWithTimeout = async <T>(
		promise: Promise<T>,
		timeoutMs: number,
		message: string,
	): Promise<T> => {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	};

	try {
		await electronApp.evaluate(({ dialog }) => {
			dialog.showMessageBox = async () => ({
				checkboxChecked: false,
				response: 0,
			});
		});
	} catch {
		// The app may already have exited during the test.
	}

	try {
		await raceWithTimeout(
			electronApp.close(),
			closeTimeoutMs,
			'Timed out waiting for Electron to close gracefully.',
		);
		return;
	} catch {
		// A broken graceful-shutdown path must not consume the test timeout.
		if (electronApp.process().exitCode === null) {
			electronApp.process().kill('SIGKILL');
		}
	}
}

/**
 * Launch the desktop app against a data directory. The `electronApp` fixture
 * uses this once; a spec that restarts the app calls it again with the same
 * directories, which is what a relaunch is.
 */
export async function launchDesktopApp(options: {
	readonly tempDir: string;
	readonly userDataDir: string;
	readonly testInfo: TestInfo;
}): Promise<{
	readonly electronApp: ElectronApplication;
	/** Quit gracefully and release everything the launch staged. */
	readonly close: () => Promise<void>;
}> {
	const { tempDir, userDataDir, testInfo } = options;
		// The built-in agents extension watches each harness's home. Point the
		// ones the agent specs drive at isolated fixture homes so the library's
		// fixture drivers, not the host account, decide what is live.
		const agentHomes: Record<string, string> =
			path.basename(testInfo.file) === 'extension-agent-runtime.spec.ts'
				? { CLAUDE_CONFIG_DIR: agentFixtureClaudeHome(tempDir) }
				: {};
		const rendererArtifactParent = await mkdtemp(
			path.join(os.tmpdir(), 'terminay-e2e-renderer-'),
		);
		const rendererArtifact = await stageImmutableRendererArtifact({
			sourceRoot: path.resolve('dist'),
			// The app owns both userData and TMP. Keep the immutable application
			// bytes in an independent fixture root until after Electron exits.
			destinationParent: rendererArtifactParent,
		});
		const staticServer = await createStaticServer(
			rendererArtifact.rootDirectory,
		);
		const electronApp = await electron.launch({
			args: ['.'],
			env: {
				...process.env,
				CI: '1',
				TEMP: tempDir,
				TERMINAY_E2E_TEMP_DIR: tempDir,
				TERMINAY_TEST: '1',
				...agentHomes,
				...(path.basename(testInfo.file) ===
				'embedded-workspace-persistence-recovery.spec.ts'
					? {
							TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT:
								persistenceFaultForTest(testInfo.title),
						}
					: {}),
				...(path.basename(testInfo.file) === 'remote-access.spec.ts'
					? { TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI: '1' }
					: {}),
				// Terminals held outside the app, so they survive a relaunch
				// (ADR-0035). Off everywhere else until the rollout turns it on.
				...(path.basename(testInfo.file) === 'terminals-survive-restart.spec.ts'
					? { TERMINAY_SESSION_HOLDER: '1' }
					: {}),
				// A 16 KiB replay window so a sustained flood outruns it during the
				// sub-second gap a Local transport loss leaves. Inert in production.
				...(path.basename(testInfo.file) ===
				'terminal-recovery-beyond-replay-window.spec.ts'
					? { TERMINAY_TEST_TERMINAL_REPLAY_BYTES: '16384' }
					: {}),
				TERMINAY_USER_DATA_DIR: userDataDir,
				TMP: tempDir,
				TMPDIR: tempDir,
				VITE_DEV_SERVER_URL: staticServer.url,
			},
		});

		let closed = false;
		return {
			electronApp,
			close: async () => {
				if (closed) return;
				closed = true;
				await closeElectronAppGracefully(electronApp);
				await staticServer.close();
				await rendererArtifact.assertUnchanged();
				await rm(rendererArtifactParent, { recursive: true, force: true });
			},
		};
}

/** Session holders recorded under a data directory that are still running. */
function liveSessionHolderPids(userDataDir: string): number[] {
	const directory = path.join(userDataDir, 'session-holder');
	if (!existsSync(directory)) return [];
	const pids: number[] = [];
	for (const name of readdirSync(directory)) {
		if (!name.endsWith('.json')) continue;
		try {
			const { pid } = JSON.parse(
				readFileSync(path.join(directory, name), 'utf8'),
			) as { pid?: unknown };
			if (typeof pid !== 'number') continue;
			process.kill(pid, 0);
			pids.push(pid);
		} catch {
			/* unreadable, or no such process */
		}
	}
	return pids;
}

export const test = base.extend<ElectronFixtures>({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright fixture callbacks require an object pattern here.
	userDataDir: async ({}, use) => {
		const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-e2e-'));

		let leaked: number[] = [];
		try {
			await use(userDataDir);
		} finally {
			// A session holder is built to outlive the application, so a test
			// that starts one must end it. One left behind would keep shells
			// running on the machine long after the suite had finished.
			leaked = liveSessionHolderPids(userDataDir);
			for (const pid of leaked) {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {
					/* already gone */
				}
			}
			await rm(userDataDir, { recursive: true, force: true });
		}
		if (leaked.length > 0)
			throw new Error(
				`a session holder outlived its test (pid ${leaked.join(', ')}); the test must end its terminals`,
			);
	},

	tempDir: async ({ userDataDir }, use) => {
		const tempDir = path.join(userDataDir, 'temp');

		await rm(tempDir, { recursive: true, force: true });
		await mkdir(tempDir, { recursive: true });
		await use(tempDir);
	},

	electronApp: async ({ tempDir, userDataDir }, use, testInfo) => {
		const launched = await launchDesktopApp({ tempDir, userDataDir, testInfo });
		try {
			await use(launched.electronApp);
		} finally {
			if (testInfo.status !== testInfo.expectedStatus)
				await printFailureDiagnostics(launched.electronApp, userDataDir);
			await launched.close();
		}
	},

	mainWindow: async ({ electronApp }, use) => {
		const mainWindow = await prepareWindow(await electronApp.firstWindow());
		await expect(mainWindow.locator('.project-tabbar')).toBeVisible({
			timeout: desktopAppReadyTimeoutMs,
		});
		await expect(mainWindow.locator('.terminal-tab-content')).toHaveCount(1, {
			timeout: desktopAppReadyTimeoutMs,
		});
		await use(mainWindow);
	},

	appHarness: async ({ electronApp, mainWindow }, use) => {
		await use({
			dialogs: async (page = mainWindow) => {
				await prepareWindow(page);
				return createDialogController(page);
			},
			openChildWindow: (action) => openChildWindow(electronApp, action),
			openMacroLauncher: (page = mainWindow, options) =>
				openMacroLauncher(page, options),
			openMacrosWindow: (page = mainWindow) =>
				openMacrosWindow(electronApp, page),
			openRecordingsWindow: (page = mainWindow) =>
				openRecordingsWindow(electronApp, page),
			openRemoteControlWindow: (page = mainWindow) =>
				openRemoteControlWindow(electronApp, page),
			openSettingsWindow: (options) =>
				openSettingsWindow(electronApp, options?.page ?? mainWindow, {
					sectionId: options?.sectionId,
				}),
			prepareWindow,
			sendAppCommand: (command, page = mainWindow) =>
				sendAppCommand(page, command),
		});
	},

	createWorkspace: async ({ tempDir }, use) => {
		await use((options?: WorkspaceOptions) =>
			createFixtureWorkspace(tempDir, options),
		);
	},
});

export { expect };

function persistenceFaultForTest(
	title: string,
): 'unreadable' | 'invalid' | 'uncommittable' {
	if (title.includes('unreadable')) return 'unreadable';
	if (title.includes('invalid')) return 'invalid';
	return 'uncommittable';
}
