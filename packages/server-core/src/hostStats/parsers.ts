/**
 * Pure parsers for the host counter sources the host stats sampler reads.
 * Each returns null when its input cannot be understood, so a source that
 * changes shape degrades to an unavailable metric, never a wrong figure.
 */

export type NetworkTotals = { readonly receivedBytes: number; readonly sentBytes: number };
export type DiskTotals = { readonly readBytes: number; readonly writtenBytes: number };
export type MemoryReading = { readonly usedBytes: number; readonly totalBytes: number };

function whole(value: string | undefined): number | null {
	if (value === undefined || !/^\d+$/u.test(value)) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) ? number : null;
}

/** `/proc/meminfo`: used is total less what the kernel says is available. */
export function parseLinuxMeminfo(text: string): MemoryReading | null {
	const kib = (key: string) => {
		const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'mu').exec(text);
		return match === null ? null : whole(match[1]);
	};
	const total = kib('MemTotal');
	const available = kib('MemAvailable');
	if (total === null || available === null || total === 0) return null;
	return {
		totalBytes: total * 1024,
		usedBytes: Math.max(0, total - available) * 1024,
	};
}

/**
 * `/proc/net/dev`, summed over `include`d interfaces. When `include` is
 * undefined, every interface except loopback counts.
 */
export function parseLinuxNetDev(
	text: string,
	include?: (name: string) => boolean,
): NetworkTotals | null {
	let receivedBytes = 0;
	let sentBytes = 0;
	let rows = 0;
	for (const line of text.split('\n')) {
		const colon = line.indexOf(':');
		if (colon < 0) continue;
		const name = line.slice(0, colon).trim();
		if (name === '' || name.includes('|')) continue;
		const fields = line.slice(colon + 1).trim().split(/\s+/u);
		const received = whole(fields[0]);
		const sent = whole(fields[8]);
		if (received === null || sent === null) continue;
		rows += 1;
		if (include === undefined ? name === 'lo' : !include(name)) continue;
		receivedBytes += received;
		sentBytes += sent;
	}
	return rows === 0 ? null : { receivedBytes, sentBytes };
}

/** Devices layered over a disk, or not disks at all. */
const LINUX_NON_DISK = /^(loop|ram|zram|dm-|md|sr|fd|nbd)/u;

/**
 * `/proc/diskstats`, summed over whole disks. A partition is a device whose
 * name extends another listed device's name by digits, optionally after `p`
 * (`sda1`, `nvme0n1p2`, `mmcblk0p1`). Sectors are always 512 bytes here.
 */
export function parseLinuxDiskstats(text: string): DiskTotals | null {
	const devices: Array<{ name: string; read: number; written: number }> = [];
	for (const line of text.split('\n')) {
		const fields = line.trim().split(/\s+/u);
		if (fields.length < 10) continue;
		const name = fields[2];
		const read = whole(fields[5]);
		const written = whole(fields[9]);
		if (name === undefined || read === null || written === null) continue;
		devices.push({ name, read, written });
	}
	if (devices.length === 0) return null;
	const names = new Set(devices.map((device) => device.name));
	const isPartition = (name: string) => {
		const match = /^(.*?)(p?)(\d+)$/u.exec(name);
		if (match === null) return false;
		const base = match[1] ?? '';
		return (
			(names.has(base) && base !== name) ||
			(match[2] === 'p' && names.has(base))
		);
	};
	let readBytes = 0;
	let writtenBytes = 0;
	for (const device of devices) {
		if (LINUX_NON_DISK.test(device.name) || isPartition(device.name)) continue;
		readBytes += device.read * 512;
		writtenBytes += device.written * 512;
	}
	return { readBytes, writtenBytes };
}

/**
 * The output of `sysctl -n hw.pagesize vm.page_free_count
 * vm.page_speculative_count vm.page_purgeable_count
 * vm.page_pageable_external_count`, one value per line, with the host's
 * total memory. Free, speculative, purgeable and file-backed pages are what
 * macOS can hand out without paging anything to disk; the rest is in use.
 */
export function parseDarwinSysctlMemory(text: string, totalBytes: number): MemoryReading | null {
	const values = text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map(whole);
	if (values.length !== 5 || values.some((value) => value === null) || totalBytes <= 0)
		return null;
	const [pageSize = 0, free = 0, speculative = 0, purgeable = 0, external = 0] = values as number[];
	const availableBytes = (free + speculative + purgeable + external) * pageSize;
	return {
		totalBytes,
		usedBytes: Math.min(totalBytes, Math.max(0, totalBytes - availableBytes)),
	};
}

/**
 * `netstat -ibn`: one `<Link#n>` row per interface carries its byte totals in
 * the fifth- and second-last columns (`Ibytes … Obytes Coll`). The address
 * column may be empty, so columns are counted from the right.
 */
export function parseDarwinNetstat(text: string): NetworkTotals | null {
	let receivedBytes = 0;
	let sentBytes = 0;
	let rows = 0;
	const lines = text.split('\n');
	if (!/\bIbytes\b/u.test(lines[0] ?? '')) return null;
	for (const line of lines.slice(1)) {
		const fields = line.trim().split(/\s+/u);
		if (fields.length < 9 || !fields[2]?.startsWith('<Link#')) continue;
		const received = whole(fields[fields.length - 5]);
		const sent = whole(fields[fields.length - 2]);
		if (received === null || sent === null) continue;
		rows += 1;
		const name = fields[0]?.replace(/\*$/u, '') ?? '';
		if (name.startsWith('lo')) continue;
		receivedBytes += received;
		sentBytes += sent;
	}
	return rows === 0 ? null : { receivedBytes, sentBytes };
}

/** `ioreg -r -c IOBlockStorageDriver -w 0`: each driver is one whole disk. */
export function parseDarwinIoreg(text: string): DiskTotals | null {
	const sum = (pattern: RegExp) => {
		let total = 0;
		let found = 0;
		for (const match of text.matchAll(pattern)) {
			const value = whole(match[1]);
			if (value === null) continue;
			total += value;
			found += 1;
		}
		return found === 0 ? null : total;
	};
	const readBytes = sum(/"Bytes \(Read\)"=(\d+)/gu);
	const writtenBytes = sum(/"Bytes \(Write\)"=(\d+)/gu);
	if (readBytes === null || writtenBytes === null) return null;
	return { readBytes, writtenBytes };
}

export type CpuTimes = { readonly busy: number; readonly total: number; readonly cores: number };

/** Busy and total time over every core, from `os.cpus()`. */
export function sumCpuTimes(
	cpus: ReadonlyArray<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>,
): CpuTimes | null {
	if (cpus.length === 0) return null;
	let busy = 0;
	let total = 0;
	for (const { times } of cpus) {
		const used = times.user + times.nice + times.sys + times.irq;
		busy += used;
		total += used + times.idle;
	}
	return { busy, total, cores: cpus.length };
}
