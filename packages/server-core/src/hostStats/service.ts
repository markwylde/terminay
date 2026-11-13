import {
	clampHostStatsIntervalSeconds,
	HOST_STATS_EVENTS,
	HOST_STATS_OPERATIONS,
	type HostStatsSample,
	type JsonValue,
	protocolError,
} from '@terminay/protocol';
import type { CommandRequest, OperationRegistries, OrderedEventJournalLike } from '../types.js';
import type { CpuTimes, DiskTotals, NetworkTotals } from './parsers.js';
import { createHostCounterReader, type HostCounterReader, type HostCounters } from './reader.js';

type IntervalHandle = unknown;

export interface HostStatsServiceOptions {
	readonly eventJournal?: OrderedEventJournalLike;
	readonly reader?: HostCounterReader;
	readonly now?: () => number;
	readonly setInterval?: (handler: () => void, milliseconds: number) => IntervalHandle;
	readonly clearInterval?: (handle: IntervalHandle) => void;
	readonly onDiagnostic?: (message: string) => void;
}

type Reading = { readonly at: number; readonly counters: HostCounters };

function rate(current: number, previous: number, seconds: number): number {
	// A counter that went backwards (an interface reset, a disk detached) is
	// read as no traffic for this interval rather than a negative rate.
	return current >= previous ? (current - previous) / seconds : 0;
}

function cpuPercent(current: CpuTimes | null, previous: CpuTimes | null) {
	if (current === null || previous === null) return null;
	const total = current.total - previous.total;
	const busy = current.busy - previous.busy;
	if (total <= 0 || busy < 0) return null;
	return { percent: Math.min(100, (busy / total) * 100), cores: current.cores };
}

function networkRates(current: NetworkTotals | null, previous: NetworkTotals | null, seconds: number) {
	if (current === null || previous === null) return null;
	return {
		receivedBytesPerSecond: rate(current.receivedBytes, previous.receivedBytes, seconds),
		sentBytesPerSecond: rate(current.sentBytes, previous.sentBytes, seconds),
	};
}

function diskRates(current: DiskTotals | null, previous: DiskTotals | null, seconds: number) {
	if (current === null || previous === null) return null;
	return {
		readBytesPerSecond: rate(current.readBytes, previous.readBytes, seconds),
		writtenBytesPerSecond: rate(current.writtenBytes, previous.writtenBytes, seconds),
	};
}

/** A sample from two consecutive readings, or null when no time passed. */
export function hostStatsSample(previous: Reading, current: Reading): HostStatsSample | null {
	const elapsedMs = current.at - previous.at;
	if (elapsedMs <= 0) return null;
	const seconds = elapsedMs / 1000;
	return {
		at: current.at,
		intervalMs: elapsedMs,
		cpu: cpuPercent(current.counters.cpu, previous.counters.cpu),
		memory: current.counters.memory,
		network: networkRates(current.counters.network, previous.counters.network, seconds),
		disk: diskRates(current.counters.disk, previous.counters.disk, seconds),
	};
}

/**
 * Samples this server's host while at least one connection watches.
 *
 * Each watching connection asks for an interval; the host is sampled at the
 * shortest. The first watch arms the timer and the last unwatch, connection
 * close or dispose clears it, so a server nobody is watching reads nothing.
 */
export class HostStatsService {
	private readonly watchers = new Map<string, number>();
	private readonly reader: HostCounterReader;
	private readonly now: () => number;
	private readonly scheduleInterval: (handler: () => void, milliseconds: number) => IntervalHandle;
	private readonly cancelInterval: (handle: IntervalHandle) => void;
	private timer: IntervalHandle | undefined;
	private timerIntervalMs: number | undefined;
	private previous: Reading | undefined;
	private reading = false;
	/** Bumped when sampling stops, so a read already in flight is discarded. */
	private generation = 0;
	private disposed = false;

