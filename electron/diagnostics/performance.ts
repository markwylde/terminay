import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { App, TraceConfig } from 'electron';
import {
	readDiagnosticsPreferences,
	writeDiagnosticsPreferences,
} from './preferences';
import type { DesktopDiagnostics } from './service';

export const PERFORMANCE_SAMPLE_INTERVAL_MS = 5_000;
export const PERFORMANCE_STACK_CPU_PERCENT = 15;
export const PERFORMANCE_STACK_EVENT_LOOP_MAX_MS = 50;
export const PERFORMANCE_STACK_COOLDOWN_MS = 15_000;
export const PERFORMANCE_TRACE_CPU_PERCENT = 25;
export const PERFORMANCE_TRACE_DURATION_MS = 6_000;
export const PERFORMANCE_TRACE_COOLDOWN_MS = 45_000;
export const PERFORMANCE_TRACE_BUFFER_KB = 8_192;
const MAX_PROCESSES = 32;
const STACK_COLLECTION_TIMEOUT_MS = 2_000;
const MAX_LABEL_CHARS = 96;

export const PERFORMANCE_TRACE_CONFIG: TraceConfig = {
	enable_argument_filter: true,
	included_categories: [
		'toplevel',
		'electron',
		'v8',
		'cc',
		'gpu',
		'blink',
		'blink.user_timing',
		'disabled-by-default-devtools.timeline',
		'disabled-by-default-v8.cpu_profiler',
		'disabled-by-default-cpu_profiler',
	],
	excluded_categories: ['netlog', 'disabled-by-default-devtools.screenshot'],
	recording_mode: 'record-until-full',
	trace_buffer_size_in_kb: PERFORMANCE_TRACE_BUFFER_KB,
};

export interface PerformanceEventLoopDelay {
	enable(): void;
	disable(): void;
	reset(): void;
	readonly min: number;
	readonly max: number;
	readonly mean: number;
	percentile(percentile: number): number;
}

export interface PerformanceContentTracing {
	startRecording(options: TraceConfig): Promise<void>;
	stopRecording(resultFilePath?: string): Promise<string>;
}

export interface PerformanceLoggingClock {
	now(): number;
	setInterval(handler: () => void, ms: number): unknown;
	clearInterval(id: unknown): void;
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(id: unknown): void;
}

export interface PerformanceWebContents {
	readonly id: number;
	isDestroyed(): boolean;
	readonly mainFrame?: {
		collectJavaScriptCallStack(): Promise<unknown>;
	};
	on(
		event: 'ipc-message' | 'ipc-message-sync' | 'destroyed',
		listener: (...args: unknown[]) => void,
	): unknown;
	once(event: 'destroyed', listener: () => void): unknown;
	off(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface DesktopPerformanceLoggingOptions {
	readonly app: Pick<App, 'getAppMetrics'>;
	readonly contentTracing: PerformanceContentTracing;
	readonly diagnostics: DesktopDiagnostics;
	readonly userDataDirectory: string;
	readonly listWebContents: () => readonly PerformanceWebContents[];
	readonly createEventLoopDelay?: () => PerformanceEventLoopDelay;
	readonly clock?: PerformanceLoggingClock;
	readonly cpuUsage?: () => NodeJS.CpuUsage;
	readonly memoryUsage?: () => NodeJS.MemoryUsage;
	readonly onEnabledChange?: (enabled: boolean) => void;
}

const IPC_CLASS_PREFIXES: ReadonlyArray<readonly [string, string]> = [
	['server-ui-host:', 'server-ui-host'],
	['file:', 'file'],
	['secrets:', 'secrets'],
	['terminal:', 'terminal'],
	['test:', 'test'],
];

function classifyIpcChannel(channel: unknown): string {
	if (typeof channel !== 'string') return 'other';
	for (const [prefix, name] of IPC_CLASS_PREFIXES) {
		if (channel.startsWith(prefix)) return name;
	}
	return 'other';
}

function boundedLabel(value: string | undefined): string | undefined {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	return value.length <= MAX_LABEL_CHARS
		? value
		: value.slice(0, MAX_LABEL_CHARS);
}

function roundMetric(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value * 100) / 100;
}

const MAX_EVENT_LOOP_MS = 60_000;

function nanosecondsToMs(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	const milliseconds = value / 1e6;
	if (milliseconds > MAX_EVENT_LOOP_MS) return 0;
	return roundMetric(milliseconds);
}

function defaultEventLoopDelay(): PerformanceEventLoopDelay {
	return monitorEventLoopDelay({ resolution: 20 });
}

function defaultClock(): PerformanceLoggingClock {
	return {
		now: () => Date.now(),
		setInterval: (handler, ms) => {
			const id = setInterval(handler, ms);
			id.unref?.();
			return id;
		},
		clearInterval: (id) => {
			if (id !== undefined) clearInterval(id as ReturnType<typeof setInterval>);
		},
		setTimeout: (handler, ms) => {
			const id = setTimeout(handler, ms);
			id.unref?.();
			return id;
		},
		clearTimeout: (id) => {
			if (id !== undefined) clearTimeout(id as ReturnType<typeof setTimeout>);
		},
	};
}

function performanceTraceFilename(now: number, launchId: string): string {
	const safeLaunchId = launchId.replace(/[^a-zA-Z0-9_-]/gu, '_').slice(0, 96);
	return `terminay-performance-trace-v1-${now}-${safeLaunchId}.json`;
}

async function collectRendererStack(
	contents: PerformanceWebContents,
): Promise<
	{ outcome: 'collected'; stack: string } | { outcome: 'unavailable' }
> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		if (contents.isDestroyed() || contents.mainFrame === undefined)
			return { outcome: 'unavailable' };
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

/**
 * Opt-in Desktop performance sampler. Off by default; main owns every probe.
 * Renderers never receive a diagnostics logging channel.
 */
export class DesktopPerformanceLogging {
	private enabled = false;
	private restored = false;
	private sampleTimer: unknown;
	private traceStopTimer: unknown;
	private traceInProgress = false;
	private lastStackAt = Number.NEGATIVE_INFINITY;
	private lastTraceAt = Number.NEGATIVE_INFINITY;
	private previousCpu: NodeJS.CpuUsage | undefined;
	private readonly ipcCounts = new Map<string, number>();
	private readonly ipcBindings = new Map<
		number,
		{
			readonly contents: PerformanceWebContents;
			readonly onMessage: (event: unknown, channel: unknown) => void;
			readonly onDestroyed: () => void;
		}
	>();
	private eventLoop: PerformanceEventLoopDelay | undefined;
	private readonly clock: PerformanceLoggingClock;
	private readonly createEventLoopDelay: () => PerformanceEventLoopDelay;
	private readonly cpuUsage: () => NodeJS.CpuUsage;
	private readonly memoryUsage: () => NodeJS.MemoryUsage;

