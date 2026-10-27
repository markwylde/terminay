import { randomBytes } from 'node:crypto';
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where the server keeps the records of app windows (ADR-0076), so a window
 * lasts as long as its terminal session does, across server restarts.
 *
 * One file per window, named by its id. A write goes to a temporary file that
 * is renamed over the record, so a crash leaves the old record or the new one.
 * Writes of one window run one at a time, and a write queued behind another is
 * replaced by a newer one: only the latest record is ever written.
 */

export const APP_WINDOW_STORE_DIRECTORY_NAME = 'app-windows';
/** Bumped when a written record changes shape; a record of another version is discarded. */
export const APP_WINDOW_RECORD_VERSION = 1;

const RECORD_SUFFIX = '.json';
const TEMPORARY_SUFFIX = '.tmp';
/** An id that is safe as a file name on every platform the server runs on. */
const STORABLE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export interface StoredAppWindowRecord {
	readonly id: string;
}

export interface AppWindowStoreOptions<T extends StoredAppWindowRecord> {
	readonly directory: string;
	/** The record a file holds, or undefined when it is not one this server can restore. */
	readonly parse: (value: unknown) => T | undefined;
	/** A write, removal, or read that failed. The running server is unaffected. */
	readonly onError?: (error: unknown, windowId: string | undefined) => void;
}

type Pending<T> =
	| { readonly kind: 'write'; readonly record: T }
	| { readonly kind: 'remove' };

export class AppWindowStore<T extends StoredAppWindowRecord> {
	private readonly pending = new Map<string, Pending<T>>();
	private readonly running = new Map<string, Promise<void>>();

	constructor(private readonly options: AppWindowStoreOptions<T>) {}

	static isStorableId(id: string): boolean {
		return STORABLE_ID.test(id);
	}

	/** Write a window's record, replacing any write of it not yet started. */
	write(record: T): void {
		if (!AppWindowStore.isStorableId(record.id)) {
			this.options.onError?.(
				new Error('window id cannot be stored'),
				record.id,
			);
			return;
		}
		this.schedule(record.id, { kind: 'write', record });
	}

	/** Remove a window's record, replacing any write of it not yet started. */
	remove(windowId: string): void {
		if (!AppWindowStore.isStorableId(windowId)) return;
		this.schedule(windowId, { kind: 'remove' });
	}

	/** Settles once every write and removal queued so far has finished. */
	async flush(): Promise<void> {
		while (this.running.size > 0)
			await Promise.allSettled([...this.running.values()]);
	}

	/**
	 * Every record written. A file that cannot be read, or holds no record this
	 * server can restore, is removed and reported, and the rest still load.
	 */
	async load(): Promise<readonly T[]> {
		await this.flush();
		let names: string[];
		try {
			names = await readdir(this.options.directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
				this.options.onError?.(error, undefined);
			return [];
		}
		const records: T[] = [];
		for (const name of names) {
			const path = join(this.options.directory, name);
			// What an interrupted write left behind.
			if (name.endsWith(TEMPORARY_SUFFIX)) {
				await rm(path, { force: true }).catch(() => undefined);
				continue;
			}
			if (!name.endsWith(RECORD_SUFFIX)) continue;
			const id = name.slice(0, -RECORD_SUFFIX.length);
			let record: T | undefined;
			try {
				record = this.options.parse(JSON.parse(await readFile(path, 'utf8')));
			} catch {
				record = undefined;
			}
			if (record === undefined || record.id !== id) {
				this.options.onError?.(new Error('window record is not valid'), id);
				await rm(path, { force: true }).catch(() => undefined);
				continue;
			}
			records.push(record);
		}
		return records;
	}

	private schedule(windowId: string, next: Pending<T>): void {
		this.pending.set(windowId, next);
		this.drain(windowId);
	}

	private drain(windowId: string): void {
		if (this.running.has(windowId)) return;
		const run = (async () => {
			for (;;) {
				const operation = this.pending.get(windowId);
				if (operation === undefined) break;
				this.pending.delete(windowId);
				try {
					await this.apply(windowId, operation);
				} catch (error) {
					this.options.onError?.(error, windowId);
				}
			}
		})().finally(() => {
			this.running.delete(windowId);
			// Queued after the loop looked for the last time.
			if (this.pending.has(windowId)) this.drain(windowId);
		});
		this.running.set(windowId, run);
	}

	private async apply(windowId: string, operation: Pending<T>): Promise<void> {
		const path = join(this.options.directory, `${windowId}${RECORD_SUFFIX}`);
		if (operation.kind === 'remove') {
			await rm(path, { force: true });
			return;
		}
		await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
		const temporary = `${path}.${randomBytes(6).toString('hex')}${TEMPORARY_SUFFIX}`;
		try {
			await writeFile(temporary, JSON.stringify(operation.record), {
				mode: 0o600,
			});
			await rename(temporary, path);
		} catch (error) {
			await rm(temporary, { force: true }).catch(() => undefined);
			throw error;
		}
	}
}
