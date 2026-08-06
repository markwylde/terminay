export type TransportState = "opening" | "open" | "closing" | "closed" | "failed";
export type TransportCloseCode = "normal" | "cancelled" | "timeout" | "protocol_error" | "unauthorized" | "unavailable" | "resource" | "internal";

export interface TransportCloseReason { readonly code: TransportCloseCode; readonly message?: string; readonly cause?: unknown; }
export interface TransportSendOptions { readonly signal?: AbortSignal; }
export interface TransportCloseOptions { readonly signal?: AbortSignal; readonly timeoutMs?: number; }

/**
 * A bounded byte transport. send() only means acceptance into the local queue.
 * Adapters keep `state` synchronized with the underlying primitive. Once close
 * or failure begins, waiting, concurrent, and later sends reject and the
 * endpoint cannot be reopened; reconnect always constructs a new transport.
 */
export interface ByteTransport {
  readonly state: TransportState;
  readonly incoming: AsyncIterable<Uint8Array>;
  readonly queuedBytes: number;
  readonly bufferedBytes: number;
  open(signal?: AbortSignal): Promise<void>;
  send(frame: Uint8Array, options?: TransportSendOptions): Promise<void>;
  /** Wait until one positive, bounded frame size can be accepted. */
  waitForWritable(requiredBytes?: number, signal?: AbortSignal): Promise<void>;
  close(reason?: TransportCloseReason, options?: TransportCloseOptions): Promise<void>;
  onStateChange(listener: (state: TransportState, reason?: TransportCloseReason) => void): () => void;
}

export function abortIfSignalled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

export function validateTransportFrame(frame: Uint8Array, maxFrameBytes: number): void {
  if (!(frame instanceof Uint8Array)) throw new TypeError("transport frames must be Uint8Array");
  if (frame.byteLength === 0 || frame.byteLength > maxFrameBytes) throw new RangeError("transport frame size out of bounds");
}
