import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import {
	type CpuTimes,
	type DiskTotals,
	type MemoryReading,
	type NetworkTotals,
	parseDarwinIoreg,
	parseDarwinNetstat,
	parseDarwinSysctlMemory,
	parseLinuxDiskstats,
	parseLinuxMeminfo,
	parseLinuxNetDev,
	sumCpuTimes,
} from './parsers.js';

/** Cumulative counters read at one moment. A source that failed is null. */
export type HostCounters = {
	readonly cpu: CpuTimes | null;
	readonly memory: MemoryReading | null;
	readonly network: NetworkTotals | null;
	readonly disk: DiskTotals | null;
};

export interface HostCounterReader {
	/** Read every counter once. An aborted read stops any work it started. */
	read(signal?: AbortSignal): Promise<HostCounters>;
}

const SOURCE_TIMEOUT_MS = 2_000;

function cpu(): CpuTimes | null {
	try {
		return sumCpuTimes(os.cpus());
	} catch {
		return null;
	}
}

async function text(path: string): Promise<string | null> {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return null;
	}
}

/**
 * Linux reads only files, so a sample spawns nothing. Network counts the
 * physical interfaces (those not under `/sys/devices/virtual/net`) so traffic
 * that also crosses a bridge, tunnel or container interface counts once; a
 * host with none, such as a container, counts everything but loopback.
 */
export function createLinuxHostCounterReader(procRoot = '/proc', sysRoot = '/sys'): HostCounterReader {
	// Read on every sample: a bridge or veth created while stats are shown
	// must not be mistaken for a physical interface. It is a directory read,
	// never a spawn.
	const virtualInterfaces = (): Promise<ReadonlySet<string> | null> =>
		readdir(`${sysRoot}/devices/virtual/net`)
			.then((names) => new Set(names))
			.catch(() => null);
	return {
		async read() {
			const [meminfo, netdev, diskstats, virtualNames] = await Promise.all([
				text(`${procRoot}/meminfo`),
				text(`${procRoot}/net/dev`),
				text(`${procRoot}/diskstats`),
				virtualInterfaces(),
			]);
			let network: NetworkTotals | null = null;
			if (netdev !== null) {
				const physical =
					virtualNames === null
						? undefined
						: (name: string) => name !== 'lo' && !virtualNames.has(name);
				const hasPhysical =
					physical !== undefined &&
					netdev.split('\n').some((line) => {
						const colon = line.indexOf(':');
						return colon > 0 && physical(line.slice(0, colon).trim());
					});
				network = parseLinuxNetDev(netdev, hasPhysical ? physical : undefined);
			}
			return {
				cpu: cpu(),
				memory: meminfo === null ? null : parseLinuxMeminfo(meminfo),
				network,
				disk: diskstats === null ? null : parseLinuxDiskstats(diskstats),
			};
		},
	};
}

const DARWIN_MARKER = '@@terminay-host-stats@@';
const DARWIN_SCRIPT = [
	'/usr/sbin/sysctl -n hw.pagesize vm.page_free_count vm.page_speculative_count vm.page_purgeable_count vm.page_pageable_external_count',
	`echo ${DARWIN_MARKER}`,
	'/usr/sbin/netstat -ibn',
	`echo ${DARWIN_MARKER}`,
	'/usr/sbin/ioreg -r -c IOBlockStorageDriver -w 0',
].join('; ');

/**
 * macOS has no file source for these counters, and Node's `os.freemem()`
 * counts only free pages, so each sample runs one shell that prints all
 * three sources (design decision 3).
 */
export function createDarwinHostCounterReader(): HostCounterReader {
	return {
		read: (signal) =>
			new Promise<HostCounters>((resolve) => {
				// Aborting kills the shell, so a read whose watchers have all left
				// starts none of the tools still to come.
				execFile(
					'/bin/sh',
					['-c', DARWIN_SCRIPT],
					{
						timeout: SOURCE_TIMEOUT_MS,
						maxBuffer: 4 * 1024 * 1024,
						...(signal === undefined ? {} : { signal }),
					},
					(_error, stdout) => {
						// A tool that failed leaves its own section empty; the others stand.
						const [sysctl = '', netstat = '', ioreg = ''] = String(stdout ?? '').split(
							`${DARWIN_MARKER}\n`,
						);
						resolve({
							cpu: cpu(),
							memory: parseDarwinSysctlMemory(sysctl, os.totalmem()),
							network: parseDarwinNetstat(netstat),
							disk: parseDarwinIoreg(ioreg),
						});
					},
				);
			}),
	};
}

/** Windows, and anything else: CPU and memory from Node, no network or disk. */
export function createPortableHostCounterReader(): HostCounterReader {
	return {
		async read() {
			const totalBytes = os.totalmem();
			return {
				cpu: cpu(),
				memory:
					totalBytes > 0
						? { totalBytes, usedBytes: Math.max(0, totalBytes - os.freemem()) }
						: null,
				network: null,
				disk: null,
			};
		},
	};
}

export function createHostCounterReader(platform: NodeJS.Platform = process.platform): HostCounterReader {
	if (platform === 'linux') return createLinuxHostCounterReader();
	if (platform === 'darwin') return createDarwinHostCounterReader();
	return createPortableHostCounterReader();
}
