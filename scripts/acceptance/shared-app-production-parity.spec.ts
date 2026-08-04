import { type ChildProcessByStdio, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { ConsoleMessage, Page, Request, TestInfo } from '@playwright/test';
import { expect, test } from '../../e2e/fixtures';
import { openRemoteMenu } from '../../e2e/support/ui';

const VIEWPORT = { width: 1280, height: 800 };
type ServerProcess = ChildProcessByStdio<null, Readable, Readable>;

test('real Electron and web launch paths render identical App state and pixels', async ({
	browser,
	createWorkspace,
	mainWindow,
	tempDir,
}, testInfo) => {
	const workspace = await createWorkspace({
		name: 'shared-app-acceptance',
		seed: { files: { 'acceptance.txt': 'identical App state' } },
	});
	const web = await startStaticServer(path.resolve('dist-web'));
	const electronServer = startServer(
		workspace.rootDir,
		path.join(tempDir, 'electron-server'),
		web.origin,
	);
	const webServer = startServer(
		workspace.rootDir,
		path.join(tempDir, 'web-server'),
		web.origin,
	);
	const browserContext = await browser.newContext({
		colorScheme: 'dark',
		deviceScaleFactor: 1,
		viewport: VIEWPORT,
	});
	const webPage = await browserContext.newPage();
	const webDiagnostics: Array<Record<string, unknown>> = [];
	const webStability = await createBrowserStabilityBudget(webPage);
	webPage.on('console', (message) => {
		if (message.type() !== 'error') return;
		webDiagnostics.push({
			kind: 'console',
			type: message.type(),
			text: message.text(),
			location: message.location(),
		});
	});
	webPage.on('pageerror', (error) => {
		webDiagnostics.push({
			kind: 'pageerror',
			name: error.name,
			message: error.message,
			stack: error.stack ?? null,
		});
	});

	try {
		await Promise.race([
			runSharedAppProductionParityScenario({
				electronServer,
				web,
				webDiagnostics,
				webPage,
				webServer,
				mainWindow,
				testInfo,
			}),
			webStability.failure,
		]);
		webStability.assertHealthy();
	} catch (error) {
		const diagnosticsPath = testInfo.outputPath('web-runtime-diagnostics.json');
		const stabilityDiagnostics = await webStability.diagnostics();
		await writeFile(
			diagnosticsPath,
			JSON.stringify(
				{
					url: webPage.url(),
					diagnostics: webDiagnostics,
					stability: stabilityDiagnostics,
				},
				null,
				2,
			),
		);
		await testInfo.attach('web-runtime-diagnostics', {
			path: diagnosticsPath,
			contentType: 'application/json',
		});
		throw error;
	} finally {
		webStability.stop();
		await Promise.allSettled([
			browserContext.close(),
			web.close(),
			stopServer(electronServer),
			stopServer(webServer),
		]);
	}
});

async function runSharedAppProductionParityScenario({
	electronServer,
	web,
	webDiagnostics,
	webPage,
	webServer,
	mainWindow,
	testInfo,
}: {
	electronServer: ServerProcess;
	web: Awaited<ReturnType<typeof startStaticServer>>;
	webDiagnostics: Array<Record<string, unknown>>;
	webPage: Page;
	webServer: ServerProcess;
	mainWindow: Page;
	testInfo: TestInfo;
}) {
		const [electronReady, webReady] = await Promise.all([
			readReadiness(electronServer),
			readReadiness(webServer),
		]);
		await mainWindow.setViewportSize(VIEWPORT);
		await connectElectron(mainWindow, electronReady.pairing.pairingUrl);
		await webPage.goto(`${web.origin}/web.html`);
		const webDialog = webPage.getByRole('dialog', {
			name: 'Connect to Remote Server',
		});
		await webDialog.getByLabel('Pairing URL').fill(webReady.pairing.pairingUrl);
		await webDialog
			.getByRole('button', { name: 'Connect', exact: true })
			.click();

		const electronRoot = mainWindow.locator('[data-terminay-app-component]');
		const webRoot = webPage.locator('[data-terminay-app-component]');
		await expect(electronRoot).toBeVisible();
		await expect(webRoot).toBeVisible();
		await disableMotion(mainWindow);
		await disableMotion(webPage);

		const electronState = await semanticState(mainWindow);
		const webState = await semanticState(webPage);
		const electronPng = testInfo.outputPath('electron-app.png');
		const webPng = testInfo.outputPath('web-app.png');
		const electronStatePath = testInfo.outputPath('electron-state.json');
		const webStatePath = testInfo.outputPath('web-state.json');
		await Promise.all([
			mainWindow.screenshot({ path: electronPng, animations: 'disabled' }),
			webPage.screenshot({ path: webPng, animations: 'disabled' }),
			writeFile(electronStatePath, JSON.stringify(electronState, null, 2)),
			writeFile(webStatePath, JSON.stringify(webState, null, 2)),
		]);

		const { compareAppScreenshots } = await import(
			'../shared-app-screenshot-compare.mjs'
		);
		await compareAppScreenshots({
			electronPng,
			webPng,
			electronState,
			webState,
		});
		if (webDiagnostics.length > 0) {
			throw new Error('web runtime emitted console/page diagnostics');
		}
}

async function connectElectron(page: Page, pairingUrl: string) {
	await openRemoteMenu(page);
	await page.getByRole('button', { name: /Manage connections/u }).click();
	const dialog = page.getByRole('dialog', { name: 'Connections' });
	await dialog.getByLabel('Pairing URL').fill(pairingUrl);
	await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
	await expect(dialog).toHaveCount(0);
}

async function semanticState(page: Page) {
	return page.evaluate(() => {
		const element = document.querySelector<HTMLElement>(
			'[data-terminay-app-component]',
		);
		const activeProject = element?.querySelector<HTMLElement>(
			'.project-tab--active[data-project-id]',
		);
		const terminal = element?.querySelector<HTMLElement>(
			'[data-terminay-terminal-session-id]',
		);
		const describeLayout = (
			target: Element | null,
			stopAt: Element | null = element,
		) => {
			const entries: Array<Record<string, unknown>> = [];
			let current = target;
			while (current instanceof HTMLElement) {
				const style = getComputedStyle(current);
				const rect = current.getBoundingClientRect();
				entries.push({
					tag: current.tagName.toLowerCase(),
					id: current.id || null,
					className: current.className,
					display: style.display,
					visibility: style.visibility,
					position: style.position,
					overflow: style.overflow,
					width: rect.width,
					height: rect.height,
					top: rect.top,
					left: rect.left,
				});
				if (current === stopAt) break;
				current = current.parentElement;
			}
			return entries;
		};
		return {
			componentIdentity: element?.dataset.terminayAppComponent ?? null,
			workspaceRevision: element?.dataset.terminayWorkspaceRevision ?? null,
			projectId: activeProject?.dataset.projectId ?? null,
			viewId: 'workspace',
			panelId: terminal?.closest<HTMLElement>('[data-id]')?.dataset.id ?? null,
			panelKind: terminal == null ? null : 'terminal',
			terminalSessionId: terminal?.dataset.terminayTerminalSessionId ?? null,
			viewportWidth: document.documentElement.clientWidth,
			viewportHeight: document.documentElement.clientHeight,
			deviceScaleFactor: window.devicePixelRatio,
			terminalLayout: describeLayout(terminal ?? null),
			hostLayout: describeLayout(element, document.documentElement),
		};
	});
}

async function disableMotion(page: Page) {
	await page.addStyleTag({
		content:
			'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
	});
}

function startServer(
	projectRoot: string,
	dataRoot: string,
	webOrigin: string,
): ServerProcess {
	return spawn(
		process.execPath,
		[
			path.resolve('apps/terminay-server/dist/cli.js'),
			'--server-id',
			'shared-app-acceptance',
			'--data-root',
			dataRoot,
			'--project-root',
			projectRoot,
			'--web-origin',
			webOrigin,
			'--http-host',
			'127.0.0.1',
			'--http-port',
			'0',
		],
		{
			cwd: process.cwd(),
			env: {
				...process.env,
				TERMINAY_AGENT_INTEGRATION: 'disabled',
				TERMINAY_SERVER_VERSION: '1.0.0',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
}

interface ServerReadiness {
	pairing: { pairingUrl: string };
}

async function readReadiness(
	child: ServerProcess,
): Promise<ServerReadiness> {
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	let output = '';
	let errorOutput = '';
	child.stderr.on('data', (chunk) => {
		errorOutput += chunk;
	});
	return new Promise<ServerReadiness>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`server readiness timeout: ${errorOutput}`)),
			10_000,
		);
		child.stdout.on('data', (chunk) => {
			output += chunk;
			const newline = output.indexOf('\n');
			if (newline < 0) return;
			clearTimeout(timeout);
			resolve(JSON.parse(output.slice(0, newline)));
		});
	});
}

