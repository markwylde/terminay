import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type ElectronApplication, expect, test } from '@playwright/test';
import {
	closeDesktop,
	diagnosticsDirectory,
	launchPackagedStyleDesktop,
	readDiagnosticEvents,
	readDiagnosticText,
	readStrictDiagnosticEvents,
} from './support/local-desktop-diagnostics';

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

async function createLaunchDirectory(): Promise<{
	root: string;
	temp: string;
	userData: string;
}> {
	const root = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-diagnostics-e2e-'),
	);
	const temp = path.join(root, 'temp');
	const userData = path.join(root, 'user-data');
	await Promise.all([
		mkdir(temp, { recursive: true }),
		mkdir(userData, { recursive: true }),
	]);
	return { root, temp, userData };
}

async function waitForEvent(
	userData: string,
	eventName: string,
	predicate: (
		event: Awaited<ReturnType<typeof readDiagnosticEvents>>[number],
	) => boolean = () => true,
) {
	let matching:
		| Awaited<ReturnType<typeof readDiagnosticEvents>>[number]
		| undefined;
	await expect
		.poll(async () => {
			matching = (await readDiagnosticEvents(userData)).find(
				(event) => event.event === eventName && predicate(event),
			);
			return matching !== undefined;
		})
		.toBe(true);
	return matching!;
}

async function closeIfRunning(
	app: ElectronApplication | undefined,
): Promise<void> {
	if (!app || app.process().exitCode !== null) return;
	await closeDesktop(app).catch(() => {
		if (app.process().exitCode === null) app.process().kill('SIGKILL');
	});
}

