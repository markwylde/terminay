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

/** One opaque byte endpoint exposed to the bound document. */
export type ServerUiByteChannel = Readonly<{
	send(frame: Uint8Array): Promise<void>;
	subscribe(listener: (frame: Uint8Array | null) => void): () => void;
	close(): void;
}>;

/** The window's byte bridge.
 *
 * Version 2 adds `openConnection`. The primary connection keeps the single
 * endpoint the document has always been handed; every attached connection gets
 * its own `MessagePort`, created by main while it handles `connections.attach`
 * and named only by the opaque connection id that action returned. The bridge
 * exposes no credential, no signaling state, and no raw transport handle. */
export type ServerUiByteBridge = Readonly<{
	version: 2;
	openConnection(connectionId: string): Promise<ServerUiByteChannel>;
	replaceEndpoint(): Promise<void>;
	send(frame: Uint8Array): Promise<void>;
	subscribe(listener: (frame: Uint8Array | null) => void): () => void;
}>;

export type { TerminayHostActionRequest, TerminayHostContext };
