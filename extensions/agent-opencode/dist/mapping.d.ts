import type { AgentLifecyclePublisher } from '@terminay/extension-api';
export interface OpenCodeMapState {
	started: boolean;
	titled: boolean;
	turnOpen: boolean;
	faulted: boolean;
	/** Tool call ids currently running, so a completion matches its start. */
	tools: Set<string>;
	/** Tool call ids currently awaiting approval. */
	waits: Set<string>;
	children: Set<string>;
}
export declare function emptyState(): OpenCodeMapState;
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
export declare function mapOpenCodeEvent(
	type: string,
	raw: string,
	context: OpenCodeMapContext,
): void;
//# sourceMappingURL=mapping.d.ts.map
