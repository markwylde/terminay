import type { AgentLifecyclePublisher } from '@terminay/extension-api';
type JsonObject = Record<string, unknown>;
export interface OpenCodeMapState {
    started: boolean;
    titled: boolean;
    turnOpen: boolean;
    faulted: boolean;
    /**
     * User message ids that have already opened a turn. OpenCode re-stores a
     * user message after the turn completes (to record its diff summary), so a
     * turn is keyed by message id and never reopened by a later update.
     */
    turns: Set<string>;
    /** Tool call ids currently running, so a completion matches its start. */
    tools: Set<string>;
    children: Set<string>;
    /**
     * Child call ids whose label has already been published. A `task` part is
     * first written with an empty `state.input`, so the label arrives on a later
     * record and is published then as a repeated start for the same child.
     */
    labelled: Set<string>;
}
export declare function emptyState(): OpenCodeMapState;
export declare function subagentLabel(state: JsonObject | undefined): string | undefined;
export interface OpenCodeMapContext {
    readonly publish: AgentLifecyclePublisher;
    readonly rootId: string;
    readonly state: OpenCodeMapState;
}
/**
 * OpenCode `(opencode, 0.1)`.
 *
 * Records are read from the store's append-only `event` log. Only lifecycle
 * and bounded display fields are taken: a tool part contributes its name, call
 * id and status, never `state.input` or `state.output`, and a message
 * contributes its role and completion, never its text.
 */
export declare function mapOpenCodeEvent(type: string, raw: string, context: OpenCodeMapContext): void;
export {};
//# sourceMappingURL=mapping.d.ts.map