	constructor(private readonly options: DesktopPerformanceLoggingOptions) {
		this.clock = options.clock ?? defaultClock();
		this.createEventLoopDelay =
			options.createEventLoopDelay ?? defaultEventLoopDelay;
		this.cpuUsage = options.cpuUsage ?? (() => process.cpuUsage());
		this.memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	async restore(): Promise<void> {
		if (this.restored) return;
		this.restored = true;
		const preferences = readDiagnosticsPreferences(
			this.options.userDataDirectory,
		);
		if (preferences.performanceLogging) await this.startCollector('restore');
	}

	async setEnabled(enabled: boolean): Promise<boolean> {
		const next = enabled === true;
		try {
			writeDiagnosticsPreferences(this.options.userDataDirectory, {
				schemaVersion: 1,
				performanceLogging: next,
			});
		} catch (error) {
			void this.options.diagnostics.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.writer.degraded',
					fields: { operation: 'performance-preference' },
					message: error,
					severity: 'warning',
					source: 'performance',
				},
				{ channel: 'lifecycle' },
			);
		}
		if (next === this.enabled) {
			this.options.onEnabledChange?.(this.enabled);
			return this.enabled;
		}
		if (next) await this.startCollector('user');
		else await this.stopCollector('user');
		this.options.onEnabledChange?.(this.enabled);
		return this.enabled;
	}

	async close(): Promise<void> {
		if (!this.enabled) return;
		await this.stopCollector('shutdown');
	}

	private async startCollector(reason: 'restore' | 'user'): Promise<void> {
		if (this.enabled) return;
		this.enabled = true;
		this.eventLoop = this.createEventLoopDelay();
		this.eventLoop.enable();
		this.eventLoop.reset();
		this.previousCpu = this.cpuUsage();
		this.ipcCounts.clear();
		this.bindIpcCounters();
		this.sampleTimer = this.clock.setInterval(() => {
			void this.sample();
		}, PERFORMANCE_SAMPLE_INTERVAL_MS);
		void this.options.diagnostics.record(
			{
				component: 'diagnostics',
				event: 'diagnostics.performance.enabled',
				fields: {
					intervalMs: PERFORMANCE_SAMPLE_INTERVAL_MS,
					reason,
				},
				severity: 'info',
				source: 'performance',
			},
			{ channel: 'lifecycle' },
		);
		await this.sample({ captureTrace: true });
	}

