/** Process and event-loop measurement shared by the opt-in performance
 * collector and the lightweight always-on runtime metrics collector.
 *
 * These helpers only read what Electron already reports about its own
 * processes and the main-process event loop. They never touch the filesystem,
 * tracing, stacks, or IPC channel names. */

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { App } from 'electron';

/** Electron reports one entry per process; a pathological count is capped. */
export const MAX_SAMPLED_PROCESSES = 32;
const MAX_LABEL_CHARS = 96;
const MAX_EVENT_LOOP_MS = 60_000;

export interface EventLoopDelayHistogram {
	enable(): void;
	disable(): void;
	reset(): void;
	readonly min: number;
	readonly max: number;
	readonly mean: number;
	percentile(percentile: number): number;
}

export interface ProcessMetricSample {
	readonly type: string;
	readonly pid: number;
	readonly cpuPercent: number;
	readonly idleWakeupsPerSecond: number;
	readonly memoryWorkingSetKiB: number;
	readonly name?: string;
	readonly serviceName?: string;
}

export interface EventLoopSample {
	readonly minMs: number;
	readonly meanMs: number;
	readonly maxMs: number;
	readonly p50Ms: number;
	readonly p99Ms: number;
}

export function boundedLabel(value: string | undefined): string | undefined {
	if (typeof value !== 'string' || value.length === 0) return undefined;
	return value.length <= MAX_LABEL_CHARS
		? value
		: value.slice(0, MAX_LABEL_CHARS);
}

export function roundMetric(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.round(value * 100) / 100;
}

export function nanosecondsToMs(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	const milliseconds = value / 1e6;
	if (milliseconds > MAX_EVENT_LOOP_MS) return 0;
	return roundMetric(milliseconds);
}

export function createEventLoopDelayHistogram(): EventLoopDelayHistogram {
	return monitorEventLoopDelay({ resolution: 20 });
}

/** Bounded snapshot of every Electron process, plus the highest CPU seen. */
export function snapshotProcessMetrics(app: Pick<App, 'getAppMetrics'>): {
	readonly processes: ProcessMetricSample[];
	readonly maxCpuPercent: number;
} {
	let metrics: ReturnType<App['getAppMetrics']> = [];
	try {
		metrics = app.getAppMetrics();
	} catch {
		return { processes: [], maxCpuPercent: 0 };
	}
	const processes = metrics
		.slice(0, MAX_SAMPLED_PROCESSES)
		.map((metric): ProcessMetricSample => {
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

/** Read and reset the histogram. Returns undefined if it cannot be read. */
export function snapshotEventLoopDelay(
	histogram: EventLoopDelayHistogram | undefined,
): EventLoopSample | undefined {
	if (histogram === undefined) return undefined;
	try {
		const snapshot: EventLoopSample = {
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
