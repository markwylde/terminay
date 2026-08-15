import type { TerminayHostActionRequest, TerminayHostContext, TerminayHostEvent } from '@terminay/protocol';

/** Electron consumes the canonical protocol contract; this module only names
 * the two IPC operations and must never define a second action schema. The
 * dropped-file resolver is a local preload capability: Electron must inspect
 * the DOM File before it crosses the renderer security boundary. */
export type ServerUiHostBridge = Readonly<{
	getContext(): Promise<TerminayHostContext>;
	requestAction(request: TerminayHostActionRequest): Promise<unknown>;
	subscribeEvent(listener: (event: TerminayHostEvent) => Promise<void> | void): () => void;
	resolveDroppedFilePath(file: File): string | undefined;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
