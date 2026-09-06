import { type AgentProviderDefinition } from "@terminay/extension-api";
export interface CursorAgentProviderOptions {
    /** Test-only or multi-profile override. The production default is `~/.cursor`. */
    cursorHome?: string;
    pollMs?: number;
}
/**
 * Cursor Agent CLI provider mapping v0.1.
 *
 * The writable Cursor chat store held by a process below the exact Terminal
 * PTY is the binding proof. The transcript's UUID is path-derived because
 * Cursor's JSONL records have no trustworthy session header.
 */
export declare function createCursorAgentProvider(options?: CursorAgentProviderOptions): AgentProviderDefinition;
export declare const cursorAgentProvider: AgentProviderDefinition;
/** Extracts only user-authored text from Cursor's timestamp/query wrapper. */
export declare function cursorPromptText(record: unknown): string | undefined;
/** Creates a friendly model label from Cursor's persisted `lastUsedModel`. */
export declare function cursorModelDisplayName(modelId: string): string;
//# sourceMappingURL=cursorAgent.d.ts.map