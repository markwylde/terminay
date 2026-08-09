import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

export const DEFAULT_WEB_ORIGIN = 'http://127.0.0.1:8080';
export const DEFAULT_SERVER_ORIGIN = 'http://localhost:4317';
export const DEFAULT_SERVER_ID = 'compose-local';
const ROOTFUL_LINUX_CAPABILITIES = Object.freeze([
	'CAP_CHOWN',
	'CAP_DAC_OVERRIDE',
	'CAP_FOWNER',
	'CAP_FSETID',
	'CAP_KILL',
	'CAP_NET_BIND_SERVICE',
	'CAP_SETFCAP',
	'CAP_SETGID',
	'CAP_SETPCAP',
	'CAP_SETUID',
	'CAP_SYS_CHROOT',
]);
export const COMPOSE_BROWSER_STABILITY_BUDGET = Object.freeze({
	appRenders: 96,
	projectWorkspaceRenders: 128,
	protocolStarted: 128,
	protocolPending: 24,
	protocolCompletionDeficit: 24,
	protocolOperationMaximum: 16,
	pendingRequestMaximumAgeMs: 5_000,
	protocolForbiddenResponses: 1,
	unknownFilesWatchResponses: 0,
	mainFrameNavigations: 3,
	failedModuleLoads: 0,
	resourceErrors: 0,
	consoleErrors: 0,
	cspErrors: 0,
	longTaskCount: 8,
	longTaskTotalMs: 2_000,
	longTaskMaximumMs: 750,
});

export function inspectComposeBrowserStability(
	snapshot,
	budget = COMPOSE_BROWSER_STABILITY_BUDGET,
) {
	if (!snapshot || typeof snapshot !== 'object')
		throw new TypeError('browser stability snapshot must be an object');
	const values = Object.fromEntries(
		[
			'appRenders',
			'projectWorkspaceRenders',
			'protocolStarted',
			'protocolCompleted',
			'protocolPending',
			'protocolForbiddenResponses',
			'unknownFilesWatchResponses',
			'mainFrameNavigations',
			'failedModuleLoads',
			'resourceErrors',
			'consoleErrors',
			'cspErrors',
			'longTaskCount',
			'longTaskTotalMs',
			'longTaskMaximumMs',
		].map((name) => [name, nonNegative(snapshot[name], name)]),
	);
	const checks = [
		['appRenders', values.appRenders, budget.appRenders],
		[
			'projectWorkspaceRenders',
			values.projectWorkspaceRenders,
			budget.projectWorkspaceRenders,
		],
		['protocolStarted', values.protocolStarted, budget.protocolStarted],
		['protocolPending', values.protocolPending, budget.protocolPending],
		[
			'protocolCompletionDeficit',
			values.protocolStarted - values.protocolCompleted,
			budget.protocolCompletionDeficit,
		],
		[
			'protocolForbiddenResponses',
			values.protocolForbiddenResponses,
			budget.protocolForbiddenResponses,
		],
		[
			'unknownFilesWatchResponses',
			values.unknownFilesWatchResponses,
			budget.unknownFilesWatchResponses,
		],
		[
			'mainFrameNavigations',
			values.mainFrameNavigations,
			budget.mainFrameNavigations,
		],
		['failedModuleLoads', values.failedModuleLoads, budget.failedModuleLoads],
		['resourceErrors', values.resourceErrors, budget.resourceErrors],
		['consoleErrors', values.consoleErrors, budget.consoleErrors],
		['cspErrors', values.cspErrors, budget.cspErrors],
		['longTaskCount', values.longTaskCount, budget.longTaskCount],
		['longTaskTotalMs', values.longTaskTotalMs, budget.longTaskTotalMs],
		['longTaskMaximumMs', values.longTaskMaximumMs, budget.longTaskMaximumMs],
	];
	const operationCounts =
		snapshot.protocolOperationCounts &&
		typeof snapshot.protocolOperationCounts === 'object'
			? snapshot.protocolOperationCounts
			: {};
	const pathCounts =
		snapshot.protocolPathCounts &&
		typeof snapshot.protocolPathCounts === 'object'
			? snapshot.protocolPathCounts
			: {};
	for (const [path, count] of Object.entries(pathCounts))
		nonNegative(count, `protocolPathCounts.${path}`);
	for (const [operation, count] of Object.entries(operationCounts)) {
		nonNegative(count, `protocolOperationCounts.${operation}`);
		checks.push([
			`protocolOperationCounts.${operation}`,
			count,
			budget.protocolOperationMaximum,
		]);
	}
	const pendingRequests = Array.isArray(snapshot.pendingRequests)
		? snapshot.pendingRequests.map((request) => {
				if (!request || typeof request !== 'object')
					throw new TypeError('pending request must be an object');
				const ageMs = nonNegative(request.ageMs, 'pendingRequest.ageMs');
				if (
					typeof request.id !== 'string' ||
					typeof request.operation !== 'string' ||
					typeof request.path !== 'string'
				)
					throw new TypeError(
						'pending request id, operation, and path must be strings',
					);
				checks.push([
					`pendingRequestAge.${request.id}.${request.operation}`,
					ageMs,
					budget.pendingRequestMaximumAgeMs,
				]);
				return Object.freeze({
					id: request.id,
					operation: request.operation,
					path: request.path,
					ageMs,
				});
			})
		: [];
	const failure = checks.find(([, actual, maximum]) => actual > maximum);
	if (failure)
		throw new Error(
			`browser stability budget exceeded: ${failure[0]}=${failure[1]} maximum=${failure[2]}`,
		);
	return Object.freeze({
		...values,
		protocolOperationCounts: Object.freeze({ ...operationCounts }),
		protocolPathCounts: Object.freeze({ ...pathCounts }),
		pendingRequests: Object.freeze(pendingRequests),
		protocolCompletionDeficit:
			values.protocolStarted - values.protocolCompleted,
	});
}

