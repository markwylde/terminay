import type { TerminayHostActionRequest, TerminayHostContext } from '@terminay/protocol';
import type { AppCommand } from '../src/types/terminay';

/** Electron consumes the canonical protocol contract; this module only names
 * the two IPC operations and must never define a second action schema. */
export type ServerUiHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<void>;
	subscribeAppCommands(listener: (command: AppCommand) => Promise<void> | void): () => void;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
