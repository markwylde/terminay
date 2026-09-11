/** Per-terminal resource sampling for terminals backed by the embedded Local
 * server.
 *
 * It reads the shell pid the in-process authority already reports and walks
 * that pid's descendants with the platform's own process table. A session with
 * no readable process tree reports an unavailable outcome rather than
 * measuring a substituted process.
 *
 * Nothing here reads a title, command line, argument, working directory, or
 * environment value: the readers request only pid, parent pid, CPU and memory,
 * and (Linux only) the kernel's cumulative disk byte counters. */

import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

/** One tick has a single deadline across every session. */
export const TERMINAL_RESOURCE_DEADLINE_MS = 750;

export interface ProcessTableEntry {
	readonly pid: number;
	readonly ppid: number;
	/** Percent of one CPU. See the reader notes for per-platform semantics. */
	readonly cpuPercent: number;
	readonly rssBytes: number;
	/** Cumulative since process start. Absent where the platform has no
	 * per-process counter. */
	readonly diskReadBytes?: number;
	readonly diskWriteBytes?: number;
}

export interface ProcessTableReader {
	/** False on platforms with no per-process disk byte counter. */
	readonly diskAvailable: boolean;
	read(signal: AbortSignal): Promise<ReadonlyMap<number, ProcessTableEntry>>;
}

export type TerminalResourceUnavailableReason =
	/** The session is not running, so there is nothing to measure. */
	| 'not-running'
	/** A local pid exists but its process tree could not be read this tick. */
	| 'unreadable';

export interface TerminalResourceUsage {
	readonly available: true;
	readonly cpuPercent: number;
	readonly rssBytes: number;
	/** Bytes per second since the previous sample; absent on the first sample
	 * and on platforms without per-process counters. */
	readonly diskReadBytesPerSecond?: number;
	readonly diskWriteBytesPerSecond?: number;
	/** How many processes in the shell's tree were measured. */
	readonly processCount: number;
}

export interface TerminalResourceUnavailable {
	readonly available: false;
	readonly reason: TerminalResourceUnavailableReason;
}

export type TerminalResourceOutcome =
	| TerminalResourceUsage
	| TerminalResourceUnavailable;

export interface TerminalResourceSnapshot {
	readonly at: number;
	/** False on platforms with no per-process disk counter, so the window can
	 * say so once instead of showing an empty column per row. */
	readonly diskAvailable: boolean;
	readonly sessions: Readonly<Record<string, TerminalResourceOutcome>>;
}

/** The subset of a session snapshot this sampler needs. */
export interface SampledTerminalSession {
	readonly sessionId: string;
	readonly status: string;
	readonly pid?: number;
}

function parseProcessTable(text: string): Map<number, ProcessTableEntry> {
	const table = new Map<number, ProcessTableEntry>();
	for (const line of text.split('\n')) {
		const fields = line.trim().split(/\s+/u);
		if (fields.length < 4) continue;
		const pid = Number(fields[0]);
		const ppid = Number(fields[1]);
		const cpuPercent = Number(fields[2]);
		const rssKiB = Number(fields[3]);
		if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
		table.set(pid, {
			pid,
			ppid,
			cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : 0,
			rssBytes: Number.isFinite(rssKiB) ? rssKiB * 1024 : 0,
		});
	}
	return table;
}

/** macOS: one `ps` for the whole table. `%cpu` is the OS's own decayed recent
 * average, which is what Activity Monitor shows. There is no per-process disk
 * byte counter without native code, so disk is reported unavailable. */
export function createDarwinProcessTableReader(): ProcessTableReader {
	return {
		diskAvailable: false,
		read: (signal) =>
			new Promise((resolve, reject) => {
				execFile(
					'/bin/ps',
					['-Ao', 'pid=,ppid=,pcpu=,rss='],
					{ signal, maxBuffer: 4 * 1024 * 1024 },
					(error, stdout) => {
						if (error) reject(error);
						else resolve(parseProcessTable(stdout));
					},
				);
			}),
	};
}

interface LinuxCpuTimes {
	readonly at: number;
	readonly ticksByPid: ReadonlyMap<number, number>;
}

/** Linux: read /proc directly. CPU is a true instantaneous percentage derived
 * from the change in cumulative CPU ticks between two reads. */
