import {
	closeSync,
	type FSWatcher,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	rmSync,
	watch,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Git's Trace2 events, when the target is a directory (ADR-0081). Git for
 * Windows writes one file per Git process into it. Each file is read as it
 * grows, its lines handed on one by one, and deleted once its process has
 * exited or it passes a bound, so the directory holds only the files of Git
 * processes still being read. Nothing is kept beyond the line being handled.
 *
 * What arrives is untrusted, exactly as on the socket: any process that can
 * write here can forge a file. The line handler decides what a line may say.
 */

/** A file larger than this is not one Git process's brief events. */
export const MAX_TRACE_FILE_BYTES = 64 * 1024;
/** Time after a file's `exit` event for Git to write `atexit` and close it. */
const EXIT_SETTLE_MS = 2_000;
const READ_CHUNK_BYTES = 8 * 1024;

export interface GitTraceDirectoryOptions {
	readonly path: string;
	readonly maxLineBytes: number;
	readonly onLine: (line: string) => void;
	/** Make the directory fit to use (on Windows, its protected DACL). */
	readonly prepare?: (path: string) => boolean;
	readonly timers?: {
		readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
		readonly clearTimeout: (handle: unknown) => void;
	};
}

interface TraceFile {
	offset: number;
	pending: string;
	exited: boolean;
	settle: unknown;
}

export class GitTraceDirectory {
	private readonly files = new Map<string, TraceFile>();
	/** Files read to their end that could not yet be deleted. */
	private readonly consumed = new Set<string>();
	private watcher: FSWatcher | undefined;
	private readonly timers: NonNullable<GitTraceDirectoryOptions['timers']>;

	constructor(private readonly options: GitTraceDirectoryOptions) {
		this.timers = options.timers ?? {
			setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
			clearTimeout: (handle) =>
				clearTimeout(handle as ReturnType<typeof setTimeout>),
		};
	}

	/**
	 * Start watching. Files left by an earlier run are deleted unread: their
	 * commands ran before this server, and nothing is attributed from them.
	 */
	start(): boolean {
		if (this.watcher !== undefined) return true;
		try {
			mkdirSync(this.options.path, { recursive: true, mode: 0o700 });
			if (this.options.prepare?.(this.options.path) === false) return false;
			for (const name of readdirSync(this.options.path))
				this.remove(name);
			this.watcher = watch(this.options.path, (_event, name) => {
				if (typeof name === 'string' && name.length > 0) this.read(name);
			});
			this.watcher.on('error', () => this.stop());
		} catch {
			this.stop();
			return false;
		}
		return true;
	}

	get listening(): boolean {
		return this.watcher !== undefined;
	}

	/** Files being read; for asserting nothing accumulates. */
	get openFiles(): number {
		return this.files.size;
	}

	stop(): void {
		this.watcher?.close();
		this.watcher = undefined;
		for (const file of this.files.values())
			if (file.settle !== undefined) this.timers.clearTimeout(file.settle);
		this.files.clear();
		this.consumed.clear();
	}

	private read(name: string): void {
		// Git names its files for its session id; nothing here walks a path.
		if (name.includes('/') || name.includes('\\') || name.startsWith('.'))
			return;
		if (this.consumed.has(name)) {
			this.remove(name);
			return;
		}
		let file = this.files.get(name);
		if (file === undefined) {
			file = { offset: 0, pending: '', exited: false, settle: undefined };
			this.files.set(name, file);
		}
		let descriptor: number;
		try {
			descriptor = openSync(join(this.options.path, name), 'r');
		} catch {
			// Deleted already, by us or by someone else.
			this.forget(name);
			return;
		}
		const chunk = new Uint8Array(READ_CHUNK_BYTES);
		const decoder = new TextDecoder();
		try {
			for (;;) {
				if (file.offset >= MAX_TRACE_FILE_BYTES) break;
				const length = readSync(
					descriptor,
					chunk,
					0,
					Math.min(READ_CHUNK_BYTES, MAX_TRACE_FILE_BYTES - file.offset),
					file.offset,
				);
				if (length === 0) break;
				file.offset += length;
				file.pending += decoder.decode(chunk.subarray(0, length), {
					stream: true,
				});
				this.lines(file);
			}
		} catch {
			// A read that fails ends this file like a bound does.
			file.offset = MAX_TRACE_FILE_BYTES;
		} finally {
			closeSync(descriptor);
		}
		if (
			file.offset >= MAX_TRACE_FILE_BYTES ||
			file.pending.length > this.options.maxLineBytes
		) {
			this.remove(name);
			return;
		}
		if (file.exited && file.settle === undefined)
			file.settle = this.timers.setTimeout(
				() => this.remove(name),
				EXIT_SETTLE_MS,
			);
	}

	private lines(file: TraceFile): void {
		for (
			let newline = file.pending.indexOf('\n');
			newline >= 0;
			newline = file.pending.indexOf('\n')
		) {
			const line = file.pending.slice(0, newline);
			file.pending = file.pending.slice(newline + 1);
			if (line.includes('"event":"exit"') || line.includes('"event":"atexit"'))
				file.exited = true;
			this.options.onLine(line);
		}
	}

	private remove(name: string): void {
		this.forget(name);
		try {
			rmSync(join(this.options.path, name), { force: true });
			this.consumed.delete(name);
		} catch {
			// Still open in Git: the next event for it tries again, and it is
			// never read a second time.
			this.consumed.add(name);
		}
	}

	private forget(name: string): void {
		const file = this.files.get(name);
		if (file?.settle !== undefined) this.timers.clearTimeout(file.settle);
		this.files.delete(name);
	}
}