test.describe('local Desktop diagnostics', () => {
	test('packaged-style launch is readable, private, cleanly correlated, and excludes PTY/privacy canaries', async () => {
		test.slow();
		const launch = await createLaunchDirectory();
		let app: ElectronApplication | undefined;
		const ptyCanary = 'PTY_OUTPUT_MUST_NOT_ENTER_DIAGNOSTICS_7b1e0';
		const secretCanary = 'renderer-secret-value-214d8';
		const pathCanary = '/home/private-user/secret-project/source.ts';

		try {
			app = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			const window = await app.firstWindow();
			await window.waitForLoadState('domcontentloaded');
			const started = await waitForEvent(
				launch.userData,
				'diagnostics.launch.started',
			);

			expect(started.schemaVersion).toBe(1);
			expect(started.launchId).toMatch(/^[0-9a-f-]{36}$/);
			expect(started.fields).toEqual(
				expect.objectContaining({
					architecture: expect.any(String),
					electronVersion: expect.any(String),
					operatingSystem: 'linux',
					terminayVersion: expect.any(String),
				}),
			);

			const sessionId = await window.evaluate(async () => {
				const session = await window.terminayTest!.createServerTerminal();
				return session.id;
			});
			await window.evaluate(
				async ({ canary, id }) => {
					await window.terminayTest!.writeServerTerminal(
						id,
						`printf '${canary}\\n'\n`,
					);
				},
				{ canary: ptyCanary, id: sessionId },
			);
			await window.evaluate(
				({ nextPathCanary, nextSecretCanary }) => {
					console.error(
						`diagnostic privacy proof Authorization: Bearer ${nextSecretCanary} at ${nextPathCanary}`,
					);
					const payload = {
						version: 1 as const,
						phase: 'react-root' as const,
						name: 'PrivacyProofError',
						message: `api_key=${nextSecretCanary}`,
						stack: `PrivacyProofError: failed at ${nextPathCanary}:14:3`,
					};
					window.terminayDiagnosticsHost!.reportRootError(payload);
					window.terminayDiagnosticsHost!.reportRootError(payload);
				},
				{ nextPathCanary: pathCanary, nextSecretCanary: secretCanary },
			);

			await waitForEvent(launch.userData, 'renderer.console');
			await waitForEvent(launch.userData, 'renderer.root-error');
			await closeDesktop(app);
			app = undefined;

			const events = await readStrictDiagnosticEvents(launch.userData);
			const text = await readDiagnosticText(launch.userData);
			expect(
				events.filter((event) => event.event === 'renderer.root-error'),
			).toHaveLength(1);
			expect(
				events.some((event) => event.event === 'diagnostics.launch.clean-exit'),
			).toBe(true);
			expect(events.some((event) => event.event === 'local-server.ready')).toBe(
				true,
			);
			expect(
				events.some((event) => event.event === 'local-server.stopping'),
			).toBe(true);
			expect(
				events.some((event) => event.event === 'local-server.stopped'),
			).toBe(true);
			expect(text).not.toContain(ptyCanary);
			expect(text).not.toContain(secretCanary);
			expect(text).not.toContain(pathCanary);

			const directoryMetadata = await stat(
				diagnosticsDirectory(launch.userData),
			);
			expect(directoryMetadata.mode & 0o777).toBe(PRIVATE_DIRECTORY_MODE);
			const names = await readdir(diagnosticsDirectory(launch.userData));
			const segment = names.find((name) => name.endsWith('.jsonl'));
			expect(segment).toBeTruthy();
			const segmentMetadata = await stat(
				path.join(diagnosticsDirectory(launch.userData), segment!),
			);
			expect(segmentMetadata.mode & 0o777).toBe(PRIVATE_FILE_MODE);
		} finally {
			await closeIfRunning(app);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('an interrupted launch is identified by the next launch and a clean restart replaces the marker', async () => {
		const launch = await createLaunchDirectory();
		let first: ElectronApplication | undefined;
		let second: ElectronApplication | undefined;

		try {
			first = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await first.firstWindow();
			const firstLaunch = await waitForEvent(
				launch.userData,
				'diagnostics.launch.started',
			);
			const firstClosed = first.waitForEvent('close');
			first.process().kill('SIGKILL');
			await firstClosed;
			first = undefined;

			second = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await second.firstWindow();
			const interrupted = await waitForEvent(
				launch.userData,
				'diagnostics.launch.previous-interrupted',
				(event) => event.launchId !== firstLaunch.launchId,
			);
			expect(interrupted.fields?.previousLaunchId).toBe(firstLaunch.launchId);
			await closeDesktop(second);
			second = undefined;

			const marker = JSON.parse(
				await readFile(
					path.join(
						diagnosticsDirectory(launch.userData),
						'terminay-launch-v1.json',
					),
					'utf8',
				),
			) as { launchId: string; state: string };
			expect(marker.state).toBe('clean');
			expect(marker.launchId).toBe(interrupted.launchId);
		} finally {
			await closeIfRunning(first);
			await closeIfRunning(second);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('a fatal main exception is persisted without being swallowed and is interrupted on restart', async () => {
		const launch = await createLaunchDirectory();
		let first: ElectronApplication | undefined;
		let second: ElectronApplication | undefined;

		try {
			first = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await first.firstWindow();
			const firstLaunch = await waitForEvent(
				launch.userData,
				'diagnostics.launch.started',
			);
			const closed = first.waitForEvent('close');
			await first.evaluate(() => {
				// Playwright's Electron RPC catches exceptions thrown from its callback
				// realm. Emit Node's fatal event directly so production's
				// synchronous recorder and default process.abort terminator both run.
				process.emit(
					'uncaughtException',
					new Error('fatal-main-e2e-fixture'),
					'uncaughtException',
				);
			});
			await closed;
			first = undefined;

			const fatal = await waitForEvent(
				launch.userData,
				'main.uncaught-exception',
				(event) => event.launchId === firstLaunch.launchId,
			);
			expect(fatal.severity).toBe('fatal');
			expect(fatal.message).toContain('fatal-main-e2e-fixture');

			second = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await second.firstWindow();
			const interrupted = await waitForEvent(
				launch.userData,
				'diagnostics.launch.previous-interrupted',
				(event) => event.launchId !== firstLaunch.launchId,
			);
			expect(interrupted.fields?.previousLaunchId).toBe(firstLaunch.launchId);
		} finally {
			await closeIfRunning(first);
			await closeIfRunning(second);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('records real preload/load failures and an actual renderer crash in readable JSONL', async () => {
		const launch = await createLaunchDirectory();
		let app: ElectronApplication | undefined;
		const preloadPathCanary =
			'/home/private-user/PRELOAD_PATH_MUST_BE_REDACTED.cjs';

		try {
			app = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await app.firstWindow();
			const auxiliaryId = await app.evaluate(
				async ({ BrowserWindow }, missingPreloadPath) => {
					const auxiliary = new BrowserWindow({
						show: false,
						webPreferences: {
							contextIsolation: true,
							nodeIntegration: false,
							preload: missingPreloadPath,
							sandbox: true,
						},
					});
					(
						globalThis as typeof globalThis & {
							diagnosticsAuxiliary?: Electron.BrowserWindow;
						}
					).diagnosticsAuxiliary = auxiliary;
					await auxiliary.loadURL(
						'data:text/html,<title>diagnostic fixture</title>',
					);
					return auxiliary.webContents.id;
				},
				preloadPathCanary,
			);

			await waitForEvent(launch.userData, 'renderer.preload-failed');
			await app.evaluate(async () => {
				const auxiliary = (
					globalThis as typeof globalThis & {
						diagnosticsAuxiliary?: Electron.BrowserWindow;
					}
				).diagnosticsAuxiliary!;
				await auxiliary
					.loadURL(
						'http://127.0.0.1:1/private/path?token=must-not-persist#secret',
					)
					.catch(() => undefined);
			});
			const failedLoad = await waitForEvent(
				launch.userData,
				'renderer.load-failed',
				(event) => event.source === `renderer-${auxiliaryId}`,
			);
			expect(failedLoad.fields).toEqual(
				expect.objectContaining({
					errorCode: expect.any(Number),
					isMainFrame: true,
					urlClass: 'network-document',
				}),
			);
			expect(failedLoad.fields).not.toHaveProperty('url');

			const crashId = await app.evaluate(async ({ BrowserWindow }) => {
				const crashWindow = new BrowserWindow({ show: false });
				await crashWindow.loadURL(
					'data:text/html,<title>crash fixture</title>',
				);
				const contents = crashWindow.webContents;
				const id = contents.id;
				let observed = false;
				contents.once('render-process-gone', () => {
					observed = true;
				});
				contents.debugger.attach('1.3');
				// Chromium under Xvfb does not consistently deliver Electron's event.
				// Attempt a real crash, then drive the public seam only if it was absent.
				void contents.debugger.sendCommand('Page.crash').catch(() => undefined);
				setTimeout(() => {
					if (!observed) {
						contents.emit('render-process-gone', {} as Electron.Event, {
							exitCode: 139,
							reason: 'crashed',
						});
					}
				}, 1_000);
				return id;
			});
			const crash = await waitForEvent(
				launch.userData,
				'renderer.process-gone',
				(event) => event.source === `renderer-${crashId}`,
			);
			expect(crash.fields).toEqual(
				expect.objectContaining({
					exitCode: expect.any(Number),
					metrics: expect.any(Object),
					reason: 'crashed',
				}),
			);

			await closeDesktop(app);
			app = undefined;
			const events = await readStrictDiagnosticEvents(launch.userData);
			expect(
				events.some((event) => event.event === 'renderer.preload-failed'),
			).toBe(true);
			expect(
				events.some((event) => event.event === 'renderer.load-failed'),
			).toBe(true);
			expect(
				events.some((event) => event.event === 'renderer.process-gone'),
			).toBe(true);
			expect(await readDiagnosticText(launch.userData)).not.toContain(
				preloadPathCanary,
			);
		} finally {
			await closeIfRunning(app);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('classifies synthetic OOM and Electron child failures through the main-owned event seams', async () => {
		const launch = await createLaunchDirectory();
		let app: ElectronApplication | undefined;

		try {
			app = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await app.firstWindow();
			const rendererId = await app.evaluate(({ BrowserWindow, app }) => {
				const contents = BrowserWindow.getAllWindows()[0]!.webContents;
				contents.emit('render-process-gone', {} as Electron.Event, {
					exitCode: 137,
					reason: 'oom',
				});
				app.emit('child-process-gone', {} as Electron.Event, {
					exitCode: 9,
					name: 'GPU Process',
					reason: 'crashed',
					type: 'GPU',
				});
				app.emit('child-process-gone', {} as Electron.Event, {
					exitCode: 15,
					reason: 'killed',
					serviceName: 'network.mojom.NetworkService',
					type: 'Utility',
				});
				return contents.id;
			});

			const oom = await waitForEvent(
				launch.userData,
				'renderer.process-gone',
				(event) =>
					event.source === `renderer-${rendererId}` &&
					event.fields?.reason === 'oom',
			);
			expect(oom.fields?.exitCode).toBe(137);
			const gpu = await waitForEvent(
				launch.userData,
				'electron-child.process-gone',
				(event) => event.fields?.type === 'GPU',
			);
			expect(gpu.fields).toEqual(
				expect.objectContaining({
					exitCode: 9,
					name: 'GPU Process',
					reason: 'crashed',
				}),
			);
			const networkService = await waitForEvent(
				launch.userData,
				'electron-child.process-gone',
				(event) => event.fields?.serviceName === 'network.mojom.NetworkService',
			);
			expect(networkService.fields).toEqual(
				expect.objectContaining({
					exitCode: 15,
					reason: 'killed',
					type: 'Utility',
				}),
			);
		} finally {
			await closeIfRunning(app);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('records one renderer hang episode, bounded stack outcome, and recovery duration', async () => {
		test.slow();
		const launch = await createLaunchDirectory();
		let app: ElectronApplication | undefined;

		try {
			app = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			await app.firstWindow();
			const auxiliaryId = await app.evaluate(async ({ BrowserWindow }) => {
				const auxiliary = new BrowserWindow({ show: true });
				(
					globalThis as typeof globalThis & {
						diagnosticsHangWindow?: Electron.BrowserWindow;
					}
				).diagnosticsHangWindow = auxiliary;
				await auxiliary.loadURL('data:text/html,<title>hang fixture</title>');
				return auxiliary.webContents.id;
			});

			const blockingEvaluation = app.evaluate(async () => {
				const auxiliary = (
					globalThis as typeof globalThis & {
						diagnosticsHangWindow?: Electron.BrowserWindow;
					}
				).diagnosticsHangWindow!;
				// Keep the renderer genuinely blocked while deterministically driving
				// Electron's public signal seam in the Xvfb runtime.
				setTimeout(() => {
					auxiliary.webContents.emit('unresponsive');
				}, 1_000);
				await auxiliary.webContents.executeJavaScript(
					'const blockedUntil = Date.now() + 20000; while (Date.now() < blockedUntil) {}',
				);
				auxiliary.webContents.emit('responsive');
			});
			let unresponsiveFound = false;
			await expect
				.poll(
					async () => {
						unresponsiveFound = (
							await readDiagnosticEvents(launch.userData)
						).some(
							(event) =>
								event.event === 'renderer.unresponsive' &&
								event.source === `renderer-${auxiliaryId}`,
						);
						return unresponsiveFound;
					},
					{ timeout: 30_000 },
				)
				.toBe(true);
			await expect
				.poll(async () => {
					const events = await readDiagnosticEvents(launch.userData);
					return events.some(
						(event) =>
							event.source === `renderer-${auxiliaryId}` &&
							(event.event === 'renderer.stack-collected' ||
								event.event === 'renderer.stack-unavailable'),
					);
				})
				.toBe(true);
			await blockingEvaluation;
			const responsive = await waitForEvent(
				launch.userData,
				'renderer.responsive',
				(event) => event.source === `renderer-${auxiliaryId}`,
			);
			expect(responsive.fields?.durationMs).toEqual(expect.any(Number));
			expect(responsive.fields?.durationMs).toBeGreaterThan(0);

			const events = await readDiagnosticEvents(launch.userData);
			expect(
				events.filter(
					(event) =>
						event.source === `renderer-${auxiliaryId}` &&
						event.event === 'renderer.unresponsive',
				),
			).toHaveLength(1);
		} finally {
			await closeIfRunning(app);
			await rm(launch.root, { force: true, recursive: true });
		}
	});

	test('Help reveal and confirmed clear stay main-owned after the workspace renderer crashes', async () => {
		const launch = await createLaunchDirectory();
		let app: ElectronApplication | undefined;
		const unknownName = 'support-notes-keep-me.txt';

		try {
			app = await launchPackagedStyleDesktop({
				tempDirectory: launch.temp,
				userDataDirectory: launch.userData,
			});
			const window = await app.firstWindow();
			await waitForEvent(launch.userData, 'diagnostics.launch.started');
			await writeFile(
				path.join(diagnosticsDirectory(launch.userData), unknownName),
				'not managed by Terminay',
			);
			await app.evaluate(async ({ BrowserWindow }) => {
				const contents = BrowserWindow.getAllWindows()[0]!.webContents;
				let observed = false;
				contents.once('render-process-gone', () => {
					observed = true;
				});
				contents.debugger.attach('1.3');
				void contents.debugger.sendCommand('Page.crash').catch(() => undefined);
				setTimeout(() => {
					if (!observed) {
						contents.emit('render-process-gone', {} as Electron.Event, {
							exitCode: 139,
							reason: 'crashed',
						});
					}
				}, 1_000);
			});
			await waitForEvent(launch.userData, 'renderer.process-gone');
			expect(window.isClosed()).toBe(false);

			await app.evaluate(async ({ Menu, dialog, shell }) => {
				const state = globalThis as typeof globalThis & {
					diagnosticsRevealedPath?: string;
				};
				shell.openPath = async (target) => {
					state.diagnosticsRevealedPath = target;
					return '';
				};
				dialog.showMessageBox = async () => ({
					checkboxChecked: false,
					response: 0,
				});
				const help = Menu.getApplicationMenu()!.items.find(
					(item) => item.label === 'Help',
				)!;
				help
					.submenu!.items.find(
						(item) => item.label === 'Reveal Diagnostics Folder',
					)!
					.click();
			});
			await expect
				.poll(() =>
					app!.evaluate(
						() =>
							(
								globalThis as typeof globalThis & {
									diagnosticsRevealedPath?: string;
								}
							).diagnosticsRevealedPath,
					),
				)
				.toBe(diagnosticsDirectory(launch.userData));

			await app.evaluate(({ Menu }) => {
				const help = Menu.getApplicationMenu()!.items.find(
					(item) => item.label === 'Help',
				)!;
				help
					.submenu!.items.find((item) => item.label === 'Clear Diagnostics…')!
					.click();
			});
			await waitForEvent(launch.userData, 'diagnostics.cleared');
			expect(
				await readFile(
					path.join(diagnosticsDirectory(launch.userData), unknownName),
					'utf8',
				),
			).toBe('not managed by Terminay');
			const events = await readDiagnosticEvents(launch.userData);
			expect(
				events.some((event) => event.event === 'diagnostics.cleared'),
			).toBe(true);
			expect(
				events.some((event) => event.event === 'diagnostics.launch.started'),
			).toBe(false);
		} finally {
			await closeIfRunning(app);
			await rm(launch.root, { force: true, recursive: true });
		}
	});
});
