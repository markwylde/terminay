/** Bounds every read, so a large store can never be pulled into memory. */
export declare const LIMITS: {
	readonly sessionId: 512;
	readonly title: 200;
	readonly slug: 128;
	readonly toolName: 200;
	readonly toolId: 512;
	readonly directory: 4096;
	readonly events: 512;
	readonly retries: 5;
	readonly retryDelayMs: 25;
};
/**
 * OpenCode's data root. `XDG_DATA_HOME` relocates it; otherwise it is the
 * platform default below the account home.
 */
export declare function effectiveOpenCodeRoot(
	environment?: NodeJS.ProcessEnv,
): string;
/** OpenCode is recognized by its executable, never by a wrapper name. */
export declare function isOpenCodeForeground(executableName: string): boolean;
/**
 * Canonicalizes a candidate store path and refuses anything that escapes the
 * effective data root, including through a symlink.
 */
export declare function safeStorePath(
	candidate: string,
	root: string,
): Promise<string | undefined>;
/** A store path a provider process holds, including its write-ahead log. */
export declare function storePathFor(openFilePath: string): string | undefined;
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
/**
 * A bounded read-only view of one OpenCode store.
 *
 * The database is opened `readOnly` so no write lock is ever taken on a store
 * a provider is actively writing, and reads retry briefly on `SQLITE_BUSY`.
 * Only lifecycle and bounded display columns are selected: `message.data` and
 * `part.data` payloads carry prompts, responses, reasoning, tool arguments and
 * tool output and are never read whole.
 */
export declare class OpenCodeStore {
	private readonly path;
	private database;
	constructor(path: string);
	private open;
	/** Retries only the transient busy case; every other failure is final. */
	private query;
	/** Parentless sessions whose directory matches the process working directory. */
	rootsForDirectory(directory: string): readonly OpenCodeSessionRow[];
	/** Children whose declared parent is exactly the bound root. */
	childrenOf(rootId: string): readonly OpenCodeSessionRow[];
	/** Appended events for one session aggregate, after a cursor. */
	eventsAfter(
		aggregateId: string,
		afterSeq: number,
	): readonly OpenCodeEventRow[];
	close(): void;
}
//# sourceMappingURL=store.d.ts.map