export function createLinuxProcessTableReader(
	options: {
		readonly procRoot?: string;
		readonly clockTicksPerSecond?: number;
		readonly now?: () => number;
	} = {},
): ProcessTableReader {
	const procRoot = options.procRoot ?? '/proc';
	const ticksPerSecond = options.clockTicksPerSecond ?? 100;
	const now = options.now ?? (() => Date.now());
	const pageSize = 4096;
	let previous: LinuxCpuTimes | undefined;

	return {
		diskAvailable: true,
		async read(signal) {
			const entries = await readdir(procRoot);
			const at = now();
			const table = new Map<number, ProcessTableEntry>();
			const ticksByPid = new Map<number, number>();
			const elapsedSeconds =
				previous === undefined ? 0 : Math.max(0, (at - previous.at) / 1000);

			for (const entry of entries) {
				if (signal.aborted) break;
				if (!/^\d+$/u.test(entry)) continue;
				const pid = Number(entry);
				let stat: string;
				try {
					stat = await readFile(`${procRoot}/${pid}/stat`, 'utf8');
				} catch {
					continue;
				}
				// The comm field is parenthesised and may contain spaces; everything
				// after the final ')' is positional. comm itself is never retained.
				const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
				const ppid = Number(tail[1]);
				const utime = Number(tail[11]);
				const stime = Number(tail[12]);
				const rssPages = Number(tail[21]);
				if (!Number.isInteger(ppid)) continue;
				const ticks =
					(Number.isFinite(utime) ? utime : 0) +
					(Number.isFinite(stime) ? stime : 0);
				ticksByPid.set(pid, ticks);
				const previousTicks = previous?.ticksByPid.get(pid);
				const cpuPercent =
					previousTicks === undefined || elapsedSeconds <= 0
						? 0
						: Math.max(
								0,
								((ticks - previousTicks) / ticksPerSecond / elapsedSeconds) *
									100,
							);

				let diskReadBytes: number | undefined;
				let diskWriteBytes: number | undefined;
				try {
					const io = await readFile(`${procRoot}/${pid}/io`, 'utf8');
					diskReadBytes = Number(/^read_bytes:\s*(\d+)/mu.exec(io)?.[1]);
					diskWriteBytes = Number(/^write_bytes:\s*(\d+)/mu.exec(io)?.[1]);
					if (!Number.isFinite(diskReadBytes)) diskReadBytes = undefined;
					if (!Number.isFinite(diskWriteBytes)) diskWriteBytes = undefined;
				} catch {
					// /proc/<pid>/io is permission-gated; absence is not a failure.
				}

				table.set(pid, {
					pid,
					ppid,
					cpuPercent,
					rssBytes: Number.isFinite(rssPages) ? rssPages * pageSize : 0,
					...(diskReadBytes === undefined ? {} : { diskReadBytes }),
					...(diskWriteBytes === undefined ? {} : { diskWriteBytes }),
				});
			}
			previous = { at, ticksByPid };
			return table;
		},
	};
}

export function createProcessTableReader(
	platform: NodeJS.Platform = process.platform,
): ProcessTableReader | undefined {
	if (platform === 'darwin') return createDarwinProcessTableReader();
	if (platform === 'linux') return createLinuxProcessTableReader();
	return undefined;
}

/** Collect a pid and all of its descendants from a parent-pid index. */
function descendantsOf(
	root: number,
	table: ReadonlyMap<number, ProcessTableEntry>,
): ProcessTableEntry[] {
	const childrenByParent = new Map<number, number[]>();
	for (const entry of table.values()) {
		const siblings = childrenByParent.get(entry.ppid);
		if (siblings === undefined) childrenByParent.set(entry.ppid, [entry.pid]);
		else siblings.push(entry.pid);
	}
	const collected: ProcessTableEntry[] = [];
	const seen = new Set<number>();
	const pending = [root];
	while (pending.length > 0) {
		const pid = pending.pop();
		if (pid === undefined || seen.has(pid)) continue;
		seen.add(pid);
		const entry = table.get(pid);
		if (entry === undefined) continue;
		collected.push(entry);
		for (const child of childrenByParent.get(pid) ?? []) pending.push(child);
	}
	return collected;
}

export interface TerminalResourceSamplerOptions {
	readonly reader?: ProcessTableReader;
	readonly now?: () => number;
	readonly deadlineMs?: number;
}

