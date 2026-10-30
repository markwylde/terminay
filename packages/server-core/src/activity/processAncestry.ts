import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** The most parent hops read for one process. */
export const MAX_ANCESTRY_HOPS = 64;

/** Reads one process's parent pid, or `undefined` when it has none or is gone. */
export type ParentPidReader = (pid: number) => Promise<number | undefined>;

/**
 * Reads one process's controlling terminal: a device name or number, `null`
 * when it has none, or `undefined` when it cannot be read.
 */
export type ControllingTerminalReader = (
	pid: number,
) => Promise<string | null | undefined>;

export interface ProcessAncestryOptions {
	readonly platform?: NodeJS.Platform;
	/** Test seam; production reads `/proc` on Linux and `ps` elsewhere. */
	readonly readParent?: ParentPidReader;
	/** Test seam; production reads `/proc` on Linux and `ps` elsewhere. */
	readonly readTerminal?: ControllingTerminalReader;
	readonly maxHops?: number;
}

/**
 * Which server-owned PTY shell, if any, a process descends from.
 *
 * Ancestry is read only when asked — on a session edge, never on a timer — and
 * each process's chain is cached, so a session reported again costs nothing.
 * The host reads the chain itself: an extension's claim about which terminal
 * owns a process is never trusted.
 */
export class ProcessAncestry {
	private readonly readParent: ParentPidReader;
	private readonly readTerminal: ControllingTerminalReader;
	private readonly maxHops: number;
	private readonly terminals = new Map<number, string | null | undefined>();
	private readonly chains = new Map<number, readonly number[]>();
	private readonly reads = new Map<number, Promise<readonly number[]>>();

	constructor(options: ProcessAncestryOptions = {}) {
		const platform = options.platform ?? process.platform;
		this.readParent =
			options.readParent ??
			(platform === 'linux' ? readProcParent : readPsParent);
		this.readTerminal =
			options.readTerminal ??
			(platform === 'linux' ? readProcTerminal : readPsTerminal);
		this.maxHops = options.maxHops ?? MAX_ANCESTRY_HOPS;
	}

	/** The cached chain for `pid`, starting with `pid` itself. */
	cached(pid: number): readonly number[] | undefined {
		return this.chains.get(pid);
	}

	/**
	 * `pid` and its ancestors, nearest first, stopping early at any pid in
	 * `stopAt` (typically the live PTY shells). Reuses the cache unless
	 * `refresh` is set.
	 */
	async chain(
		pid: number,
		stopAt: ReadonlySet<number> = new Set(),
		refresh = false,
	): Promise<readonly number[]> {
		if (!refresh) {
			const cached = this.chains.get(pid);
			if (cached !== undefined) return cached;
		}
		const pending = this.reads.get(pid);
		if (pending !== undefined) return pending;
		const read = this.read(pid, stopAt).finally(() => {
			this.reads.delete(pid);
		});
		this.reads.set(pid, read);
		const chain = await read;
		this.chains.set(pid, chain);
		return chain;
	}

	/** The first pid of `chain` that is in `shells`. */
	static owner(
		chain: readonly number[],
		shells: ReadonlySet<number>,
	): number | undefined {
		return chain.find((pid) => shells.has(pid));
	}

	/**
	 * Whether `pid` has the same controlling terminal as `shell`. A process
	 * with no controlling terminal, such as a detached background server, or
	 * one whose terminal cannot be read, shares it with no shell.
	 */
	async sharesTerminal(
		pid: number,
		shell: number,
		refresh = false,
	): Promise<boolean> {
		const [own, shells] = await Promise.all([
			this.terminal(pid, refresh),
			this.terminal(shell, refresh),
		]);
		return typeof own === 'string' && own === shells;
	}

	/** Drop every cached chain that passes through `pid`. */
	forgetThrough(pid: number): void {
		for (const [key, chain] of this.chains)
			if (chain.includes(pid)) {
				this.chains.delete(key);
				this.terminals.delete(key);
			}
		this.terminals.delete(pid);
	}

	forget(pid: number): void {
		this.chains.delete(pid);
		this.terminals.delete(pid);
	}

	/** Keep only chains for `pids`. */
	retain(pids: ReadonlySet<number>): void {
		for (const key of this.chains.keys())
			if (!pids.has(key)) this.chains.delete(key);
	}

	private async terminal(
		pid: number,
		refresh: boolean,
	): Promise<string | null | undefined> {
		if (!refresh && this.terminals.has(pid)) return this.terminals.get(pid);
		let terminal: string | null | undefined;
		try {
			terminal = await this.readTerminal(pid);
		} catch {
			terminal = undefined;
		}
		// A failed read is not remembered, so the next edge tries again.
		if (terminal === undefined) this.terminals.delete(pid);
		else this.terminals.set(pid, terminal);
		return terminal;
	}

	private async read(
		pid: number,
		stopAt: ReadonlySet<number>,
	): Promise<readonly number[]> {
		const chain: number[] = [pid];
		let current = pid;
		for (let hop = 0; hop < this.maxHops; hop += 1) {
			if (stopAt.has(current) || current <= 1) break;
			let parent: number | undefined;
			try {
				parent = await this.readParent(current);
			} catch {
				parent = undefined;
			}
			if (parent === undefined || parent <= 0 || chain.includes(parent)) break;
			chain.push(parent);
			current = parent;
		}
		return Object.freeze(chain);
	}
}

async function readProcParent(pid: number): Promise<number | undefined> {
	try {
		const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
		// The command name is parenthesised and may contain spaces, so the
		// fields are read after its closing parenthesis.
		const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
		return positivePid(fields[1]);
	} catch {
		return undefined;
	}
}

function readPsParent(pid: number): Promise<number | undefined> {
	return new Promise((resolve) => {
		execFile(
			'ps',
			['-o', 'ppid=', '-p', String(pid)],
			{ timeout: 2_000, maxBuffer: 1024 },
			(error, stdout) => {
				resolve(error ? undefined : positivePid(stdout));
			},
		);
	});
}

async function readProcTerminal(
	pid: number,
): Promise<string | null | undefined> {
	try {
		return terminalFromProcStat(await readFile(`/proc/${pid}/stat`, 'utf8'));
	} catch {
		return undefined;
	}
}

/** The controlling terminal in a Linux `/proc/<pid>/stat` line: `tty_nr`, 0 for none. */
export function terminalFromProcStat(stat: string): string | null | undefined {
	const close = stat.lastIndexOf(')');
	if (close < 0) return undefined;
	// The command name is parenthesised and may contain spaces, so the fields
	// are read after its closing parenthesis; tty_nr is the fifth of them.
	const device = stat.slice(close + 2).split(' ')[4];
	if (device === undefined || !/^-?\d+$/u.test(device)) return undefined;
	return device === '0' ? null : device;
}

function readPsTerminal(pid: number): Promise<string | null | undefined> {
	return new Promise((resolve) => {
		execFile(
			'ps',
			['-o', 'tty=', '-p', String(pid)],
			{ timeout: 2_000, maxBuffer: 1024 },
			(error, stdout) => {
				resolve(error ? undefined : terminalFromPs(stdout));
			},
		);
	});
}

/** The controlling terminal in `ps -o tty=` output: `??` (macOS) or `?` (procps) for none. */
export function terminalFromPs(output: string): string | null | undefined {
	const name = output.trim();
	if (name.length === 0) return undefined;
	return /^\?+$/u.test(name) ? null : name;
}

function positivePid(value: string | undefined): number | undefined {
	const pid = Number.parseInt(value?.trim() ?? '', 10);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
