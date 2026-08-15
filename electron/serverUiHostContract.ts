import type { TerminayHostActionRequest, TerminayHostContext, TerminayHostEvent } from '@terminay/protocol';

/** Electron consumes the canonical protocol contract; this module only names
 * its closed host IPC operations and must never define a second action schema.
 * The dropped-file resolver and terminal clipboard reader are local preload
 * capabilities: Electron must inspect native data before it crosses the
 * renderer security boundary. */
export type ServerUiHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<unknown>;
	subscribeEvent(listener: (event: TerminayHostEvent) => Promise<void> | void): () => void;
	resolveDroppedFilePath(file: File): string | undefined;
	readTerminalClipboard(): Promise<string>;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