	private async stopCollector(reason: 'user' | 'shutdown'): Promise<void> {
		if (!this.enabled) return;
		this.enabled = false;
		this.clock.clearInterval(this.sampleTimer);
		this.sampleTimer = undefined;
		this.clock.clearTimeout(this.traceStopTimer);
		this.traceStopTimer = undefined;
		this.unbindIpcCounters();
		this.ipcCounts.clear();
		this.eventLoop?.disable();
		this.eventLoop = undefined;
		this.previousCpu = undefined;
		await this.stopTrace('disabled');
		void this.options.diagnostics.record(
			{
				component: 'diagnostics',
				event: 'diagnostics.performance.disabled',
				fields: { reason },
				severity: 'info',
				source: 'performance',
			},
			{ channel: 'lifecycle' },
		);
	}

	private bindIpcCounters(): void {
		for (const contents of this.options.listWebContents())
			this.bindIpcContents(contents);
	}

	private bindIpcContents(contents: PerformanceWebContents): void {
		if (this.ipcBindings.has(contents.id) || contents.isDestroyed()) return;
		const onMessage = (_event: unknown, channel: unknown) => {
			if (!this.enabled) return;
			const name = classifyIpcChannel(channel);
			this.ipcCounts.set(name, (this.ipcCounts.get(name) ?? 0) + 1);
		};
		const onDestroyed = () => {
			this.unbindIpcContents(contents);
		};
		contents.on('ipc-message', onMessage);
		contents.on('ipc-message-sync', onMessage);
		contents.once('destroyed', onDestroyed);
		this.ipcBindings.set(contents.id, { contents, onMessage, onDestroyed });
	}

	private unbindIpcContents(contents: PerformanceWebContents): void {
		const binding = this.ipcBindings.get(contents.id);
		if (binding === undefined) return;
		this.ipcBindings.delete(contents.id);
		if (contents.isDestroyed()) return;
		contents.off('ipc-message', binding.onMessage);
		contents.off('ipc-message-sync', binding.onMessage);
		contents.off('destroyed', binding.onDestroyed);
	}

	private unbindIpcCounters(): void {
		for (const binding of [...this.ipcBindings.values()])
			this.unbindIpcContents(binding.contents);
		this.ipcBindings.clear();
	}

	private drainIpcCounts(): Record<string, number> {
		const counts: Record<string, number> = {};
		for (const [name, count] of this.ipcCounts) counts[name] = count;
		this.ipcCounts.clear();
		return counts;
	}

	private snapshotProcesses(): {
		readonly processes: Record<string, unknown>[];
		readonly maxCpuPercent: number;
	} {
		let metrics: ReturnType<App['getAppMetrics']> = [];
		try {
			metrics = this.options.app.getAppMetrics();
		} catch {
			return { processes: [], maxCpuPercent: 0 };
		}
		const processes = metrics.slice(0, MAX_PROCESSES).map((metric) => {
			const name = boundedLabel(metric.name);
			const serviceName = boundedLabel(metric.serviceName);
			return {
				type: metric.type,
				pid: metric.pid,
				cpuPercent: roundMetric(metric.cpu.percentCPUUsage),
				idleWakeupsPerSecond: roundMetric(metric.cpu.idleWakeupsPerSecond),
				memoryWorkingSetKiB: metric.memory.workingSetSize,
				...(name === undefined ? {} : { name }),
				...(serviceName === undefined ? {} : { serviceName }),
			};
		});
		const maxCpuPercent = processes.reduce(
			(max, processMetric) => Math.max(max, processMetric.cpuPercent),
			0,
		);
		return { processes, maxCpuPercent };
	}

	private snapshotEventLoop(): Record<string, number> | undefined {
		const histogram = this.eventLoop;
		if (histogram === undefined) return undefined;
		try {
			const snapshot = {
				minMs: nanosecondsToMs(histogram.min),
				meanMs: nanosecondsToMs(histogram.mean),
				maxMs: nanosecondsToMs(histogram.max),
				p50Ms: nanosecondsToMs(histogram.percentile(50)),
				p99Ms: nanosecondsToMs(histogram.percentile(99)),
			};
			histogram.reset();
			return snapshot;
		} catch {
			return undefined;
		}
	}