async function stopServer(child: ServerProcess) {
	if (child.exitCode !== null) return;
	child.kill('SIGTERM');
	await Promise.race([
		once(child, 'exit'),
		new Promise((resolve) => setTimeout(resolve, 2_000)),
	]);
	if (child.exitCode === null) child.kill('SIGKILL');
}

async function startStaticServer(root: string) {
	const server = createServer(async (request, response) => {
		const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
		const relative =
			pathname === '/' ? 'web.html' : pathname.replace(/^\/+/u, '');
		const file = path.resolve(root, relative);
		if (!file.startsWith(root)) {
			response.writeHead(403).end();
			return;
		}
		await mkdir(root, { recursive: true });
		response.setHeader(
			'content-type',
			file.endsWith('.html')
				? 'text/html'
				: file.endsWith('.css')
					? 'text/css'
					: 'text/javascript',
		);
		createReadStream(file)
			.on('error', () => response.writeHead(404).end())
			.pipe(response);
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (address === null || typeof address === 'string')
		throw new Error('Static server did not bind.');
	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}

interface BrowserStabilityThresholds {
	readonly maxConsoleErrors: number;
	readonly maxLongTasks: number;
	readonly maxLongTaskMs: number;
	readonly maxPendingProtocolRequests: number;
	readonly maxProtocolRequests: number;
	readonly maxResourceFailures: number;
}

const DEFAULT_BROWSER_STABILITY_THRESHOLDS: BrowserStabilityThresholds =
	Object.freeze({
		maxConsoleErrors: 0,
		maxLongTasks: 0,
		maxLongTaskMs: 200,
		maxPendingProtocolRequests: 12,
		maxProtocolRequests: 160,
		maxResourceFailures: 0,
	});

async function createBrowserStabilityBudget(
	page: Page,
	thresholds = DEFAULT_BROWSER_STABILITY_THRESHOLDS,
) {
	const diagnostics = {
		consoleErrors: [] as Array<Record<string, unknown>>,
		longTasks: [] as Array<Record<string, unknown>>,
		maxPendingProtocolRequestsSeen: 0,
		pendingProtocolRequests: 0,
		protocolRequestCount: 0,
		resourceFailures: [] as Array<Record<string, unknown>>,
	};
	let stopped = false;
	let fail!: (error: Error) => void;
	const failure = new Promise<never>((_resolve, reject) => {
		fail = reject;
	});
	const failFast = (message: string) => {
		if (stopped) return;
		fail(new Error(message));
	};
	const assertHealthy = () => {
		if (diagnostics.consoleErrors.length > thresholds.maxConsoleErrors) {
			throw new Error('browser stability budget exceeded: console errors');
		}
		if (diagnostics.resourceFailures.length > thresholds.maxResourceFailures) {
			throw new Error('browser stability budget exceeded: resource failures');
		}
		if (diagnostics.longTasks.length > thresholds.maxLongTasks) {
			throw new Error('browser stability budget exceeded: long tasks');
		}
		if (diagnostics.protocolRequestCount > thresholds.maxProtocolRequests) {
			throw new Error('browser stability budget exceeded: protocol requests');
		}
		if (
			diagnostics.maxPendingProtocolRequestsSeen >
			thresholds.maxPendingProtocolRequests
		) {
			throw new Error(
				'browser stability budget exceeded: pending protocol requests',
			);
		}
	};

	const isProtocolRequest = (url: string) => url.includes('/protocol');
	const onConsole = (message: ConsoleMessage) => {
		if (message.type() !== 'error') return;
		diagnostics.consoleErrors.push({
			text: message.text(),
			location: message.location(),
		});
		failFast('browser stability budget exceeded: console error');
	};
	const onRequest = (request: Request) => {
		if (!isProtocolRequest(request.url())) return;
		diagnostics.protocolRequestCount += 1;
		diagnostics.pendingProtocolRequests += 1;
		diagnostics.maxPendingProtocolRequestsSeen = Math.max(
			diagnostics.maxPendingProtocolRequestsSeen,
			diagnostics.pendingProtocolRequests,
		);
		if (diagnostics.protocolRequestCount > thresholds.maxProtocolRequests) {
			failFast('browser stability budget exceeded: protocol request count');
		}
		if (
			diagnostics.pendingProtocolRequests >
			thresholds.maxPendingProtocolRequests
		) {
			failFast('browser stability budget exceeded: pending protocol requests');
		}
	};
	const finishProtocolRequest = (request: Request) => {
		if (!isProtocolRequest(request.url())) return;
		diagnostics.pendingProtocolRequests = Math.max(
			0,
			diagnostics.pendingProtocolRequests - 1,
		);
	};
	const onRequestFailed = (request: Request) => {
		finishProtocolRequest(request);
		diagnostics.resourceFailures.push({
			url: request.url(),
			method: request.method(),
			errorText: request.failure()?.errorText ?? null,
		});
		failFast('browser stability budget exceeded: failed resource request');
	};

	page.on('console', onConsole);
	page.on('request', onRequest);
	page.on('requestfinished', finishProtocolRequest);
	page.on('requestfailed', onRequestFailed);
	await page.addInitScript(
		({ maxLongTaskMs }) => {
			const global = window as Window & {
				__terminayLongTasks?: Array<Record<string, unknown>>;
			};
			global.__terminayLongTasks = [];
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries()) {
						if (entry.duration <= maxLongTaskMs) continue;
						global.__terminayLongTasks?.push({
							duration: entry.duration,
							name: entry.name,
							startTime: entry.startTime,
						});
					}
				});
				observer.observe({ entryTypes: ['longtask'] });
			} catch {
				// Browsers without longtask support still keep the request/error budget.
			}
		},
		{ maxLongTaskMs: thresholds.maxLongTaskMs },
	);
	const longTaskTimer = setInterval(() => {
		void page
			.evaluate(() => {
				const global = window as Window & {
					__terminayLongTasks?: Array<Record<string, unknown>>;
				};
				return global.__terminayLongTasks ?? [];
			})
			.then((longTasks) => {
				diagnostics.longTasks = longTasks;
				if (longTasks.length > thresholds.maxLongTasks) {
					failFast('browser stability budget exceeded: long tasks');
				}
			})
			.catch(() => undefined);
	}, 500);

	return {
		failure,
		assertHealthy,
		async diagnostics() {
			const longTasks = await page
				.evaluate(() => {
					const global = window as Window & {
						__terminayLongTasks?: Array<Record<string, unknown>>;
					};
					return global.__terminayLongTasks ?? [];
				})
				.catch(() => []);
			diagnostics.longTasks = longTasks;
			return { thresholds, ...diagnostics };
		},
		stop() {
			stopped = true;
			clearInterval(longTaskTimer);
			page.off('console', onConsole);
			page.off('request', onRequest);
			page.off('requestfinished', finishProtocolRequest);
			page.off('requestfailed', onRequestFailed);
		},
	};
}