interface PreviousDisk {
	readonly at: number;
	readonly readBytes: number;
	readonly writeBytes: number;
}

export class TerminalResourceSampler {
	private readonly reader: ProcessTableReader | undefined;
	private readonly now: () => number;
	private readonly deadlineMs: number;
	private readonly previousDisk = new Map<string, PreviousDisk>();

	constructor(options: TerminalResourceSamplerOptions = {}) {
		this.reader =
			options.reader === undefined
				? createProcessTableReader()
				: options.reader;
		this.now = options.now ?? (() => Date.now());
		this.deadlineMs = options.deadlineMs ?? TERMINAL_RESOURCE_DEADLINE_MS;
	}

	get diskAvailable(): boolean {
		return this.reader?.diskAvailable ?? false;
	}

	async sample(
		sessions: readonly SampledTerminalSession[],
	): Promise<TerminalResourceSnapshot> {
		const at = this.now();
		const outcomes: Record<string, TerminalResourceOutcome> = {};
		const live = new Set<string>();

		let table: ReadonlyMap<number, ProcessTableEntry> | undefined;
		if (this.reader !== undefined) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.deadlineMs);
			timer.unref?.();
			try {
				table = await this.reader.read(controller.signal);
			} catch {
				// One deadline covers every session: an unread table means every
				// session with a pid reports unreadable, never a stale value.
				table = undefined;
			} finally {
				clearTimeout(timer);
			}
		}

		for (const session of sessions) {
			live.add(session.sessionId);
			if (session.status !== 'running') {
				outcomes[session.sessionId] = {
					available: false,
					reason: 'not-running',
				};
				continue;
			}
			if (
				session.pid === undefined ||
				table === undefined ||
				!table.has(session.pid)
			) {
				outcomes[session.sessionId] = {
					available: false,
					reason: 'unreadable',
				};
				continue;
			}
			outcomes[session.sessionId] = this.usageFor(
				session.sessionId,
				session.pid,
				table,
				at,
			);
		}

		for (const sessionId of [...this.previousDisk.keys()])
			if (!live.has(sessionId)) this.previousDisk.delete(sessionId);

		return Object.freeze({
			at,
			diskAvailable: this.diskAvailable,
			sessions: Object.freeze(outcomes),
		});
	}

	private usageFor(
		sessionId: string,
		pid: number,
		table: ReadonlyMap<number, ProcessTableEntry>,
		at: number,
	): TerminalResourceUsage {
		const tree = descendantsOf(pid, table);
		let cpuPercent = 0;
		let rssBytes = 0;
		let readBytes = 0;
		let writeBytes = 0;
		let sawDisk = false;
		for (const entry of tree) {
			cpuPercent += entry.cpuPercent;
			rssBytes += entry.rssBytes;
			if (entry.diskReadBytes !== undefined) {
				readBytes += entry.diskReadBytes;
				sawDisk = true;
			}
			if (entry.diskWriteBytes !== undefined) {
				writeBytes += entry.diskWriteBytes;
				sawDisk = true;
			}
		}

		let diskReadBytesPerSecond: number | undefined;
		let diskWriteBytesPerSecond: number | undefined;
		if (sawDisk) {
			const previous = this.previousDisk.get(sessionId);
			const elapsedSeconds =
				previous === undefined ? 0 : Math.max(0, (at - previous.at) / 1000);
			if (previous !== undefined && elapsedSeconds > 0) {
				diskReadBytesPerSecond = Math.max(
					0,
					(readBytes - previous.readBytes) / elapsedSeconds,
				);
				diskWriteBytesPerSecond = Math.max(
					0,
					(writeBytes - previous.writeBytes) / elapsedSeconds,
				);
			}
			this.previousDisk.set(sessionId, { at, readBytes, writeBytes });
		}

		return Object.freeze({
			available: true,
			cpuPercent: Math.round(cpuPercent * 100) / 100,
			rssBytes,
			processCount: tree.length,
			...(diskReadBytesPerSecond === undefined
				? {}
				: { diskReadBytesPerSecond: Math.round(diskReadBytesPerSecond) }),
			...(diskWriteBytesPerSecond === undefined
				? {}
				: { diskWriteBytesPerSecond: Math.round(diskWriteBytesPerSecond) }),
		});
	}
}