	private async sample(
		options: { readonly captureTrace?: boolean } = {},
	): Promise<void> {
		if (!this.enabled) return;
		this.bindIpcCounters();
		const now = this.clock.now();
		const { processes, maxCpuPercent } = this.snapshotProcesses();
		const eventLoop = this.snapshotEventLoop();
		const cpu = this.cpuUsage();
		const cpuDelta = this.previousCpu
			? {
					user: Math.max(0, cpu.user - this.previousCpu.user),
					system: Math.max(0, cpu.system - this.previousCpu.system),
				}
			: cpu;
		this.previousCpu = cpu;
		const memory = this.memoryUsage();
		const contents = this.options.listWebContents();
		void this.options.diagnostics.record(
			{
				component: 'diagnostics',
				event: 'diagnostics.performance.sample',
				fields: {
					processes,
					processCount: processes.length,
					maxCpuPercent,
					eventLoop,
					mainCpuUserUs: cpuDelta.user,
					mainCpuSystemUs: cpuDelta.system,
					mainRssBytes: memory.rss,
					mainHeapUsedBytes: memory.heapUsed,
					mainHeapTotalBytes: memory.heapTotal,
					webContentsCount: contents.length,
					ipc: this.drainIpcCounts(),
				},
				severity: 'debug',
				source: 'performance',
			},
			{ channel: 'lifecycle' },
		);
		const eventLoopMaxMs = eventLoop?.maxMs ?? 0;
		const busy =
			maxCpuPercent >= PERFORMANCE_STACK_CPU_PERCENT ||
			eventLoopMaxMs >= PERFORMANCE_STACK_EVENT_LOOP_MAX_MS;
		const collectStacks =
			busy && now - this.lastStackAt >= PERFORMANCE_STACK_COOLDOWN_MS;
		if (collectStacks) this.lastStackAt = now;
		const traceBusy =
			options.captureTrace === true ||
			maxCpuPercent >= PERFORMANCE_TRACE_CPU_PERCENT;
		const captureTrace =
			traceBusy && now - this.lastTraceAt >= PERFORMANCE_TRACE_COOLDOWN_MS;
		if (options.captureTrace === true) {
			if (collectStacks) await this.collectStacks();
			if (captureTrace) await this.startTrace();
			return;
		}
		if (collectStacks) void this.collectStacks();
		if (captureTrace) void this.startTrace();
	}

	private async collectStacks(): Promise<void> {
		for (const contents of this.options.listWebContents()) {
			if (!this.enabled || contents.isDestroyed()) continue;
			const result = await collectRendererStack(contents);
			void this.options.diagnostics.record(
				{
					component: 'renderer',
					event:
						result.outcome === 'collected'
							? 'diagnostics.performance.stack-collected'
							: 'diagnostics.performance.stack-unavailable',
					fields: { webContentsId: contents.id },
					severity: result.outcome === 'collected' ? 'info' : 'debug',
					source: `performance-renderer-${contents.id}`,
					stack: result.outcome === 'collected' ? result.stack : undefined,
				},
				{ channel: 'lifecycle' },
			);
		}
	}

	private async startTrace(): Promise<void> {
		if (!this.enabled || this.traceInProgress) return;
		this.traceInProgress = true;
		this.lastTraceAt = this.clock.now();
		try {
			await this.options.contentTracing.startRecording(
				PERFORMANCE_TRACE_CONFIG,
			);
			if (!this.enabled) {
				await this.stopTrace('disabled');
				return;
			}
			void this.options.diagnostics.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.performance.trace-started',
					fields: {
						durationMs: PERFORMANCE_TRACE_DURATION_MS,
						bufferKiB: PERFORMANCE_TRACE_BUFFER_KB,
					},
					severity: 'info',
					source: 'performance',
				},
				{ channel: 'lifecycle' },
			);
			this.traceStopTimer = this.clock.setTimeout(() => {
				void this.stopTrace('completed');
			}, PERFORMANCE_TRACE_DURATION_MS);
		} catch (error) {
			this.traceInProgress = false;
			void this.options.diagnostics.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.performance.trace-failed',
					fields: { phase: 'start' },
					message: error,
					severity: 'warning',
					source: 'performance',
				},
				{ channel: 'lifecycle' },
			);
		}
	}

	private async stopTrace(reason: 'completed' | 'disabled'): Promise<void> {
		this.clock.clearTimeout(this.traceStopTimer);
		this.traceStopTimer = undefined;
		if (!this.traceInProgress) return;
		const filename = performanceTraceFilename(
			this.clock.now(),
			this.options.diagnostics.launchId,
		);
		const outputPath = path.join(this.options.diagnostics.directory, filename);
		try {
			const written =
				await this.options.contentTracing.stopRecording(outputPath);
			this.traceInProgress = false;
			if (reason === 'disabled') return;
			void this.options.diagnostics.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.performance.trace-completed',
					fields: {
						filename,
						writtenClass:
							typeof written === 'string' && written.length > 0
								? 'file'
								: 'empty',
					},
					severity: 'info',
					source: 'performance',
				},
				{ channel: 'lifecycle' },
			);
		} catch (error) {
			this.traceInProgress = false;
			void this.options.diagnostics.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.performance.trace-failed',
					fields: { phase: 'stop' },
					message: error,
					severity: 'warning',
					source: 'performance',
				},
				{ channel: 'lifecycle' },
			);
		}
	}
}
