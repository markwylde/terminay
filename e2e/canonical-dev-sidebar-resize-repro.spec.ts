import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
	type Browser,
	chromium,
	type ElectronApplication,
	_electron as electron,
	expect,
	type Locator,
	type Page,
	test,
} from '@playwright/test';
import WebSocket from 'ws';
import { openFileExplorer } from './support/ui';

type WorkspaceCommandRecord = Readonly<{
	operation: string;
	command?: Readonly<{ type: string }>;
}>;

type ReleaseSample = Readonly<{
	boundary: number;
	commandCount: number;
	elapsedMs: number;
	when:
		| 'held'
		| 'release'
		| '50ms'
		| '100ms'
		| '250ms'
		| '500ms'
		| '1000ms'
		| '2000ms';
}>;

function activeSidebar(page: Page): Locator {
	return page.locator(
		'.project-workspace--active [data-sidebar-panel-stack], .project-workspace--active .sidebar-panel-stack',
	);
}

function pane(page: Page, id: string): Locator {
	return activeSidebar(page)
		.locator('.sidebar-pane')
		.filter({
			has: page
				.locator('.sidebar-pane__title')
				.filter({ hasText: new RegExp(`^${id}$`, 'i') }),
		});
}

function resizeHandle(page: Page, followingPaneId: string): Locator {
	// The live report is running the older recursive SidebarSplit implementation.
	// Its splitters are Explorer/rest, Agents/(Git/Documentation), then Git/Docs.
	const oldSplitIndex: Record<string, number> = {
		agents: 0,
		git: 1,
		documentation: 2,
	};
	const oldIndex = oldSplitIndex[followingPaneId];
	if (oldIndex !== undefined) {
		return activeSidebar(page)
			.locator('.sidebar-split__splitter')
			.nth(oldIndex);
	}
	return activeSidebar(page).locator(
		`[data-sidebar-resize-handle="${followingPaneId}"]`,
	);
}

async function boundaryOffset(
	page: Page,
	followingPaneId: string,
): Promise<number> {
	return await page.evaluate((paneId) => {
		const stack = document.querySelector<HTMLElement>(
			'.project-workspace--active [data-sidebar-panel-stack], .project-workspace--active .sidebar-panel-stack',
		);
		const sidebarPane = Array.from(
			document.querySelectorAll<HTMLElement>(
				'.project-workspace--active .sidebar-pane',
			),
		).find((element) => {
			const id =
				element.dataset.sidebarPaneId ?? element.dataset.sidebarPanelId;
			return (
				id === paneId ||
				element
					.querySelector('.sidebar-pane__title')
					?.textContent?.trim()
					.toLowerCase() === paneId
			);
		});
		const title = sidebarPane?.querySelector<HTMLElement>(
			'[data-sidebar-pane-title], .sidebar-pane__header-row',
		);
		if (!stack || !title)
			throw new Error(`The ${paneId} sidebar boundary is unavailable.`);
		return (
			title.getBoundingClientRect().top - stack.getBoundingClientRect().top
		);
	}, followingPaneId);
}

async function commandRecords(
	page: Page,
): Promise<readonly WorkspaceCommandRecord[]> {
	return await page.evaluate(async () => {
		const testApi = (
			window as Window & {
				terminayWorkspaceTest?: {
					getCommandRecords: () => Promise<readonly WorkspaceCommandRecord[]>;
				};
			}
		).terminayWorkspaceTest;
		if (!testApi) return [];
		return await testApi.getCommandRecords();
	});
}

async function resetCommandRecords(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const testApi = (
			window as Window & {
				terminayWorkspaceTest?: { resetCommandRecords: () => Promise<void> };
			}
		).terminayWorkspaceTest;
		if (!testApi) return;
		await testApi.resetCommandRecords();
	});
}

async function hasWorkspaceCommandTestSeam(page: Page): Promise<boolean> {
	return await page.evaluate(
		() =>
			typeof (
				window as Window & {
					terminayWorkspaceTest?: unknown;
				}
			).terminayWorkspaceTest === 'object',
	);
}

async function ensurePaneState(
	page: Page,
	id: string,
	collapsed: boolean,
): Promise<void> {
	const target = pane(page, id);
	const isCollapsed = await target.evaluate((element) =>
		element.classList.contains('sidebar-pane--collapsed'),
	);
	if (isCollapsed === collapsed) return;
	await target.locator('.sidebar-pane__header').click();
	if (collapsed) {
		await expect(target).toHaveClass(/sidebar-pane--collapsed/);
	} else {
		await expect(target).not.toHaveClass(/sidebar-pane--collapsed/);
	}
}

