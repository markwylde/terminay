import type { TerminayHostActionRequest, TerminayHostContext } from '@terminay/protocol';

/** Electron consumes the canonical protocol contract; this module only names
 * the two IPC operations and must never define a second action schema. */
export type ServerUiHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<void>;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
