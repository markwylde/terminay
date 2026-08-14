import type { TerminayHostActionRequest, TerminayHostContext, TerminayHostEvent } from '@terminay/protocol';

/** Electron consumes the canonical protocol contract; this module only names
 * the two IPC operations and must never define a second action schema. */
export type ServerUiHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<void>;
	subscribeEvent(listener: (event: TerminayHostEvent) => Promise<void> | void): () => void;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
