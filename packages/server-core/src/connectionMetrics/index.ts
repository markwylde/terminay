import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	CONNECTION_METRIC_DURATIONS,
	CONNECTION_METRIC_KINDS,
	CONNECTION_METRIC_TRIGGERS,
	CONNECTION_METRICS_OPERATIONS,
	type ConnectionMetricBreakdown,
	type ConnectionMetricDuration,
	type ConnectionMetricKind,
	type ConnectionMetricStats,
	type ConnectionMetricsSummary,
	type ConnectionMetricTrigger,
	type JsonValue,
	normalizeConnectionMetricSample,
	protocolError,
	type StoredConnectionMetricSample,
} from '@terminay/protocol';
import { writeFileDurably } from '../durableFile.js';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
} from '../types.js';

/**
 * Connection timing samples, behind the Record connection timings setting.
 *
 * Clients send one metadata-only sample per connect, recovery, or answered
 * resume probe. This service keeps the newest samples in one JSON-lines file
 * in the data root and summarises them. The file is rebuildable diagnostics:
 * a corrupt line is skipped, and nothing else depends on it.
 */

export const CONNECTION_METRICS_FILE = 'connection-metrics.v1.jsonl';
export const CONNECTION_METRICS_MAX_SAMPLES = 2_000;
export const CONNECTION_METRICS_COMPACT_AT = 2_500;
export const CONNECTION_METRICS_RECENT = 20;

export interface ConnectionMetricsServiceOptions {
	/** Where samples are kept. Absent, they live in memory only. */
	readonly file?: string;
	/** Whether recording is on, read on every sample. */
	readonly enabled: () => boolean;
	readonly now?: () => number;
	readonly maxSamples?: number;
	readonly compactAt?: number;
}

export class ConnectionMetricsService {
	private readonly options: ConnectionMetricsServiceOptions;
	private readonly now: () => number;
	private readonly maxSamples: number;
	private readonly compactAt: number;
	private samples: StoredConnectionMetricSample[] | undefined;
	/** Lines in the file, including the ones a load skipped. */
	private lines = 0;
	private writes: Promise<void> = Promise.resolve();

	constructor(options: ConnectionMetricsServiceOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		this.maxSamples = options.maxSamples ?? CONNECTION_METRICS_MAX_SAMPLES;
		this.compactAt = Math.max(
			this.maxSamples,
			options.compactAt ?? CONNECTION_METRICS_COMPACT_AT,
		);
	}

	/** Store one untrusted sample. False when recording is off or it is invalid. */
	record(input: unknown): boolean {
		if (!this.options.enabled()) return false;
		const sample = normalizeConnectionMetricSample(input);
		if (sample === undefined) return false;
		const stored = Object.freeze({
			...sample,
			at: Math.round(this.now()),
		}) as StoredConnectionMetricSample;
		const samples = this.load();
		samples.push(stored);
		this.lines += 1;
		if (samples.length > this.maxSamples * 2)
			samples.splice(0, samples.length - this.maxSamples);
		const compact = this.lines > this.compactAt;
		this.enqueue(async (file) => {
			if (compact) await this.rewrite(file);
			else await fsp.appendFile(file, `${JSON.stringify(stored)}\n`, 'utf8');
		});
		return true;
	}

	clear(): void {
		this.samples = [];
		this.lines = 0;
		this.enqueue((file) => fsp.rm(file, { force: true }));
	}

	summary(): ConnectionMetricsSummary {
		const samples = this.load().slice(-this.maxSamples);
		const byTrigger: Partial<Record<ConnectionMetricTrigger, ConnectionMetricBreakdown>> =
			{};
		for (const trigger of CONNECTION_METRIC_TRIGGERS) {
			const matching = samples.filter((sample) => sample.trigger === trigger);
			if (matching.length > 0) byTrigger[trigger] = breakdown(matching);
		}
		const byKind: Partial<Record<ConnectionMetricKind, number>> = {};
		for (const kind of CONNECTION_METRIC_KINDS) {
			const count = samples.filter((sample) => sample.kind === kind).length;
			if (count > 0) byKind[kind] = count;
		}
		const first = samples[0];
		const last = samples.at(-1);
		return {
			enabled: this.options.enabled(),
			count: samples.length,
			...(first === undefined ? {} : { since: first.at }),
			...(last === undefined ? {} : { until: last.at }),
			overall: breakdown(samples),
			byTrigger,
			byKind,
			recent: samples.slice(-CONNECTION_METRICS_RECENT).reverse(),
		};
	}

	/** Resolves once every queued write has reached the file. */
	flush(): Promise<void> {
		return this.writes;
	}

