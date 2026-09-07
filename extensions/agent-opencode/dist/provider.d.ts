import { type AgentFileWatcher, type AgentRecordContext, type AgentTerminalContext } from '@terminay/extension-api';
import { LIMITS, type OpenCodeSessionRow, OpenCodeStore } from './store.js';
/** OpenCode `--session` / `-s` names the restored root when present. */
export declare function openCodeSessionId(arguments_: readonly string[] | undefined): string | undefined;
/** OpenCode `--continue` / `-c` reopens the directory's newest session. */
export declare function openCodeContinues(arguments_: readonly string[] | undefined): boolean;
export declare const PROVIDER_ID = "com.terminay.agent.opencode/cli";
export declare const ROOT_SELECTION: {
    /**
     * A process start time is only ever proven to whole seconds on some
     * platforms (`ps -o lstart`), and it never postdates the real start, so a
     * session this process created can read as up to a second older than it.
     */
    readonly clockToleranceMs: 1000;
    /**
     * OpenCode writes no session row when a TUI opens: the row appears when the
     * first prompt is submitted, about two to three seconds after launch in
     * practice. Until then a freshly launched CLI and a CLI that reopened an
     * older session look identical from the store. Within this window a launch
     * is assumed to be making its own session and no older root is adopted;
     * past it, the only remaining reading is that this process reopened one.
     */
    readonly newSessionGraceMs: 30000;
};
/**
 * Which parentless root in a directory belongs to the CLI running in this
 * terminal.
 *
 * The rule cannot be "the most recently updated root in the directory": two
 * terminals in one repository is the ordinary case, and that rule hands both
 * of them whichever session typed last. A session is created when its first
 * prompt is submitted, which is always after its own process started, so a
 * root created before this process existed was made by some other terminal
 * and is never this one's.
 *
 * The earliest root created after the process started is preferred, not the
 * latest: a second terminal starting later also creates a root that passes the
 * time test, and taking the earliest keeps each terminal on the session it
 * opened with rather than drifting onto a neighbour's newer one.
 */
export declare function selectOpenCodeRoot(roots: readonly OpenCodeSessionRow[], options: {
    requested?: string;
    /** True only when `--continue` was proven on the CLI's arguments. */
    continuing?: boolean;
    /** The root this same terminal was last bound to, if any. */
    remembered?: string;
    /** Epoch milliseconds the CLI process started, when the environment proves it. */
    startedAt?: number;
    now: number;
}): OpenCodeSessionRow | undefined;
/** The terminal device the observed processes share, when one is visible. */
export declare function terminalDeviceKey(files: readonly {
    path: string;
}[]): string | undefined;
export declare function rememberOpenCodeRoot(key: string, rootId: string): void;
export declare function rememberedOpenCodeRoot(key: string): string | undefined;
/**
 * The directories OpenCode is running in below this terminal, each with the
 * earliest start time proven for a CLI process in it.
 */
export declare function openCodeWorkingDirectories(processes: readonly {
    executableName: string;
    cwd?: string;
    startedAt?: string;
}[]): Map<string, number | undefined>;
/**
 * OpenCode keeps its state in a SQLite store rather than a JSONL journal, so
 * this provider drives its own bounded polling loop over the store's
 * append-only `event` table instead of using the shared JSONL session helper.
 * The store is only ever opened read-only.
 */
export declare const openCodeProvider: import("@terminay/extension-api").AgentProviderDefinition;
/**
 * The store has no journal to follow, so its append-only `event` rows are
 * re-encoded as JSONL lines. That lets OpenCode use the host's existing record
 * pipeline — replay limits, flow control and validation — rather than a second
 * observation loop of its own.
 */
export interface OpenCodeRecord {
    readonly __opencode: 1;
    readonly type: string;
    readonly data: string;
}
export declare function storeWatcher(terminal: AgentTerminalContext, store: OpenCodeStore, rootId: string, pollMs?: number): AgentFileWatcher;
export declare function createOpenCodeRecordMapper(rootId: string): (record: unknown, session: AgentRecordContext) => void;
export { LIMITS };
//# sourceMappingURL=provider.d.ts.map