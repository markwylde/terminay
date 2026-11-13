/**
 * What the status bar shows for the active server's host: a bounded run of
 * recent samples turned into one item per metric. Pure, so it is tested
 * without React or a server.
 */

import type { HostStatsSample } from '@terminay/protocol';
import { formatStatusBarFileSize } from './workspaceStatusBarModel.ts';

/** Samples kept for the graphs. At the default 5 s that is two and a half minutes. */
export const HOST_STATS_HISTORY = 30;

export type HostStatsMetric = 'cpu' | 'memory' | 'network' | 'disk';

export type HostStatsItem = {
	metric: HostStatsMetric;
	label: string;
	/** The current figure, or null until a sample has arrived. */
	figure: string | null;
	/** Tooltip and accessible name. */
	detail: string;
	/** Oldest first; one value per sample. */
	values: number[];
	/** The value the top of the graph stands for. */
	max: number;
};

const LABELS: Record<HostStatsMetric, string> = {
	cpu: 'CPU',
	memory: 'MEM',
	network: 'NET',
	disk: 'DISK',
};

const NAMES: Record<HostStatsMetric, string> = {
	cpu: 'CPU',
	memory: 'Memory',
	network: 'Network',
	disk: 'Disk I/O',
};

export function appendHostStatsSample(
	history: readonly HostStatsSample[],
	sample: HostStatsSample,
	limit = HOST_STATS_HISTORY,
): HostStatsSample[] {
	const next = [...history, sample];
	return next.length > limit ? next.slice(next.length - limit) : next;
}

export function formatHostStatsRate(bytesPerSecond: number): string {
	const rounded = Math.round(bytesPerSecond);
	return `${formatStatusBarFileSize(rounded)}/s`;
}

export function formatHostStatsPercent(percent: number): string {
	return `${Math.round(Math.min(100, Math.max(0, percent)))}%`;
}

function memoryPercent(memory: NonNullable<HostStatsSample['memory']>): number {
	return memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : 0;
}

function value(metric: HostStatsMetric, sample: HostStatsSample): number | null {
	switch (metric) {
		case 'cpu':
			return sample.cpu?.percent ?? null;
		case 'memory':
			return sample.memory === null ? null : memoryPercent(sample.memory);
		case 'network':
			return sample.network === null
				? null
				: sample.network.receivedBytesPerSecond + sample.network.sentBytesPerSecond;
		case 'disk':
			return sample.disk === null
				? null
				: sample.disk.readBytesPerSecond + sample.disk.writtenBytesPerSecond;
	}
}

function describe(metric: HostStatsMetric, sample: HostStatsSample): { figure: string; detail: string } | null {
	switch (metric) {
		case 'cpu': {
			const cpu = sample.cpu;
			if (cpu === null) return null;
			const figure = formatHostStatsPercent(cpu.percent);
			return {
				figure,
				detail: `CPU ${figure} of ${cpu.cores} ${cpu.cores === 1 ? 'core' : 'cores'}`,
			};
		}
		case 'memory': {
			const memory = sample.memory;
			if (memory === null) return null;
			const figure = formatHostStatsPercent(memoryPercent(memory));
			return {
				figure,
				detail: `Memory ${figure}: ${formatStatusBarFileSize(memory.usedBytes)} used of ${formatStatusBarFileSize(memory.totalBytes)}`,
			};
		}
		case 'network': {
			const network = sample.network;
			if (network === null) return null;
			return {
				figure: formatHostStatsRate(network.receivedBytesPerSecond + network.sentBytesPerSecond),
				detail: `Network: ${formatHostStatsRate(network.receivedBytesPerSecond)} received, ${formatHostStatsRate(network.sentBytesPerSecond)} sent`,
			};
		}
		case 'disk': {
			const disk = sample.disk;
			if (disk === null) return null;
			return {
				figure: formatHostStatsRate(disk.readBytesPerSecond + disk.writtenBytesPerSecond),
				detail: `Disk I/O: ${formatHostStatsRate(disk.readBytesPerSecond)} read, ${formatHostStatsRate(disk.writtenBytesPerSecond)} written`,
			};
		}
	}
}

const METRICS: readonly HostStatsMetric[] = ['cpu', 'memory', 'network', 'disk'];

/**
 * One item per metric the host reports, in a fixed order. Before the first
 * sample every metric is a placeholder; after it, a metric the latest sample
 * reports as unavailable is left out rather than shown as zero.
 */
export function hostStatsItems(history: readonly HostStatsSample[], hostLabel = 'Host'): HostStatsItem[] {
	const latest = history.at(-1);
	if (latest === undefined)
		return METRICS.map((metric) => ({
			metric,
			label: LABELS[metric],
			figure: null,
			detail: `${hostLabel} ${NAMES[metric]}: waiting for the first sample`,
			values: [],
			max: 100,
		}));
	const items: HostStatsItem[] = [];
	for (const metric of METRICS) {
		const described = describe(metric, latest);
		if (described === null) continue;
		const values = history
			.map((sample) => value(metric, sample))
			.filter((entry): entry is number => entry !== null);
		const isRate = metric === 'network' || metric === 'disk';
		items.push({
			metric,
			label: LABELS[metric],
			figure: described.figure,
			detail: `${hostLabel} ${described.detail}`,
			values,
			// Percentages keep a fixed scale; rates scale to the busiest moment
			// in view, with a floor so an idle link does not draw noise as peaks.
			max: isRate ? Math.max(1024, ...values) : 100,
		});
	}
	return items;
}

/** SVG polyline points for a graph of `width` × `height`, newest at the right. */
export function hostStatsSparklinePoints(
	values: readonly number[],
	max: number,
	width: number,
	height: number,
	slots = HOST_STATS_HISTORY,
): string {
	if (values.length === 0 || max <= 0) return '';
	const step = slots > 1 ? width / (slots - 1) : width;
	const start = width - step * (values.length - 1);
	return values
		.map((entry, index) => {
			const ratio = Math.min(1, Math.max(0, entry / max));
			const x = Math.max(0, start + step * index);
			const y = height - ratio * (height - 1) - 0.5;
			return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`;
		})
		.join(' ');
}
