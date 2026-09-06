import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Bounds every read, so a large store can never be pulled into memory. */
export const LIMITS = {
	sessionId: 512,
	title: 200,
	slug: 128,
	toolName: 200,
	toolId: 512,
	directory: 4_096,
	events: 512,
	retries: 5,
	retryDelayMs: 25,
} as const;

/**
 * OpenCode's data root. `XDG_DATA_HOME` relocates it; otherwise it is the
 * platform default below the account home.
 */
export function effectiveOpenCodeRoot(
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const configured = environment.XDG_DATA_HOME?.trim();
	return configured
		? resolve(configured, 'opencode')
		: resolve(homedir(), '.local/share/opencode');
}

/** OpenCode is recognized by its executable, never by a wrapper name. */
export function isOpenCodeForeground(executableName: string): boolean {
	return executableName.trim().toLowerCase() === 'opencode';
}

/**
 * Canonicalizes a candidate store path and refuses anything that escapes the
 * effective data root, including through a symlink.
 */
export async function safeStorePath(
	candidate: string,
	root: string,
): Promise<string | undefined> {
	if (!isAbsolute(candidate)) return undefined;
	const [file, canonicalRoot] = await Promise.all([
		realpath(candidate),
		realpath(root),
	]).catch(() => [] as string[]);
	if (!file || !canonicalRoot) return undefined;
	const within = relative(canonicalRoot, file);
	if (!within || within.startsWith('..') || isAbsolute(within))
		return undefined;
	return file.endsWith('opencode.db') ? file : undefined;
}

/** A store path a provider process holds, including its write-ahead log. */
export function storePathFor(openFilePath: string): string | undefined {
	const match = /^(.*opencode\.db)(?:-wal|-shm)?$/u.exec(openFilePath);
	return match?.[1];
}

export interface OpenCodeSessionRow {
	readonly id: string;
	readonly parentId?: string;
	readonly slug?: string;
	readonly title?: string;
	readonly directory: string;
	readonly timeUpdated: number;
}

export interface OpenCodeEventRow {
	readonly seq: number;
	readonly type: string;
	readonly data: string;
}

function text(value: unknown, limit: number): string | undefined {
	return typeof value === 'string' && value.length > 0 && value.length <= limit
		? value
		: undefined;
}

/**
 * A bounded read-only view of one OpenCode store.
 *
 * The database is opened `readOnly` so no write lock is ever taken on a store
 * a provider is actively writing, and reads retry briefly on `SQLITE_BUSY`.
 * Only lifecycle and bounded display columns are selected: `message.data` and
 * `part.data` payloads carry prompts, responses, reasoning, tool arguments and
 * tool output and are never read whole.
 */
export class OpenCodeStore {
	private database: DatabaseSync | undefined;

	constructor(private readonly path: string) {}

	private open(): DatabaseSync {
		this.database ??= new DatabaseSync(this.path, { readOnly: true });
		return this.database;
	}

	/** Retries only the transient busy case; every other failure is final. */
	private query<T>(run: (database: DatabaseSync) => T): T | undefined {
		for (let attempt = 0; attempt <= LIMITS.retries; attempt += 1) {
			try {
				return run(this.open());
			} catch (error) {
				const message = error instanceof Error ? error.message : '';
				if (!/busy|locked/iu.test(message)) return undefined;
				this.close();
				Atomics.wait(
					new Int32Array(new SharedArrayBuffer(4)),
					0,
					0,
					LIMITS.retryDelayMs,
				);
			}
		}
		return undefined;
	}

	/** Parentless sessions whose directory matches the process working directory. */
	rootsForDirectory(directory: string): readonly OpenCodeSessionRow[] {
		return (
			this.query((database) =>
				database
					.prepare(
						'SELECT id, parent_id, slug, title, directory, time_updated FROM session WHERE parent_id IS NULL AND directory = ? ORDER BY time_updated DESC LIMIT 16',
					)
					.all(directory)
					.flatMap((row) => {
						const value = row as Record<string, unknown>;
						const id = text(value.id, LIMITS.sessionId);
						const rowDirectory = text(value.directory, LIMITS.directory);
						if (!id || !rowDirectory) return [];
						return [
							{
								id,
								...(text(value.slug, LIMITS.slug)
									? { slug: text(value.slug, LIMITS.slug) }
									: {}),
								...(text(value.title, LIMITS.title)
									? { title: text(value.title, LIMITS.title) }
									: {}),
								directory: rowDirectory,
								timeUpdated:
									typeof value.time_updated === 'number'
										? value.time_updated
										: 0,
							} as OpenCodeSessionRow,
						];
					}),
			) ?? []
		);
	}

	/** Children whose declared parent is exactly the bound root. */
	childrenOf(rootId: string): readonly OpenCodeSessionRow[] {
		return (
			this.query((database) =>
				database
					.prepare(
						'SELECT id, parent_id, slug, title, directory, time_updated FROM session WHERE parent_id = ? ORDER BY time_created ASC LIMIT 64',
					)
					.all(rootId)
					.flatMap((row) => {
						const value = row as Record<string, unknown>;
						const id = text(value.id, LIMITS.sessionId);
						if (!id) return [];
						return [
							{
								id,
								parentId: rootId,
								...(text(value.slug, LIMITS.slug)
									? { slug: text(value.slug, LIMITS.slug) }
									: {}),
								...(text(value.title, LIMITS.title)
									? { title: text(value.title, LIMITS.title) }
									: {}),
								directory: text(value.directory, LIMITS.directory) ?? '',
								timeUpdated:
									typeof value.time_updated === 'number'
										? value.time_updated
										: 0,
							} as OpenCodeSessionRow,
						];
					}),
			) ?? []
		);
	}

	/** Appended events for one session aggregate, after a cursor. */
	eventsAfter(
		aggregateId: string,
		afterSeq: number,
	): readonly OpenCodeEventRow[] {
		return (
			this.query((database) =>
				database
					.prepare(
						'SELECT seq, type, data FROM event WHERE aggregate_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
					)
					.all(aggregateId, afterSeq, LIMITS.events)
					.flatMap((row) => {
						const value = row as Record<string, unknown>;
						const type = text(value.type, 128);
						const data =
							typeof value.data === 'string' ? value.data : undefined;
						if (!type || data === undefined) return [];
						return [
							{
								seq: typeof value.seq === 'number' ? value.seq : 0,
								type,
								data,
							},
						];
					}),
			) ?? []
		);
	}

	close(): void {
		try {
			this.database?.close();
		} catch {
			// A store already closed by a failed query needs no further handling.
		}
		this.database = undefined;
	}
}
