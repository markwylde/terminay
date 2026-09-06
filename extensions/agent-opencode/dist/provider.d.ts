import { type AgentFileWatcher, type AgentRecordContext, type AgentTerminalContext } from '@terminay/extension-api';
import { LIMITS, OpenCodeStore } from './store.js';
export declare const PROVIDER_ID = "com.terminay.agent.opencode/cli";
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