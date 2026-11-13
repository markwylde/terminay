/**
 * Host stats (the `host-stats.v1` capability).
 *
 * A client that shows host stats watches with the interval it wants; the
 * server samples its own host's CPU, memory, network and disk counters at the
 * shortest interval any watcher asked for, only while someone is watching,
 * and publishes each sample as a transient event. A sample is aggregate host
 * data only: no process, user, file, interface, disk or address is named.
 */

export const HOST_STATS_CAPABILITY = 'host-stats.v1' as const;

export const HOST_STATS_OPERATIONS = Object.freeze({
	watch: 'host-stats.watch',
	unwatch: 'host-stats.unwatch',
} as const);

export const HOST_STATS_EVENTS = Object.freeze({
	sample: 'host-stats.sample',
} as const);

/** The interval a watcher may ask for, in whole seconds. */
export const HOST_STATS_MIN_INTERVAL_SECONDS = 1;
export const HOST_STATS_MAX_INTERVAL_SECONDS = 3600;
export const HOST_STATS_DEFAULT_INTERVAL_SECONDS = 5;

export type HostStatsCpu = {
	/** Busy time across all cores, 0–100. */
	readonly percent: number;
	readonly cores: number;
};

export type HostStatsMemory = {
	readonly usedBytes: number;
	readonly totalBytes: number;
};

export type HostStatsNetwork = {
	readonly receivedBytesPerSecond: number;
	readonly sentBytesPerSecond: number;
};

export type HostStatsDisk = {
	readonly readBytesPerSecond: number;
	readonly writtenBytesPerSecond: number;
};

/** One sample. A metric the host cannot report is null. */
export type HostStatsSample = {
	/** Milliseconds since the epoch on the server's clock. */
	readonly at: number;
	readonly intervalMs: number;
	readonly cpu: HostStatsCpu | null;
	readonly memory: HostStatsMemory | null;
	readonly network: HostStatsNetwork | null;
	readonly disk: HostStatsDisk | null;
};

/** Whole seconds within the allowed range; anything unreadable is the default. */
export function clampHostStatsIntervalSeconds(value: unknown): number {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) return HOST_STATS_DEFAULT_INTERVAL_SECONDS;
	return Math.min(
		HOST_STATS_MAX_INTERVAL_SECONDS,
		Math.max(HOST_STATS_MIN_INTERVAL_SECONDS, Math.round(number)),
	);
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function object(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

/** Read a sample from an event payload; anything malformed is null. */
export function parseHostStatsSample(value: unknown): HostStatsSample | null {
	const input = object(value);
	if (input === null || !finiteNonNegative(input.at) || !finiteNonNegative(input.intervalMs))
		return null;
	const cpu = object(input.cpu);
	const memory = object(input.memory);
	const network = object(input.network);
	const disk = object(input.disk);
	return {
		at: input.at,
		intervalMs: input.intervalMs,
		cpu:
			cpu !== null && finiteNonNegative(cpu.percent) && finiteNonNegative(cpu.cores)
				? { percent: Math.min(100, cpu.percent), cores: cpu.cores }
				: null,
		memory:
			memory !== null &&
			finiteNonNegative(memory.usedBytes) &&
			finiteNonNegative(memory.totalBytes) &&
			memory.totalBytes > 0
				? {
						usedBytes: Math.min(memory.usedBytes, memory.totalBytes),
						totalBytes: memory.totalBytes,
					}
				: null,
		network:
			network !== null &&
			finiteNonNegative(network.receivedBytesPerSecond) &&
			finiteNonNegative(network.sentBytesPerSecond)
				? {
						receivedBytesPerSecond: network.receivedBytesPerSecond,
						sentBytesPerSecond: network.sentBytesPerSecond,
					}
				: null,
		disk:
			disk !== null &&
			finiteNonNegative(disk.readBytesPerSecond) &&
			finiteNonNegative(disk.writtenBytesPerSecond)
				? {
						readBytesPerSecond: disk.readBytesPerSecond,
						writtenBytesPerSecond: disk.writtenBytesPerSecond,
					}
				: null,
	};
}