	operations(): OperationRegistries {
		return {
			queries: {
				[CONNECTION_METRICS_OPERATIONS.summary]: (_request: QueryRequest) =>
					this.summary() as unknown as JsonValue,
			},
			commands: {
				[CONNECTION_METRICS_OPERATIONS.record]: (request: CommandRequest) => {
					const payload = request.envelope.payload;
					if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
						throw protocolError('validation', 'connection metrics payload is invalid');
					const recorded = this.record((payload as { sample?: unknown }).sample);
					return { result: { recorded } };
				},
				[CONNECTION_METRICS_OPERATIONS.clear]: (_request: CommandRequest) => {
					this.clear();
					return { result: { cleared: true } };
				},
			},
			policies: {
				// Every client connects, so every authenticated connection may
				// report how its own connect went. The payload is untrusted and
				// validated field by field.
				[CONNECTION_METRICS_OPERATIONS.record]: { scope: 'read' },
				[CONNECTION_METRICS_OPERATIONS.summary]: { scope: 'read' },
				[CONNECTION_METRICS_OPERATIONS.clear]: { scope: 'write' },
			},
		};
	}

	private load(): StoredConnectionMetricSample[] {
		if (this.samples !== undefined) return this.samples;
		const samples: StoredConnectionMetricSample[] = [];
		let lines = 0;
		const file = this.options.file;
		if (file !== undefined) {
			let text = '';
			try {
				text = fs.readFileSync(file, 'utf8');
			} catch {
				// No file yet, or unreadable: start empty.
			}
			for (const line of text.split('\n')) {
				if (line.trim().length === 0) continue;
				lines += 1;
				const stored = parseStored(line);
				if (stored !== undefined) samples.push(stored);
			}
		}
		this.samples = samples.slice(-this.maxSamples);
		this.lines = lines;
		return this.samples;
	}

	private async rewrite(file: string): Promise<void> {
		const samples = this.load();
		if (samples.length > this.maxSamples)
			samples.splice(0, samples.length - this.maxSamples);
		const text = samples.map((sample) => JSON.stringify(sample)).join('\n');
		await writeFileDurably(file, text.length === 0 ? '' : `${text}\n`, {
			mode: 0o600,
		});
		this.lines = samples.length;
	}

	private enqueue(write: (file: string) => Promise<void>): void {
		const file = this.options.file;
		if (file === undefined) return;
		this.writes = this.writes
			.then(async () => {
				await fsp.mkdir(dirname(file), { recursive: true });
				await write(file);
			})
			.catch(() => undefined);
	}
}

function parseStored(line: string): StoredConnectionMetricSample | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (typeof value !== 'object' || value === null) return undefined;
	const at = (value as { at?: unknown }).at;
	if (typeof at !== 'number' || !Number.isFinite(at)) return undefined;
	const sample = normalizeConnectionMetricSample(value);
	if (sample === undefined) return undefined;
	return Object.freeze({ ...sample, at: Math.round(at) }) as StoredConnectionMetricSample;
}

function breakdown(
	samples: readonly StoredConnectionMetricSample[],
): ConnectionMetricBreakdown {
	const durations: Partial<Record<ConnectionMetricDuration, ConnectionMetricStats>> = {};
	for (const key of CONNECTION_METRIC_DURATIONS) {
		const values = samples
			.map((sample) => sample[key])
			.filter((value): value is number => typeof value === 'number');
		if (values.length > 0) durations[key] = stats(values);
	}
	return {
		count: samples.length,
		durations,
		retried: samples.filter((sample) => (sample.attempts ?? 1) > 1).length,
	};
}

/** Nearest-rank percentiles over integer milliseconds. */
export function stats(values: readonly number[]): ConnectionMetricStats {
	const sorted = [...values].sort((left, right) => left - right);
	const rank = (fraction: number) =>
		sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))] ?? 0;
	const sum = sorted.reduce((total, value) => total + value, 0);
	return {
		count: sorted.length,
		mean: Math.round(sum / sorted.length),
		p50: rank(0.5),
		p95: rank(0.95),
		max: sorted.at(-1) ?? 0,
	};
}

/** Read the Record connection timings switch from the server settings object. */
export function connectionMetricsEnabledFrom(settings: unknown): boolean {
	if (typeof settings !== 'object' || settings === null) return false;
	const remote = (settings as { remoteAccess?: unknown }).remoteAccess;
	return (
		typeof remote === 'object' &&
		remote !== null &&
		(remote as { connectionMetrics?: unknown }).connectionMetrics === true
	);
}