export function inspectReconnectSurface({
	canonicalAppVisible,
	freshPairingDialogVisible,
}) {
	if (freshPairingDialogVisible)
		throw new Error(
			'browser refresh requested fresh pairing despite a reconnect grant',
		);
	if (!canonicalAppVisible)
		throw new Error('canonical App disappeared after refresh or folder open');
	return Object.freeze({
		canonicalAppVisible: true,
		freshPairingDialogVisible: false,
	});
}

export function inspectProtocolApplicationFailure(operation, envelope) {
	const message =
		envelope &&
		typeof envelope === 'object' &&
		envelope.ok === false &&
		envelope.error &&
		typeof envelope.error === 'object' &&
		typeof envelope.error.message === 'string'
			? envelope.error.message
			: '';
	const unknownFilesWatch =
		operation === 'files.watch.start' &&
		/unknown operation\s+files\.watch\.start/iu.test(message);
	return Object.freeze({
		unknownFilesWatch,
		message: message.slice(0, 160),
	});
}

function nonNegative(value, name) {
	if (!Number.isFinite(value) || value < 0)
		throw new TypeError(`${name} must be a non-negative finite number`);
	return value;
}

function protocolRequestOperation(url) {
	if (url.pathname === '/protocol/stream') return 'stream';
	if (url.pathname.startsWith('/protocol/reconnect/'))
		return url.pathname.slice('/protocol/'.length).replaceAll('/', '.');
	return url.pathname.slice('/protocol/'.length).replaceAll('/', '.') || 'root';
}

function safeUrlPath(value) {
	try {
		return new URL(value).pathname.slice(0, 256);
	} catch {
		return '<invalid-url>';
	}
}

export function redactPairingUrl(value) {
	const url = new URL(value);
	const fragmentLength = url.hash.length > 0 ? url.hash.slice(1).length : 0;
	url.hash = '';
	return `${url.toString()}#<redacted:${fragmentLength}>`;
}

export function parseComposeReadinessLogs(logs) {
	const records = [];
	for (const line of String(logs).split('\n')) {
		const jsonStart = line.indexOf('{');
		if (jsonStart < 0) continue;
		try {
			const record = JSON.parse(line.slice(jsonStart));
			if (record?.ready === true && record?.pairing?.pairingUrl)
				records.push(record);
		} catch {
			// Compose prefixes and non-JSON logs are ignored.
		}
	}
	return records;
}

export function inspectComposeReadiness(readiness, expected = {}) {
	if (!readiness || typeof readiness !== 'object')
		throw new TypeError('compose readiness must be an object');
	if (readiness.ready !== true)
		throw new Error('compose server did not report ready');
	if (readiness.serverId !== (expected.serverId ?? DEFAULT_SERVER_ID))
		throw new Error('compose server id does not match');
	if (readiness.protocolEndpoint !== 'http://0.0.0.0:4317')
		throw new Error('compose server bind endpoint does not match');
	if (readiness.healthEndpoint !== 'http://0.0.0.0:4318')
		throw new Error('compose health endpoint does not match');

	const handoff = readiness.pairing;
	if (!handoff || typeof handoff !== 'object')
		throw new Error('compose readiness pairing handoff is missing');
	if (Object.hasOwn(handoff, 'pairingToken'))
		throw new Error(
			'compose readiness must not expose the pairing token outside the URL fragment',
		);
	if (handoff.requiresApproval !== true)
		throw new Error('compose pairing must require approval');
	if (
		typeof handoff.pairingSessionId !== 'string' ||
		handoff.pairingSessionId.length === 0
	)
		throw new Error('compose pairing session id is invalid');
	if (
		typeof handoff.pairingExpiresAt !== 'string' ||
		!Number.isFinite(Date.parse(handoff.pairingExpiresAt))
	)
		throw new Error('compose pairing expiry is invalid');

	const url = new URL(handoff.pairingUrl);
	if (url.origin !== (expected.serverOrigin ?? DEFAULT_SERVER_ORIGIN))
		throw new Error(
			'compose pairing origin does not match the public server origin',
		);
	if (url.search !== '')
		throw new Error('compose pairing URL must not use a query string');
	const fragment = new URLSearchParams(url.hash.slice(1));
	const token = fragment.get('pairingToken');
	if (!token) throw new Error('compose pairing URL has no pairing token');
	if (fragment.get('pairingSessionId') !== handoff.pairingSessionId)
		throw new Error('compose pairing URL session id does not match readiness');
	if (fragment.get('pairingExpiresAt') !== handoff.pairingExpiresAt)
		throw new Error('compose pairing URL expiry does not match readiness');

	return Object.freeze({
		serverId: readiness.serverId,
		version: readiness.version,
		protocolEndpoint: readiness.protocolEndpoint,
		healthEndpoint: readiness.healthEndpoint,
		pairingSessionId: handoff.pairingSessionId,
		pairingUrl: redactPairingUrl(handoff.pairingUrl),
		tokenLength: token.length,
		fragmentLength: url.hash.slice(1).length,
		expiresAt: handoff.pairingExpiresAt,
	});
}