	constructor(private readonly options: HostStatsServiceOptions = {}) {
		this.reader = options.reader ?? createHostCounterReader();
		this.now = options.now ?? Date.now;
		this.scheduleInterval =
			options.setInterval ??
			((handler, milliseconds) => {
				const timer = setInterval(handler, milliseconds);
				// Sampling never keeps a server alive that has nothing else to do.
				(timer as { unref?: () => void }).unref?.();
				return timer;
			});
		this.cancelInterval =
			options.clearInterval ??
			((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
	}

	/** The interval the host is sampled at now, or undefined while nobody watches. */
	get intervalMs(): number | undefined {
		return this.timerIntervalMs;
	}

	get watcherCount(): number {
		return this.watchers.size;
	}

	watch(connectionId: string, intervalSeconds: unknown): number {
		if (this.disposed) return clampHostStatsIntervalSeconds(intervalSeconds);
		const seconds = clampHostStatsIntervalSeconds(intervalSeconds);
		this.watchers.set(connectionId, seconds * 1000);
		this.rearm();
		return seconds;
	}

	unwatch(connectionId: string): void {
		if (!this.watchers.delete(connectionId)) return;
		this.rearm();
	}

	/** Forget a connection's watch, as when it closes. */
	closeConnection(connectionId: string): void {
		this.unwatch(connectionId);
	}

	dispose(): void {
		this.disposed = true;
		this.watchers.clear();
		this.rearm();
	}

	private rearm(): void {
		const wanted =
			this.watchers.size === 0 ? undefined : Math.min(...this.watchers.values());
		if (wanted === this.timerIntervalMs) return;
		if (this.timer !== undefined) this.cancelInterval(this.timer);
		this.timer = undefined;
		this.timerIntervalMs = wanted;
		if (wanted === undefined) {
			// Nobody is watching: drop the baseline and discard any read in flight.
			this.previous = undefined;
			this.generation += 1;
			return;
		}
		// An owner-approved poll (ADR-0028). Host CPU, memory, network and disk
		// counters raise no change events, so they are sampled on this interval.
		// Approved by Mark Wylde on 2026-11-13: default 5 s, with the interval
		// the user's to choose (whole seconds, 1 to 3600), in change
		// `host-stats-in-status-bar` (design.md decision 1). It is owned by the
		// watching connections: armed on the first watch and cleared on the
		// last unwatch or close, so a server nobody watches samples nothing.
		this.timer = this.scheduleInterval(() => void this.tick(), wanted);
		if (this.previous === undefined) void this.tick();
	}

	private async tick(): Promise<void> {
		if (this.reading || this.timerIntervalMs === undefined) return;
		this.reading = true;
		const generation = this.generation;
		try {
			const counters = await this.reader.read();
			if (generation !== this.generation || this.timerIntervalMs === undefined) return;
			const current = { at: this.now(), counters };
			const previous = this.previous;
			this.previous = current;
			if (previous === undefined) return;
			const sample = hostStatsSample(previous, current);
			if (sample !== null)
				this.options.eventJournal?.publishTransient(
					HOST_STATS_EVENTS.sample,
					sample as unknown as JsonValue,
				);
		} catch (error) {
			this.options.onDiagnostic?.(
				`host stats read failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.reading = false;
		}
	}

	operations(): OperationRegistries {
		return {
			commands: {
				[HOST_STATS_OPERATIONS.watch]: (request: CommandRequest) => {
					const payload = request.envelope.payload;
					if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
						throw protocolError('validation', 'host stats watch payload is invalid');
					const intervalSeconds = this.watch(
						request.context.connectionId,
						(payload as { intervalSeconds?: unknown }).intervalSeconds,
					);
					return { result: { intervalSeconds } };
				},
				[HOST_STATS_OPERATIONS.unwatch]: (request: CommandRequest) => {
					this.unwatch(request.context.connectionId);
					return { result: { watching: false } };
				},
			},
			policies: {
				// Aggregate host figures name no project, process, file or address,
				// so any connection that may read this server may watch them.
				[HOST_STATS_OPERATIONS.watch]: { scope: 'read' },
				[HOST_STATS_OPERATIONS.unwatch]: { scope: 'read' },
			},
		};
	}
}
