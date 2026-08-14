import type { App, WebContents } from 'electron';
import type { DesktopDiagnostics } from './service';

const STACK_COLLECTION_TIMEOUT_MS = 2_000;

type RendererEpisode = {
	readonly startedAt: number;
};

interface ChildProcessGoneDiagnosticDetails {
	readonly exitCode: number;
	readonly name?: string;
	readonly reason: string;
	readonly serviceName?: string;
	readonly type: string;
}

const registeredContents = new WeakSet<WebContents>();
const rendererEpisodes = new Map<number, RendererEpisode>();

export function classifyDiagnosticUrl(value: string): string {
	try {
		const parsed = new URL(value);
		if (parsed.protocol === 'file:') return 'file-app';
		if (parsed.protocol === 'data:') return 'data-document';
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:')
			return 'network-document';
		return 'other-document';
	} catch {
		return 'invalid-document';
	}
}

function processMetrics(app: App, processId: number): Record<string, unknown> {
	const metric = app
		.getAppMetrics()
		.find((candidate) => candidate.pid === processId);
	if (metric === undefined) return { available: false };
	return {
		available: true,
		cpuPercent: metric.cpu.percentCPUUsage,
		idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
		memoryWorkingSetKiB: metric.memory.workingSetSize,
		processType: metric.type,
	};
}

function consoleSeverity(
	level: string,
): 'debug' | 'info' | 'warning' | 'error' {
	if (level === 'error') return 'error';
	if (level === 'warning') return 'warning';
	if (level === 'debug') return 'debug';
	return 'info';
}

async function collectStack(
	contents: WebContents,
): Promise<
	{ outcome: 'collected'; stack: string } | { outcome: 'unavailable' }
> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<void>((resolve) => {
			timer = setTimeout(resolve, STACK_COLLECTION_TIMEOUT_MS);
			timer.unref?.();
		});
		const stack = await Promise.race([
			contents.mainFrame.collectJavaScriptCallStack(),
			timeout,
		]);
		return typeof stack === 'string' && stack.length > 0
			? { outcome: 'collected', stack }
			: { outcome: 'unavailable' };
	} catch {
		return { outcome: 'unavailable' };
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export function bindWebContentsDiagnostics(options: {
	readonly app: App;
	readonly contents: WebContents;
	readonly diagnostics: DesktopDiagnostics;
	readonly now?: () => number;
}): void {
	const { app, contents, diagnostics } = options;
	if (registeredContents.has(contents)) return;
	registeredContents.add(contents);
	const webContentsId = contents.id;
	const now = options.now ?? Date.now;
	const source = `renderer-${webContentsId}`;
	let processId = contents.getOSProcessId();

	contents.on('console-message', (details) => {
		void diagnostics.record({
			component: 'renderer',
			event: 'renderer.console',
			fields: { level: details.level },
			message: details.message,
			severity: consoleSeverity(details.level),
			source,
		});
	});
	contents.on('preload-error', (_event, _preloadPath, error) => {
		void diagnostics.record(
			{
				component: 'renderer',
				event: 'renderer.preload-failed',
				message: error.message,
				severity: 'error',
				source,
				stack: error.stack,
			},
			{ channel: 'lifecycle' },
		);
	});
	contents.on(
		'did-fail-load',
		(_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
			void diagnostics.record(
				{
					component: 'renderer',
					event: 'renderer.load-failed',
					fields: {
						errorCode,
						isMainFrame,
						urlClass: classifyDiagnosticUrl(validatedUrl),
					},
					message: errorDescription,
					severity: 'error',
					source,
				},
				{ channel: 'lifecycle' },
			);
		},
	);
	contents.on(
		'did-fail-provisional-load',
		(_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
			void diagnostics.record(
				{
					component: 'renderer',
					event: 'renderer.navigation-failed',
					fields: {
						errorCode,
						isMainFrame,
						urlClass: classifyDiagnosticUrl(validatedUrl),
					},
					message: errorDescription,
					severity: 'warning',
					source,
				},
				{ channel: 'lifecycle' },
			);
		},
	);
	contents.on('render-process-gone', (_event, details) => {
		void diagnostics.record(
			{
				component: 'renderer',
				event: 'renderer.process-gone',
				fields: {
					exitCode: details.exitCode,
					metrics: processMetrics(app, processId),
					reason: details.reason,
				},
				severity: details.reason === 'clean-exit' ? 'info' : 'error',
				source,
			},
			{ channel: 'lifecycle' },
		);
		rendererEpisodes.delete(webContentsId);
	});
	contents.on('unresponsive', () => {
		if (rendererEpisodes.has(webContentsId)) return;
		processId = contents.getOSProcessId() || processId;
		rendererEpisodes.set(webContentsId, { startedAt: now() });
		void diagnostics.record(
			{
				component: 'renderer',
				event: 'renderer.unresponsive',
				fields: { metrics: processMetrics(app, processId) },
				severity: 'warning',
				source,
			},
			{ channel: 'lifecycle' },
		);
		void collectStack(contents).then((result) =>
			diagnostics.record(
				{
					component: 'renderer',
					event:
						result.outcome === 'collected'
							? 'renderer.stack-collected'
							: 'renderer.stack-unavailable',
					severity: result.outcome === 'collected' ? 'warning' : 'info',
					source,
					stack: result.outcome === 'collected' ? result.stack : undefined,
				},
				{ channel: 'lifecycle' },
			),
		);
	});
	contents.on('responsive', () => {
		const episode = rendererEpisodes.get(webContentsId);
		if (episode === undefined) return;
		rendererEpisodes.delete(webContentsId);
		void diagnostics.record(
			{
				component: 'renderer',
				event: 'renderer.responsive',
				fields: { durationMs: Math.max(0, now() - episode.startedAt) },
				severity: 'info',
				source,
			},
			{ channel: 'lifecycle' },
		);
	});
	contents.once('destroyed', () => {
		rendererEpisodes.delete(webContentsId);
		void diagnostics.record(
			{
				component: 'main',
				event: 'main.window.destroyed',
				severity: 'info',
				source,
			},
			{ channel: 'lifecycle' },
		);
	});
}

export function bindAppChildDiagnostics(options: {
	readonly app: App;
	readonly diagnostics: DesktopDiagnostics;
}): () => void {
	const { app, diagnostics } = options;
	const handler = (
		_event: Electron.Event,
		details: ChildProcessGoneDiagnosticDetails,
	) => {
		void diagnostics.record(
			{
				component: 'electron-child',
				event: 'electron-child.process-gone',
				fields: {
					exitCode: details.exitCode,
					name: details.name,
					reason: details.reason,
					serviceName: details.serviceName,
					type: details.type,
				},
				severity: details.reason === 'clean-exit' ? 'info' : 'error',
				source: `electron-child-${details.type}`,
			},
			{ channel: 'lifecycle' },
		);
	};
	app.on('child-process-gone', handler);
	return () => app.off('child-process-gone', handler);
}