export function extractPairingToken(pairingUrl) {
	const token = new URLSearchParams(new URL(pairingUrl).hash.slice(1)).get(
		'pairingToken',
	);
	if (!token) throw new Error('pairing URL does not contain a token');
	return token;
}

export function pairingUrlForOrigin(pairingUrl, origin) {
	const source = new URL(pairingUrl);
	const target = new URL(origin);
	target.pathname = source.pathname;
	target.search = source.search;
	target.hash = source.hash;
	return target.toString();
}

export function inspectComposeWebHardening(hostConfig) {
	if (!hostConfig || typeof hostConfig !== 'object')
		throw new TypeError('web container HostConfig must be an object');
	const securityOpt = Array.isArray(hostConfig.SecurityOpt)
		? hostConfig.SecurityOpt
		: [];
	const capDrop = Array.isArray(hostConfig.CapDrop) ? hostConfig.CapDrop : [];
	const tmpfs =
		hostConfig.Tmpfs && typeof hostConfig.Tmpfs === 'object'
			? hostConfig.Tmpfs
			: {};
	if (hostConfig.ReadonlyRootfs !== true)
		throw new Error('web container root filesystem is not read-only');
	if (!securityOpt.includes('no-new-privileges'))
		throw new Error('web container does not have no-new-privileges enabled');
	if (
		!capDrop.includes('ALL') &&
		!ROOTFUL_LINUX_CAPABILITIES.every((capability) =>
			capDrop.includes(capability),
		)
	)
		throw new Error('web container did not drop all Linux capabilities');
	if (hostConfig.User !== '101:101')
		throw new Error('web container must run as the unprivileged nginx user');
	if (!Object.hasOwn(tmpfs, '/tmp'))
		throw new Error('web container is missing /tmp tmpfs');
	return Object.freeze({
		readOnlyRootfs: true,
		noNewPrivileges: true,
		capDropAll: true,
		unprivilegedUser: true,
		nginxRuntimeTmpfs: true,
	});
}

export async function runDockerComposeWebServerSmoke({
	docker = 'docker',
	webOrigin = DEFAULT_WEB_ORIGIN,
	serverOrigin = DEFAULT_SERVER_ORIGIN,
	serverId = DEFAULT_SERVER_ID,
	rebuild = true,
} = {}) {
	const preflight = dockerCompose(docker, ['version', '--short'], {
		timeout: 10_000,
	});
	if (preflight.status !== 0) {
		return blocked(
			'docker-compose-unavailable',
			commandError(preflight, 'docker compose is unavailable'),
		);
	}

	let initialPreviousPairingSessionId;
	if (rebuild) {
		const serverUp = dockerCompose(
			docker,
			['up', '-d', '--build', '--force-recreate', 'terminay-server'],
			{ timeout: 600_000 },
		);
		if (serverUp.status !== 0)
			return blocked(
				'compose-server-up-failed',
				commandError(serverUp, 'docker compose up terminay-server failed'),
			);
		const webUp = dockerCompose(
			docker,
			['up', '-d', '--build', '--force-recreate', 'terminay-web'],
			{ timeout: 600_000 },
		);
		if (webUp.status !== 0)
			return blocked(
				'compose-web-up-failed',
				commandError(webUp, 'docker compose up terminay-web failed'),
			);
	} else {
		initialPreviousPairingSessionId =
			latestReadiness(docker)?.pairing?.pairingSessionId;
		const restart = dockerCompose(docker, ['restart', 'terminay-server'], {
			timeout: 120_000,
		});
		if (restart.status !== 0)
			return blocked(
				'compose-server-restart-failed',
				commandError(restart, 'docker compose restart failed'),
			);
	}

	let composeBrowser;
	try {
		await waitForWebHealth(webOrigin);
		const webContainerBefore = composeContainerId(docker, 'terminay-web');
		const webHardening = inspectComposeWebHardening(
			composeContainerHostConfig(docker, webContainerBefore),
		);
		const initialReadiness = waitForNewReadiness(
			docker,
			initialPreviousPairingSessionId,
		);
		const initialPublicReadiness = inspectComposeReadiness(initialReadiness, {
			serverOrigin,
			serverId,
		});
		composeBrowser = await launchComposeBrowser({
			webOrigin,
			pairingUrl: pairingUrlForOrigin(
				initialReadiness.pairing.pairingUrl,
				webOrigin,
			),
		});

		const restart = dockerCompose(docker, ['restart', 'terminay-server'], {
			timeout: 120_000,
		});
		if (restart.status !== 0)
			throw new Error(commandError(restart, 'docker compose restart failed'));

		waitForNewReadiness(
			docker,
			initialPublicReadiness.pairingSessionId,
		);
		const reconnect = await composeBrowser.proveReconnect();
		const second = await connectLatestReadiness({
			docker,
			webOrigin,
			serverOrigin,
			serverId,
			phase: 'after-server-restart',
			previousPairingSessionId: initialPublicReadiness.pairingSessionId,
		});
		await composeBrowser.close();
		composeBrowser = undefined;
		const webContainerAfter = composeContainerId(docker, 'terminay-web');
		if (
			webContainerBefore &&
			webContainerAfter &&
			webContainerBefore !== webContainerAfter
		) {
			return blocked(
				'web-container-restarted',
				'terminay-web changed container id during server restart smoke',
			);
		}

		return Object.freeze({
			status: 'passed',
			webOrigin,
			serverOrigin,
			nginx: await inspectNginxResolver(docker),
			webHardening,
			initial: Object.freeze({
				phase: 'initial',
				readiness: initialPublicReadiness,
				browser: reconnect.initialReport,
			}),
			afterServerRestart: second.publicReport,
			browserReconnect: reconnect,
			lifecycle: Object.freeze({
				webContainerStableDuringServerRestart: true,
				serverRestartedWithoutRestartingWeb: true,
			}),
			limitations: [
				'This smoke proves local compose web-to-server HTTP protocol connectivity and server restart recovery through the web proxy. It does not prove public app.terminay.com DNS/TLS/CDN deployment or WebRTC/TURN routing.',
			],
		});
	} catch (error) {
		await composeBrowser?.close().catch(() => undefined);
		return blocked(
			'compose-web-server-smoke-failed',
			error instanceof Error ? error.message : 'compose smoke failed',
		);
	}
}

