import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** The most parent hops read for one process. */
export const MAX_ANCESTRY_HOPS = 64;

/** Reads one process's parent pid, or `undefined` when it has none or is gone. */
export type ParentPidReader = (pid: number) => Promise<number | undefined>;

export interface ProcessAncestryOptions {
	readonly platform?: NodeJS.Platform;
	/** Test seam; production reads `/proc` on Linux and `ps` elsewhere. */
	readonly readParent?: ParentPidReader;
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
	private readonly maxHops: number;
	private readonly chains = new Map<number, readonly number[]>();
	private readonly reads = new Map<number, Promise<readonly number[]>>();

	constructor(options: ProcessAncestryOptions = {}) {
		const platform = options.platform ?? process.platform;
		this.readParent =
			options.readParent ??
			(platform === 'linux' ? readProcParent : readPsParent);
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

	/** Drop every cached chain that passes through `pid`. */
	forgetThrough(pid: number): void {
		for (const [key, chain] of this.chains)
			if (chain.includes(pid)) this.chains.delete(key);
	}

	forget(pid: number): void {
		this.chains.delete(pid);
	}

	/** Keep only chains for `pids`. */
	retain(pids: ReadonlySet<number>): void {
		for (const key of this.chains.keys())
			if (!pids.has(key)) this.chains.delete(key);
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

function positivePid(value: string | undefined): number | undefined {
	const pid = Number.parseInt(value?.trim() ?? '', 10);
	return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