async function setBoundaryForReportedScreenshot(
	page: Page,
	followingPaneId: string,
	targetOffset: number,
): Promise<void> {
	const handle = resizeHandle(page, followingPaneId);
	const box = await handle.boundingBox();
	if (!box)
		throw new Error(`The ${followingPaneId} resize handle has no hit box.`);
	const currentOffset = await boundaryOffset(page, followingPaneId);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + targetOffset - currentOffset, { steps: 2 });
	await page.mouse.up();
	await expect
		.poll(() => boundaryOffset(page, followingPaneId))
		.toBeCloseTo(targetOffset, 0);
}

async function freePort(): Promise<number> {
	const server = net.createServer();
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Could not allocate a DevTools port.');
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve())),
	);
	return address.port;
}

async function waitForOutput(
	process: ChildProcess,
	output: () => string,
	pattern: RegExp,
	timeoutMs: number,
): Promise<RegExpMatchArray> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const match = output().match(pattern);
		if (match) return match;
		if (process.exitCode !== null)
			throw new Error(`npm run dev exited early:\n${output()}`);
		if (Date.now() >= deadline)
			throw new Error(`Timed out waiting for ${pattern}:\n${output()}`);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
}

async function _connectToDevelopmentElectron(
	debugPort: number,
	timeoutMs: number,
): Promise<Browser> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
	throw new Error(
		`Timed out connecting to canonical development Electron: ${String(lastError)}`,
	);
}

async function _waitForMainWindow(
	browser: Browser,
	timeoutMs: number,
	developmentOutput: () => string,
): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const context of browser.contexts()) {
			for (const candidate of context.pages()) {
				if (
					await candidate
						.locator('.project-tabbar')
						.isVisible()
						.catch(() => false)
				)
					return candidate;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`Canonical development Electron never rendered the project tab bar. ${JSON.stringify(
			{
				developmentOutput: developmentOutput(),
				pages: browser
					.contexts()
					.flatMap((context) => context.pages().map((page) => page.url())),
			},
		)}`,
	);
}

async function mainProcessInspectorEndpoint(port: number): Promise<string> {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = (await response.json()) as Array<{
				webSocketDebuggerUrl?: unknown;
			}>;
			const endpoint = targets[0]?.webSocketDebuggerUrl;
			if (typeof endpoint === 'string') return endpoint;
		} catch {
			// The Electron main-process inspector opens after Vite starts Electron.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		'Canonical development Electron never opened its Node inspector.',
	);
}

async function evaluateMainProcess(
	endpoint: string,
	expression: string,
): Promise<unknown> {
	const socket = new WebSocket(endpoint);
	await once(socket, 'open');
	try {
		const response = await new Promise<{
			exceptionDetails?: {
				exception?: { description?: string };
				text?: string;
			};
			result?: { value?: unknown };
			error?: { message?: string };
		}>((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(new Error('Main-process inspector evaluation timed out.')),
				10_000,
			);
			socket.once('error', reject);
			socket.on('message', (data) => {
				const message = JSON.parse(data.toString()) as {
					exceptionDetails?: {
						exception?: { description?: string };
						text?: string;
					};
					id?: number;
					result?: { value?: unknown };
					error?: { message?: string };
				};
				if (message.id !== 1) return;
				clearTimeout(timeout);
				resolve(message);
			});
			socket.send(
				JSON.stringify({
					id: 1,
					method: 'Runtime.evaluate',
					params: { expression, returnByValue: true },
				}),
			);
		});
		if (response.error?.message)
			throw new Error(
				`Main-process inspector error: ${response.error.message}`,
			);
		if (response.exceptionDetails)
			throw new Error(
				`Main-process evaluation failed: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'unknown error'}`,
			);
		return response.result?.value;
	} finally {
		socket.close();
	}
}

async function _setNativeWindowBounds(
	mainInspectorPort: number,
): Promise<void> {
	const endpoint = await mainProcessInspectorEndpoint(mainInspectorPort);
	const bounds = await evaluateMainProcess(
		endpoint,
		`(() => {
			const { BrowserWindow } = require('electron');
			const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
			if (!window) throw new Error('No Terminay BrowserWindow exists.');
			window.setBounds({ width: 1984, height: 1278 });
			return window.getBounds();
		})()`,
	);
	expect(bounds).toMatchObject({ height: 1278, width: 1984 });
}