function latestReadiness(docker) {
	const logs = dockerCompose(
		docker,
		['logs', '--no-color', 'terminay-server'],
		{ timeout: 10_000 },
	);
	if (logs.status !== 0)
		throw new Error(commandError(logs, 'failed to read compose server logs'));
	return parseComposeReadinessLogs(logs.stdout).at(-1);
}

export function inspectBoundedExplorerRequests(urls, maximum = 24) {
	const protocolUrls = urls.filter((value) => {
		try {
			return new URL(value).pathname.startsWith('/protocol/');
		} catch {
			return false;
		}
	});
	if (protocolUrls.length > maximum) {
		throw new Error(
			`Explorer toggle emitted ${protocolUrls.length} protocol requests; maximum is ${maximum}`,
		);
	}
	return Object.freeze({
		maximum,
		count: protocolUrls.length,
		paths: Object.freeze(
			[...new Set(protocolUrls.map((value) => new URL(value).pathname))].sort(),
		),
	});
}

async function launchComposeBrowser({ webOrigin, pairingUrl }) {
	let chromium;
	try {
		({ chromium } = await import('playwright'));
	} catch (error) {
		throw new Error(
			`Playwright browser runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		colorScheme: 'dark',
		viewport: { width: 1280, height: 800 },
	});
	const page = await context.newPage();
	await page.addInitScript(() => {
		window.__terminayComposeSmokeMetrics = {
			appRenders: 0,
			projectWorkspaceRenders: 0,
			longTasks: [],
		};
		window.terminayBootstrapDiagnostic = {
			record(name) {
				if (name === 'app.render')
					window.__terminayComposeSmokeMetrics.appRenders++;
				if (name.startsWith('project-workspace:'))
					window.__terminayComposeSmokeMetrics.projectWorkspaceRenders++;
			},
		};
		if (typeof PerformanceObserver !== 'function') return;
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries())
				window.__terminayComposeSmokeMetrics.longTasks.push(entry.duration);
		});
		try {
			observer.observe({ type: 'longtask', buffered: true });
		} catch {
			// Unsupported browsers report no long-task observations.
		}
	});
	const artifactDirectory = resolve(
		'test-results/docker-compose-web-server-smoke',
	);
	await mkdir(artifactDirectory, { recursive: true });
	const runtimeErrors = [];
	const stability = {
		protocolStarted: 0,
		protocolCompleted: 0,
		protocolPending: 0,
		resourceErrors: 0,
		consoleErrors: 0,
		protocolForbiddenResponses: 0,
		unknownFilesWatchResponses: 0,
		mainFrameNavigations: 0,
		failedModuleLoads: 0,
		cspErrors: 0,
	};
	const compactFailures = [];
	const protocolOperationCounts = new Map();
	const protocolPathCounts = new Map();
	const pendingProtocolRequests = new Map();
	let protocolRequestSequence = 0;
	let sampleTimer;
	let budgetFailed = false;
	let lastStabilitySnapshot;
	let rejectBudget;
	const budgetFailure = new Promise((_, reject) => {
		rejectBudget = reject;
	});
	const abortBudget = (error) => {
		if (budgetFailed) return;
		budgetFailed = true;
		clearInterval(sampleTimer);
		rejectBudget(error);
		void writeFile(
			resolve(artifactDirectory, 'stability-budget-failed.json'),
			JSON.stringify(
				{
					error: error instanceof Error ? error.message : String(error),
					snapshot: lastStabilitySnapshot ?? stability,
					failures: compactFailures.slice(-16),
					runtimeErrors: runtimeErrors.slice(-16),
				},
				null,
				2,
			),
		).finally(() => context.close().finally(() => browser.close()));
	};
	const guarded = (promise) => Promise.race([promise, budgetFailure]);
	const sampleStability = async () => {
		if (budgetFailed || page.isClosed()) return undefined;
		let renderer;
		try {
			renderer = await page.evaluate(
				() =>
					window.__terminayComposeSmokeMetrics ?? {
						appRenders: 0,
						projectWorkspaceRenders: 0,
						longTasks: [],
					},
			);
		} catch (error) {
			if (isTransientNavigationSampleError(error)) {
				return lastStabilitySnapshot ?? stability;
			}
			throw error;
		}
		const longTasks = renderer.longTasks ?? [];
		try {
			lastStabilitySnapshot = {
				...stability,
				protocolOperationCounts: Object.fromEntries(
					[...protocolOperationCounts.entries()].sort(),
				),
				protocolPathCounts: Object.fromEntries(
					[...protocolPathCounts.entries()].sort(),
				),
				pendingRequests: [...pendingProtocolRequests.values()]
					.map((request) => ({
						id: request.id,
						operation: request.operation,
						path: request.path,
						ageMs: Date.now() - request.startedAt,
					}))
					.sort((left, right) => left.id.localeCompare(right.id)),
				appRenders: renderer.appRenders,
				projectWorkspaceRenders: renderer.projectWorkspaceRenders,
				longTaskCount: longTasks.length,
				longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
				longTaskMaximumMs: Math.max(0, ...longTasks),
			};
			return inspectComposeBrowserStability(lastStabilitySnapshot);
		} catch (error) {
			abortBudget(error);
			throw error;
		}
	};
	const resample = () => void sampleStability().catch(abortBudget);
	sampleTimer = setInterval(resample, 250);
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (!url.pathname.startsWith('/protocol/')) return;
		const operation = protocolRequestOperation(url);
		if (url.pathname === '/protocol/stream') {
			protocolOperationCounts.set(
				operation,
				(protocolOperationCounts.get(operation) ?? 0) + 1,
			);
			protocolPathCounts.set(
				url.pathname,
				(protocolPathCounts.get(url.pathname) ?? 0) + 1,
			);
			stability.protocolStarted++;
			stability.protocolCompleted++;
			resample();
			return;
		}
		const id = `request-${++protocolRequestSequence}`;
		pendingProtocolRequests.set(request, {
			id,
			operation,
			path: url.pathname,
			startedAt: Date.now(),
		});
		protocolOperationCounts.set(
			operation,
			(protocolOperationCounts.get(operation) ?? 0) + 1,
		);
		protocolPathCounts.set(
			url.pathname,
			(protocolPathCounts.get(url.pathname) ?? 0) + 1,
		);
		stability.protocolStarted++;
		stability.protocolPending++;
		resample();
	});
	const completeProtocol = (request) => {
		if (!new URL(request.url()).pathname.startsWith('/protocol/')) return;
		pendingProtocolRequests.delete(request);
		stability.protocolCompleted++;
		stability.protocolPending = Math.max(0, stability.protocolPending - 1);
		resample();
	};
	page.on('requestfinished', completeProtocol);
	page.on('requestfailed', completeProtocol);
	page.on('requestfailed', (request) => {
		if (request.resourceType() !== 'script') return;
		stability.failedModuleLoads++;
		compactFailures.push({
			kind: 'module-request-failed',
			path: safeUrlPath(request.url()),
			reason: request.failure()?.errorText?.slice(0, 160) ?? 'unknown',
		});
		resample();
	});
	page.on('response', (response) => {
		const pathname = new URL(response.url()).pathname;
		if (pathname.startsWith('/protocol/') && response.status() === 403) {
			stability.protocolForbiddenResponses++;
			compactFailures.push({
				kind: 'protocol-403',
				path: pathname,
				status: 403,
			});
			resample();
			return;
		}
		if (
			response.request().resourceType() === 'script' &&
			response.status() >= 400
		) {
			stability.failedModuleLoads++;
			compactFailures.push({
				kind: 'module-response-failed',
				path: pathname,
				status: response.status(),
			});
			resample();
			return;
		}
		if (pathname.startsWith('/protocol/') || response.status() < 400) return;
		stability.resourceErrors++;
		resample();
	});
	page.on('framenavigated', (frame) => {
		if (frame !== page.mainFrame()) return;
		stability.mainFrameNavigations++;
		if (
			stability.mainFrameNavigations >
			COMPOSE_BROWSER_STABILITY_BUDGET.mainFrameNavigations
		) {
			compactFailures.push({
				kind: 'repeated-navigation',
				path: safeUrlPath(frame.url()),
				count: stability.mainFrameNavigations,
			});
		}
		resample();
	});
	page.on('pageerror', (error) => {
		runtimeErrors.push(error.message);
		stability.consoleErrors++;
		resample();
	});
	page.on('console', (message) => {
		if (message.type() === 'error') {
			runtimeErrors.push(message.text());
			stability.consoleErrors++;
			if (
				/(?:content security policy|\bCSP\b|refused to (?:load|execute))/iu.test(
					message.text(),
				)
			)
				stability.cspErrors++;
			resample();
		}
	});
	await guarded(page.goto(`${webOrigin}/web.html`));
	const dialog = page.getByRole('dialog', { name: 'Connect to Remote Server' });
	await dialog.getByLabel('Pairing URL').fill(pairingUrl);
	await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
	await guarded(
		page.locator('[data-terminay-app-component]').waitFor({ state: 'visible' }),
	);
	const assertGrantReconnect = async () => {
		await guarded(page.reload());
		const canonicalApp = page.locator('[data-terminay-app-component]');
		const freshPairingDialog = page.getByRole('dialog', {
			name: 'Connect to Remote Server',
		});
		await guarded(canonicalApp.waitFor({ state: 'visible' }));
		return inspectReconnectSurface({
			canonicalAppVisible: await canonicalApp.isVisible(),
			freshPairingDialogVisible: await freshPairingDialog.isVisible(),
		});
	};
	await assertGrantReconnect();
	const activeProject = page.locator('.project-workspace--active');
	const ensureActiveExplorerVisible = async () => {
		const activeTree = activeProject.locator('.file-explorer-tree');
		if (await activeTree.isVisible().catch(() => false)) return;
		await page.getByLabel('Toggle file explorer').click();
		await activeTree.waitFor({ state: 'visible' });
	};
	const reloadActiveExplorer = async () => {
		await ensureActiveExplorerVisible();
		await activeProject.getByLabel('Reload explorer').click();
		await activeProject.locator('.file-explorer-tree-item').first().waitFor({
			state: 'visible',
		});
	};

	const protocolRequests = [];
	const collectRequest = (request) => protocolRequests.push(request.url());
	page.on('request', collectRequest);
	await page.getByLabel('Toggle file explorer').click();
	await activeProject.locator('.file-explorer-tree').waitFor({ state: 'visible' });
	const firstTreeItem = activeProject.locator('.file-explorer-tree-item').first();
	await firstTreeItem.waitFor({ state: 'visible' });
	const firstTreeItemText = (await firstTreeItem.textContent())?.trim() ?? '';
	const firstFolder = activeProject
		.locator('.file-explorer-tree-item--directory')
		.first();
	await firstFolder.waitFor({ state: 'visible' });
	await firstFolder.dblclick();
	await page.locator('.folder-viewer__body').waitFor({ state: 'visible' });
	inspectReconnectSurface({
		canonicalAppVisible: await page
			.locator('[data-terminay-app-component]')
			.isVisible(),
		freshPairingDialogVisible: false,
	});
	const sidebar = page.locator('.file-explorer-sidebar');
	const sidebarBefore = await sidebar.boundingBox();
	const resizerBox = await page
		.locator('.workspace-split-layout__separator')
		.boundingBox();
	if (!sidebarBefore || !resizerBox)
		throw new Error('Explorer resize geometry is unavailable');
	await page.mouse.move(resizerBox.x + 1, resizerBox.y + resizerBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		resizerBox.x + 32,
		resizerBox.y + resizerBox.height / 2,
		{
			steps: 4,
		},
	);
	await page.mouse.up();
	const sidebarAfter = await sidebar.boundingBox();
	if (!sidebarAfter || sidebarAfter.width <= sidebarBefore.width)
		throw new Error('Explorer resize did not increase the sidebar width');
	await page.waitForTimeout(750);
	page.off('request', collectRequest);
	const explorerRequests = inspectBoundedExplorerRequests(protocolRequests);

	const gitPane = page
		.locator('.sidebar-pane')
		.filter({ has: page.locator('.sidebar-pane__title', { hasText: 'Git' }) });
	await gitPane.waitFor({ state: 'visible' });
	if (
		(await gitPane.getAttribute('class'))?.includes('sidebar-pane--collapsed')
	) {
		await gitPane.locator('.sidebar-pane__header').click();
	}
	try {
		await page.waitForFunction(
			() => {
				const pane = [...document.querySelectorAll('.sidebar-pane')].find(
					(candidate) =>
						candidate
							.querySelector('.sidebar-pane__title')
							?.textContent?.trim() === 'Git',
				);
				const text = pane?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
				return (
					text.length > 'Git'.length &&
					!text.includes('Loading…') &&
					/(?:clean|No changes|Git is not available|Not a git repository|failed|error)/iu.test(
						text,
					)
				);
			},
			undefined,
			{ timeout: 15_000 },
		);
	} catch (error) {
		await page.screenshot({
			path: resolve(artifactDirectory, 'git-terminal-state-failed.png'),
			fullPage: true,
		});
		throw new Error(
			`Git did not reach a terminal state: ${(await gitPane.textContent())?.replace(/\s+/gu, ' ').trim() ?? '<empty>'}`,
			{ cause: error },
		);
	}
	const gitState =
		(await gitPane.textContent())?.replace(/\s+/gu, ' ').trim() ?? '';

	await page.getByLabel('Add project tab').click();
	await page
		.locator('.project-tab--active')
		.filter({ hasText: 'Project 2' })
		.waitFor({ state: 'visible' });
	const addTerminalButton = page.locator(
		'.project-workspace--active .terminay-add-tab-button',
	);
	await addTerminalButton.waitFor({ state: 'visible' });
	const addTerminalButtonBox = await addTerminalButton.boundingBox();
	if (!addTerminalButtonBox)
		throw new Error('New terminal tab button geometry is unavailable');
	await page.mouse.click(
		addTerminalButtonBox.x + addTerminalButtonBox.width / 2,
		addTerminalButtonBox.y + addTerminalButtonBox.height / 2,
	);
	await page
		.locator(
			'.project-workspace--active .dv-tab.dv-active-tab .terminal-tab-title, .project-workspace--active .terminal-tab-content--active .terminal-tab-title',
		)
		.filter({ hasText: 'Terminal 2' })
		.waitFor({ state: 'visible' });
	const terminalInput = page.getByRole('textbox', { name: 'Terminal input' });
	await terminalInput.pressSequentially(
		"printf 'compose-browser-before-restart\\n'",
	);
	await terminalInput.press('Enter');
	await page
		.locator('.terminal-panel')
		.filter({ hasText: 'compose-browser-before-restart' })
		.waitFor({ state: 'visible' });
	await reloadActiveExplorer();
	if (runtimeErrors.length > 0)
		throw new Error(`browser runtime errors: ${runtimeErrors.join(' | ')}`);

	const report = Object.freeze({
		canonicalAppVisible: true,
		explorerRequests,
		fileTreeRendered: firstTreeItemText.length > 0,
		folderOpenedWithoutBlackScreen: true,
		refreshReconnectedWithoutPairing: true,
		firstTreeItem: firstTreeItemText,
		gitTerminalState: gitState.slice(0, 240),
		explorerResized: true,
		projectCreated: true,
		terminalCreated: true,
		terminalCommandCompleted: true,
		explorerRefreshCompleted: true,
		stability: await sampleStability(),
	});
	return {
		report,
		async proveReconnect() {
			await page
				.locator('.terminal-panel')
				.filter({ hasText: 'compose-browser-after-restart' })
				.waitFor({ state: 'detached', timeout: 1_000 })
				.catch(() => undefined);
			await assertGrantReconnect();
			await terminalInput.waitFor({ state: 'visible', timeout: 60_000 });
			await terminalInput.pressSequentially(
				"printf 'compose-browser-after-restart\\n'",
			);
			await terminalInput.press('Enter');
			await page
				.locator('.terminal-panel')
				.filter({ hasText: 'compose-browser-after-restart' })
				.waitFor({ state: 'visible', timeout: 60_000 });
			await reloadActiveExplorer();
			if (runtimeErrors.length > 0)
				throw new Error(`browser runtime errors: ${runtimeErrors.join(' | ')}`);
			return Object.freeze({
				initialReport: report,
				canonicalAppVisible: await page
					.locator('[data-terminay-app-component]')
					.isVisible(),
				refreshReconnectedWithoutPairingAfterRestart: true,
				terminalCommandCompletedAfterRestart: true,
				explorerRefreshCompletedAfterRestart: true,
				stability: await sampleStability(),
			});
		},
		async close() {
			clearInterval(sampleTimer);
			await context.close();
			await browser.close();
		},
	};
}

function isTransientNavigationSampleError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes('Execution context was destroyed') ||
		message.includes('Cannot find context with specified id') ||
		message.includes('Target closed')
	);
}

async function connectLatestReadiness({
	docker,
	webOrigin,
	serverOrigin,
	serverId,
	phase,
	previousPairingSessionId,
}) {
	const readiness = waitForNewReadiness(docker, previousPairingSessionId);
	const publicReadiness = inspectComposeReadiness(readiness, {
		serverOrigin,
		serverId,
	});
	const token = extractPairingToken(readiness.pairing.pairingUrl);
	const connected = await connectThroughWebProxy({
		webOrigin,
		token,
		serverId,
	});
	return Object.freeze({
		readiness: publicReadiness,
		publicReport: Object.freeze({
			phase,
			readiness: publicReadiness,
			connection: connected,
		}),
	});
}

async function connectThroughWebProxy({ webOrigin, token, serverId }) {
	let clientCore;
	try {
		clientCore = await import('@terminay/client-core');
	} catch (error) {
		throw new Error(
			`client-core build is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const deadline = Date.now() + 30_000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			return await connectThroughWebProxyOnce({
				clientCore,
				webOrigin,
				token,
				serverId,
			});
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
	throw new Error(
		lastError instanceof Error
			? lastError.message
			: 'connection handshake failed',
	);
}

async function connectThroughWebProxyOnce({
	clientCore,
	webOrigin,
	token,
	serverId,
}) {
	const transport = new clientCore.WebSocketByteTransport({
		origin: webOrigin,
		authToken: token,
		WebSocket,
	});
	const client = new clientCore.TerminayClient({
		transport,
		clientId: `compose-smoke-${Date.now()}`,
		clientVersion: '1.0.0',
	});
	try {
		const hello = await client.connect();
		if (hello.serverId !== serverId)
			throw new Error(
				`connected server id ${hello.serverId} did not match ${serverId}`,
			);
		if (hello.authScope !== 'admin')
			throw new Error(
				`connected auth scope ${hello.authScope} did not match admin`,
			);
		const health = await client.query('server.health', {});
		if (health.ok !== true || health.result?.ready !== true)
			throw new Error('server.health did not report ready through web proxy');
		const terminals = await client.query('terminal.list', {
			projectId: 'default',
		});
		if (
			terminals.ok !== true ||
			terminals.result?.sessions?.some(
				(session) =>
					session.sessionId === 'default' && session.status === 'running',
			) !== true
		) {
			throw new Error(
				'terminal.list did not expose the default running session through web proxy',
			);
		}
		return Object.freeze({
			serverId: hello.serverId,
			serverVersion: hello.serverVersion,
			authScope: hello.authScope,
			healthReady: health.result.ready,
			defaultTerminalRunning: true,
		});
	} finally {
		await client.close().catch(() => undefined);
		await transport.close().catch(() => undefined);
	}
}

function waitForNewReadiness(docker, previousPairingSessionId) {
	const deadline = Date.now() + 60_000;
	let lastError = 'no readiness logs found';
	while (Date.now() < deadline) {
		const logs = dockerCompose(
			docker,
			['logs', '--no-color', 'terminay-server'],
			{ timeout: 10_000 },
		);
		if (logs.status !== 0) {
			lastError = commandError(logs, 'failed to read compose server logs');
		} else {
			const record = parseComposeReadinessLogs(logs.stdout).at(-1);
			if (
				record !== undefined &&
				(previousPairingSessionId === undefined ||
					record.pairing?.pairingSessionId !== previousPairingSessionId)
			)
				return record;
			lastError =
				previousPairingSessionId === undefined
					? 'no readiness record found'
					: 'no new readiness record found after restart';
		}
		sleep(250);
	}
	throw new Error(lastError);
}

async function waitForWebHealth(webOrigin) {
	const deadline = Date.now() + 60_000;
	let lastError = 'web health did not respond';
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${webOrigin}/healthz`, {
				cache: 'no-store',
			});
			const body = await response.text();
			if (response.ok && body.trim() === 'ok') return;
			lastError = `web health returned ${response.status}`;
		} catch (error) {
			lastError = error instanceof Error ? error.message : 'web health failed';
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(lastError);
}

async function inspectNginxResolver(docker) {
	const result = dockerCompose(
		docker,
		[
			'exec',
			'-T',
			'terminay-web',
			'sh',
			'-lc',
			"awk '/resolver / { print }' /etc/nginx/conf.d/default.conf",
		],
		{ timeout: 10_000 },
	);
	if (result.status !== 0)
		return Object.freeze({
			inspected: false,
			reason: commandError(result, 'failed to inspect nginx resolver'),
		});
	const line = result.stdout.trim();
	return Object.freeze({
		inspected: true,
		dynamicResolverConfigured:
			/^resolver\s+\d+\.\d+\.\d+\.\d+\s+ipv6=off\s+valid=5s;$/u.test(line),
		resolverLine: line,
	});
}

function composeContainerId(docker, service) {
	const result = dockerCompose(docker, ['ps', '-q', service], {
		timeout: 10_000,
	});
	return result.status === 0 ? result.stdout.trim() : '';
}

function composeContainerHostConfig(docker, containerId) {
	if (!containerId) throw new Error('web container id is missing');
	const result = spawnSync(
		docker,
		['inspect', '--format', '{{json .}}', containerId],
		{
			encoding: 'utf8',
			timeout: 10_000,
		},
	);
	if (result.status !== 0)
		throw new Error(
			commandError(result, 'failed to inspect web container hardening'),
		);
	try {
		const inspected = JSON.parse(result.stdout);
		return {
			...inspected.HostConfig,
			User: inspected.Config?.User,
		};
	} catch {
		throw new Error('web container hardening inspection returned invalid JSON');
	}
}

function dockerCompose(docker, args, options = {}) {
	return spawnSync(docker, ['compose', ...args], {
		encoding: 'utf8',
		maxBuffer: 100 * 1024 * 1024,
		timeout: options.timeout ?? 30_000,
	});
}

function blocked(blocker, reason) {
	return Object.freeze({ status: 'blocked', blocker, reason });
}

function commandError(result, fallback) {
	if (result.error) return result.error.message;
	const lines = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
		.trim()
		.split('\n')
		.filter(Boolean);
	return lines.at(-1) ?? fallback;
}

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const report = await runDockerComposeWebServerSmoke({
		rebuild: !process.argv.includes('--no-rebuild'),
	});
	console.log(JSON.stringify(report, null, 2));
	if (process.argv.includes('--strict') && report.status !== 'passed')
		process.exitCode = 1;
}
