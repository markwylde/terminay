import type { CommandOptions } from "./types.js";
import {
  type TerminalClientAttachRequest,
  type TerminalClientAttachment,
  type TerminalDimensions,
  type TerminalStreamEvent,
  type TerminalStreamExitEvent,
  type TerminalStreamOutputEvent,
  type TerminalStreamResyncEvent,
  type TerminalPresentationState,
  TerminayTerminalClient,
} from "./terminal.js";

/**
 * The small stream boundary consumed by an xterm panel. It deliberately
 * carries raw bytes rather than strings so terminal escape sequences and
 * multi-byte output are preserved exactly as they arrived from the server.
 * No Electron, Node, or concrete transport types are allowed here.
 */
export interface TerminalPanelAttachment {
  readonly attachmentId: string;
  readonly identity: TerminalClientAttachment["identity"];
  readonly initialEvents: readonly TerminalStreamEvent[];
  readonly position: number;
  readonly closed: boolean;
  readonly presentation: TerminalPresentationState;
  readonly onEvent: (listener: (event: TerminalStreamEvent) => void) => () => void;
  readonly onOutput: (listener: (event: TerminalStreamOutputEvent) => void) => () => void;
  readonly onExit: (listener: (event: TerminalStreamExitEvent) => void) => () => void;
  readonly onResync: (listener: (event: TerminalStreamResyncEvent) => void) => () => void;
  readonly ack: (position: number, options?: CommandOptions) => Promise<void>;
  readonly write: (data: Uint8Array | string, options?: CommandOptions) => Promise<void>;
  readonly resize: (dimensions: TerminalDimensions, options?: CommandOptions) => Promise<void>;
  readonly changePresentation: (mode: "acquire" | "renew" | "takeover" | "release", options?: CommandOptions) => Promise<TerminalPresentationState>;
  readonly kill: (signal?: number | string, options?: CommandOptions) => Promise<void>;
  readonly detach: (options?: CommandOptions) => Promise<void>;
}

/**
 * Adapter used by Desktop and browser terminal panels during the incremental
 * renderer migration. The panel only knows this contract; the host supplies a
 * TerminayTerminalClient backed by its local socket, browser transport, or
 * WebRTC channel.
 */
export class TerminayTerminalPanelClient {
  constructor(private readonly client: TerminayTerminalClient) {}

  attach(request: TerminalClientAttachRequest): Promise<TerminalPanelAttachment> {
    return this.open("attach", request);
  }

  resume(request: TerminalClientAttachRequest): Promise<TerminalPanelAttachment> {
    return this.open("resume", request);
  }

	waitForInactivity(
		projectId: string,
		sessionId: string,
		durationMs: number,
		options: CommandOptions = {},
	): Promise<void> {
		return this.client.waitForInactivity(
			projectId,
			sessionId,
			durationMs,
			options,
		);
	}

  private async open(mode: "attach" | "resume", request: TerminalClientAttachRequest): Promise<TerminalPanelAttachment> {
    const attachment = await (mode === "attach" ? this.client.attach(request) : this.client.resume(request));
    return new PanelAttachmentView(attachment);
  }
}

class PanelAttachmentView implements TerminalPanelAttachment {
  constructor(private readonly attachment: TerminalClientAttachment) {}

  get attachmentId(): string { return this.attachment.attachmentId; }
  get identity(): TerminalClientAttachment["identity"] { return this.attachment.identity; }
  get initialEvents(): readonly TerminalStreamEvent[] { return this.attachment.initialEvents; }
  get position(): number { return this.attachment.position; }
  get closed(): boolean { return this.attachment.closed; }
  get presentation(): TerminalPresentationState { return this.attachment.presentation; }

  onEvent(listener: (event: TerminalStreamEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("terminal event listener must be a function");
    return this.attachment.onEvent(listener);
  }

  onOutput(listener: (event: TerminalStreamOutputEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("terminal output listener must be a function");
    return this.attachment.onEvent((event) => {
      if (event.type === "output") listener(event);
    });
  }

  onExit(listener: (event: TerminalStreamExitEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("terminal exit listener must be a function");
    return this.attachment.onEvent((event) => {
      if (event.type === "exit") listener(event);
    });
  }

  onResync(listener: (event: TerminalStreamResyncEvent) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("terminal resync listener must be a function");
    return this.attachment.onEvent((event) => {
      if (event.type === "resync_required") listener(event);
    });
  }

  ack(position: number, options: CommandOptions = {}): Promise<void> { return this.attachment.ack(position, options); }
  write(data: Uint8Array | string, options: CommandOptions = {}): Promise<void> { return this.attachment.write(data, options); }
  resize(dimensions: TerminalDimensions, options: CommandOptions = {}): Promise<void> { return this.attachment.resize(dimensions, options); }
  changePresentation(mode: "acquire" | "renew" | "takeover" | "release", options: CommandOptions = {}): Promise<TerminalPresentationState> { return this.attachment.changePresentation(mode, options); }
  kill(signal?: number | string, options: CommandOptions = {}): Promise<void> { return this.attachment.kill(signal, options); }
  detach(options: CommandOptions = {}): Promise<void> { return this.attachment.detach(options); }
}