async function stopDevelopmentProcess(
	development: ChildProcess,
): Promise<void> {
	if (development.exitCode !== null || !development.pid) return;
	if (process.platform !== 'win32') {
		try {
			process.kill(-development.pid, 'SIGTERM');
		} catch {
			development.kill('SIGTERM');
		}
	} else {
		development.kill('SIGTERM');
	}
	await Promise.race([
		once(development, 'exit'),
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	]);
	if (development.exitCode === null) development.kill('SIGKILL');
}

/**
 * This is intentionally a host-only diagnostic test, not part of the Docker
 * E2E suite. It starts the same `npm run dev` canonical development command
 * that the report uses, discovers Vite's dynamically chosen port from its
 * output, and drives the launched Electron renderer through its DevTools port.
 */
test('canonical npm run dev retains a rapid Agents/Git resize after mouse-up', async () => {
	test.skip(
		Boolean(process.env.CI),
		'Host-only diagnostic against a live npm run dev session; not part of the Docker E2E suite.',
	);
	test.setTimeout(120_000);
	const reportedDevelopmentWorktree = path.resolve(
		process.cwd(),
		'../terminay-center-connection-loading',
	);
	// macOS places its normal TMPDIR under a long per-user path. The desktop MCP
	// control socket lives below this isolated profile, so keep the test root
	// short enough for the platform Unix-socket path limit.
	const temporaryParent = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
	const profileRoot = await mkdtemp(
		path.join(temporaryParent, 'terminay-dev-sidebar-'),
	);
	// Seed only the live workspace record into an isolated profile. This leaves
	// the running app, credentials, caches, and the rest of its profile untouched
	// while retaining the user-reported project/sidebar preference vector.
	const liveWorkspaceRecord = path.join(
		os.homedir(),
		'Library/Application Support/Terminay/workspace.v3.json',
	);
	if (
		await access(liveWorkspaceRecord).then(
			() => true,
			() => false,
		)
	) {
		await copyFile(
			liveWorkspaceRecord,
			path.join(profileRoot, 'workspace.v3.json'),
		);
	}
	const tempDir = path.join(profileRoot, 'temp');
	const debugPort = await freePort();
	const _mainInspectorPort = await freePort();
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	let output = '';
	let browser: Browser | undefined;
	let electronApp: ElectronApplication | undefined;
	const development = spawn(npm, ['run', 'dev'], {
		cwd: reportedDevelopmentWorktree,
		detached: process.platform !== 'win32',
		env: {
			...process.env,
			CI: '1',
			ELECTRON_STARTUP_PREVENT: '1',
			REMOTE_DEBUGGING_PORT: String(debugPort),
			TEMP: tempDir,
			TERMINAY_E2E_TEMP_DIR: tempDir,
			TERMINAY_TEST: '1',
			TERMINAY_USER_DATA_DIR: profileRoot,
			TMP: tempDir,
			TMPDIR: tempDir,
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	development.stdout?.on('data', (chunk: Buffer) => {
		output += chunk.toString();
	});
	development.stderr?.on('data', (chunk: Buffer) => {
		output += chunk.toString();
	});

	try {
		// This is a command record, not a fixed assumption: Vite advances from
		// 5173 to 5174/5175/etc. when another Terminay development session exists.
		const viteUrl = await waitForOutput(
			development,
			() => output,
			/Local:\s+(http:\/\/[^\s]+)/,
			45_000,
		);
		electronApp = await electron.launch({
			args: [reportedDevelopmentWorktree],
			env: {
				...process.env,
				CI: '1',
				TEMP: tempDir,
				TERMINAY_E2E_TEMP_DIR: tempDir,
				TERMINAY_TEST: '1',
				TERMINAY_USER_DATA_DIR: profileRoot,
				TMP: tempDir,
				TMPDIR: tempDir,
				VITE_DEV_SERVER_URL: viteUrl[1],
			},
		});
		const page = await electronApp.firstWindow();
		await electronApp.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0];
			if (!window) throw new Error('No Terminay BrowserWindow exists.');
			window.setBounds({ width: 1984, height: 1278 });
		});
		await page.waitForLoadState('domcontentloaded');
		await openFileExplorer(page);
		await expect(activeSidebar(page)).toBeVisible();

		for (const id of ['explorer', 'git'])
			await ensurePaneState(page, id, false);
		await setBoundaryForReportedScreenshot(page, 'git', 400);
		await resetCommandRecords(page);
		const hasCommandTestSeam = await hasWorkspaceCommandTestSeam(page);

		const traces: Array<
			Readonly<{ attempt: number; samples: ReleaseSample[] }>
		> = [];
		for (let attempt = 1; attempt <= 20; attempt += 1) {
			// Reset to the observed geometry between independent user-equivalent
			// releases. This step is explicitly outside the sampled fast gesture.
			await setBoundaryForReportedScreenshot(page, 'git', 400);
			const handle = resizeHandle(page, 'git');
			const box = await handle.boundingBox();
			if (!box) throw new Error('The Files/Git resize handle has no hit box.');
			const x = box.x + box.width / 2;
			const y = box.y + box.height / 2;
			let pointerDownAt = 0;
			const samples: ReleaseSample[] = [];
			const sample = async (when: ReleaseSample['when']) => {
				samples.push({
					boundary: await boundaryOffset(page, 'git'),
					commandCount: (await commandRecords(page)).filter(
						(entry) => entry.command?.type === 'project.sidebar.update',
					).length,
					elapsedMs: Date.now() - pointerDownAt,
					when,
				});
			};

			const input = await page.context().newCDPSession(page);
			await input.send('Input.dispatchMouseEvent', {
				button: 'none',
				type: 'mouseMoved',
				x,
				y,
			});
			pointerDownAt = Date.now();
			await input.send('Input.dispatchMouseEvent', {
				button: 'left',
				buttons: 1,
				clickCount: 1,
				type: 'mousePressed',
				x,
				y,
			});
			// CDP Input is browser input, not a renderer-dispatched event. Sixty
			// native mouseMoved messages paced over 420ms match a short human drag
			// without the per-call latency of page.mouse.
			const inputRequests: Promise<unknown>[] = [];
			for (let move = 1; move <= 60; move += 1) {
				const dueAt = pointerDownAt + move * 7;
				const waitMs = dueAt - Date.now();
				if (waitMs > 0)
					await new Promise((resolve) => setTimeout(resolve, waitMs));
				inputRequests.push(
					input.send('Input.dispatchMouseEvent', {
						button: 'none',
						buttons: 1,
						type: 'mouseMoved',
						x,
						y: y - 120 * (move / 60),
					}),
				);
			}
			expect(
				Date.now() - pointerDownAt,
				'Pointer down through mouse-up must stay under 600ms.',
			).toBeLessThan(600);
			inputRequests.push(
				input.send('Input.dispatchMouseEvent', {
					button: 'left',
					buttons: 0,
					type: 'mouseReleased',
					x,
					y: y - 120,
				}),
			);
			await Promise.all(inputRequests);
			await sample('held');
			if (hasCommandTestSeam) {
				expect(
					samples.at(-1)?.commandCount,
					`attempt ${attempt} did not emit a sidebar command during the drag`,
				).toBeGreaterThan(0);
			}
			await input.detach();
			await sample('release');
			for (const [when, waitMs] of [
				['50ms', 50],
				['100ms', 50],
				['250ms', 150],
				['500ms', 250],
				['1000ms', 500],
				['2000ms', 1000],
			] as const) {
				await page.waitForTimeout(waitMs);
				await sample(when);
			}
			traces.push({ attempt, samples });
		}

		const bounced = traces.flatMap(({ attempt, samples }) => {
			const held = samples.find((entry) => entry.when === 'held');
			if (!held) return [{ attempt, samples }];
			return samples.some(
				(entry) =>
					entry.when !== 'held' && Math.abs(entry.boundary - held.boundary) > 1,
			)
				? [{ attempt, samples }]
				: [];
		});
		expect(
			bounced,
			`Rapid Agents/Git release sprang back in canonical npm run dev. ${JSON.stringify(
				{
					command: 'npm run dev',
					developmentWorktree: reportedDevelopmentWorktree,
					debugPort,
					traces,
					viteUrl: viteUrl[1],
					workspaceCommands: await commandRecords(page),
				},
			)}`,
		).toEqual([]);
	} finally {
		await electronApp?.close().catch(() => undefined);
		await browser?.close().catch(() => undefined);
		await stopDevelopmentProcess(development);
		await rm(profileRoot, { recursive: true, force: true });
	}
});
