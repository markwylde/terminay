/** The lightweight always-on runtime metrics collector.
 *
 * This is deliberately NOT the opt-in performance collector. It has no
 * preference, no diagnostics writer, no filesystem, no Chromium tracing, no
 * renderer stacks, and no IPC channel accounting. It samples only what
 * Electron already reports about its own processes plus the main-process event
 * loop, keeps a bounded in-memory ring for the current process, and is
 * discarded when Desktop exits.
 *
 * Sampling is refcounted by subscriber so a user who never opens the
 * Performance Log window pays nothing at all. */

import {
	createEventLoopDelayHistogram,
	type EventLoopDelayHistogram,
	type EventLoopSample,
	type ProcessMetricSample,
	roundMetric,
	snapshotEventLoopDelay,
	snapshotProcessMetrics,
} from './processMetrics';

/** No more frequent than once per second, so the collector cannot itself
 * become an unbounded CPU source. */
export const RUNTIME_METRICS_INTERVAL_MS = 1_000;
/** Five minutes at the sample interval. */
export const RUNTIME_METRICS_RING_CAPACITY = 300;

export interface RuntimeMetricsSample {
	/** Milliseconds since the epoch, for ordering only. */
	readonly at: number;
	readonly processes: readonly ProcessMetricSample[];
	readonly maxCpuPercent: number;
	readonly eventLoop?: EventLoopSample;
	readonly heapUsedBytes: number;
	readonly heapTotalBytes: number;
	readonly rssBytes: number;
}

export interface RuntimeMetricsClock {
	now(): number;
	setInterval(handler: () => void, ms: number): unknown;
	clearInterval(id: unknown): void;
}

export interface RuntimeMetricsOptions {
	readonly app: Parameters<typeof snapshotProcessMetrics>[0];
	readonly clock?: RuntimeMetricsClock;
	readonly memoryUsage?: () => NodeJS.MemoryUsage;
	readonly createEventLoopDelay?: () => EventLoopDelayHistogram;
	/** Notified after each sample so subscribers can push it to their window. */
	readonly onSample?: (sample: RuntimeMetricsSample) => void;
}

function defaultClock(): RuntimeMetricsClock {
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
	};
}

export class DesktopRuntimeMetrics {
	private readonly clock: RuntimeMetricsClock;
	private readonly memoryUsage: () => NodeJS.MemoryUsage;
	private readonly createEventLoopDelay: () => EventLoopDelayHistogram;
	private readonly ring: RuntimeMetricsSample[] = [];
	private subscribers = 0;
	private timer: unknown;
	private eventLoop: EventLoopDelayHistogram | undefined;

	constructor(private readonly options: RuntimeMetricsOptions) {
		this.clock = options.clock ?? defaultClock();
		this.memoryUsage = options.memoryUsage ?? (() => process.memoryUsage());
		this.createEventLoopDelay =
			options.createEventLoopDelay ?? createEventLoopDelayHistogram;
	}

	isRunning(): boolean {
		return this.timer !== undefined;
	}

	subscriberCount(): number {
		return this.subscribers;
	}

	/** Begin sampling for one subscriber. The returned function releases it. */
	subscribe(): () => void {
		this.subscribers += 1;
		if (this.subscribers === 1) this.start();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.subscribers = Math.max(0, this.subscribers - 1);
			if (this.subscribers === 0) this.stop();
		};
	}

	/** The retained window, oldest first. */
	samples(): readonly RuntimeMetricsSample[] {
		return Object.freeze([...this.ring]);
	}

	/** Take one sample immediately, so a newly opened window is not blank. */
	sampleNow(): RuntimeMetricsSample {
		return this.sample();
	}

	private start(): void {
		if (this.timer !== undefined) return;
		try {
			this.eventLoop = this.createEventLoopDelay();
			this.eventLoop.enable();
		} catch {
			this.eventLoop = undefined;
		}
		this.timer = this.clock.setInterval(() => {
			this.sample();
		}, RUNTIME_METRICS_INTERVAL_MS);
	}

	private stop(): void {
		if (this.timer !== undefined) {
			this.clock.clearInterval(this.timer);
			this.timer = undefined;
		}
		try {
			this.eventLoop?.disable();
		} catch {
			// A histogram that cannot be disabled must not break teardown.
		}
		this.eventLoop = undefined;
		// The ring is per-process working state, not history to preserve.
		this.ring.length = 0;
	}

	private sample(): RuntimeMetricsSample {
		const { processes, maxCpuPercent } = snapshotProcessMetrics(
			this.options.app,
		);
		const eventLoop = snapshotEventLoopDelay(this.eventLoop);
		let memory: NodeJS.MemoryUsage;
		try {
			memory = this.memoryUsage();
		} catch {
			memory = {
				arrayBuffers: 0,
				external: 0,
				heapTotal: 0,
				heapUsed: 0,
				rss: 0,
			};
		}
		const sample: RuntimeMetricsSample = Object.freeze({
			at: this.clock.now(),
			processes: Object.freeze(processes),
			maxCpuPercent: roundMetric(maxCpuPercent),
			...(eventLoop === undefined ? {} : { eventLoop }),
			heapUsedBytes: memory.heapUsed,
			heapTotalBytes: memory.heapTotal,
			rssBytes: memory.rss,
		});
		this.ring.push(sample);
		while (this.ring.length > RUNTIME_METRICS_RING_CAPACITY) this.ring.shift();
		try {
			this.options.onSample?.(sample);
		} catch {
			// A subscriber failure must not stop sampling.
		}
		return sample;
	}
}
