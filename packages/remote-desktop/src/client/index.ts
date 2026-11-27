/**
 * The client half of a remote desktop: a pull byte stream over the Terminay
 * connection, and the WebSocket-like channel noVNC attaches to.
 */

export { RfbStreamChannel, type RfbByteStream } from './rfbChannel.js';

/** A JSON value a stream handle may carry. */
export type StreamHandleValue =
	| string
	| number
	| boolean
	| null
	| readonly StreamHandleValue[]
	| { readonly [key: string]: StreamHandleValue };

/** What the server issued for one stream. Opaque to this client: every field
 * is sent back unchanged with each operation on the stream. */
export type StreamHandle = { readonly [key: string]: StreamHandleValue };

export interface ByteStreamRequestOptions {
	readonly signal?: AbortSignal;
	readonly deadlineMs?: number;
	/** Passed through to the transport untouched. */
	readonly queryId?: string;
	readonly commandId?: string;
	readonly expectedRevision?: number;
}

/** The transport a byte stream needs. `@terminay/client-core` transports
 * satisfy it structurally. */
export interface ByteStreamTransport {
	queryWithBody(
		operation: string,
		input: StreamHandle,
		options?: ByteStreamRequestOptions,
	): Promise<{ result: unknown; body: Uint8Array }>;
	command(
		operation: string,
		input: StreamHandle,
		options?: ByteStreamRequestOptions,
	): Promise<unknown>;
	commandWithBody(
		operation: string,
		input: StreamHandle,
		body: Uint8Array,
		options?: ByteStreamRequestOptions,
	): Promise<unknown>;
}

/** The operation names a stream's owner serves it under. */
export interface ByteStreamOperations {
	readonly read: string;
	readonly write: string;
	readonly finish: string;
	readonly close: string;
}

const CHUNK_BYTES = 1024 * 1024;

/** A pull is one credit. No timer or background read runs when unused. */
export class ByteStreamClient<Handle extends StreamHandle = StreamHandle> {
	private ended = false;
	constructor(
		protected readonly transport: ByteStreamTransport,
		protected readonly operations: ByteStreamOperations,
		readonly handle: Handle,
		/** Names the stream in error messages, as in "bot stream closed". */
		private readonly noun = 'desktop',
	) {}
	protected get closed(): boolean {
		return this.ended;
	}
	async *read(
		options: ByteStreamRequestOptions = {},
	): AsyncIterable<Uint8Array> {
		try {
			while (!this.ended) {
				const { result, body } = await this.transport.queryWithBody(
					this.operations.read,
					{ ...this.handle },
					options,
				);
				if (
					!result ||
					typeof result !== 'object' ||
					Array.isArray(result) ||
					typeof (result as { done?: unknown }).done !== 'boolean' ||
					body.length > CHUNK_BYTES
				)
					throw new TypeError(`invalid ${this.noun} stream response`);
				if ((result as { done: boolean }).done) {
					this.ended = true;
					return;
				}
				yield body;
			}
		} finally {
			await this.close();
		}
	}
	async write(
		bytes: Uint8Array,
		options: ByteStreamRequestOptions = {},
	): Promise<void> {
		this.assertOpen();
		if (bytes.length > CHUNK_BYTES)
			throw new RangeError(`${this.noun} stream chunk too large`);
		await this.transport.commandWithBody(
			this.operations.write,
			{ ...this.handle },
			bytes,
			options,
		);
	}
	async finish(options: ByteStreamRequestOptions = {}): Promise<void> {
		this.assertOpen();
		await this.transport.command(
			this.operations.finish,
			{ ...this.handle },
			options,
		);
		this.ended = true;
	}
	async close(): Promise<void> {
		if (this.ended) return;
		this.ended = true;
		await this.transport
			.command(this.operations.close, { ...this.handle })
			.catch(() => undefined);
	}
	protected assertOpen(): void {
		if (this.ended) throw new Error(`${this.noun} stream closed`);
	}
}
