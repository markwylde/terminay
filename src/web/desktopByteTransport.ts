import {
	abortIfSignalled,
	type ByteTransport,
	type TerminayHostContext,
	type TerminayHostEvent,
	type TransportCloseReason,
	type TransportSendOptions,
	type TransportState,
	validateTransportFrame,
} from '@terminay/protocol';

export interface DesktopByteBridge {
	readonly version: 1;
	replaceEndpoint(): Promise<void>;
	send(frame: Uint8Array): Promise<void>;
	subscribe(listener: (frame: Uint8Array | null) => void): () => void;
}

export interface DesktopHostBridge {
	getContext(): Promise<TerminayHostContext>;
	subscribeEvent(listener: (event: TerminayHostEvent) => Promise<void> | void): () => void;
}

export type DesktopServerBootstrap = Readonly<{
	context: TerminayHostContext;
	transport: ByteTransport;
}>;

const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Renderer-side adapter for the one private server byte endpoint supplied by Desktop. */
export class DesktopByteTransport implements ByteTransport {
	private currentState: TransportState = 'opening';
	private readonly inbound: Uint8Array[] = [];
	private readonly waiters: Array<{
		resolve: (value: IteratorResult<Uint8Array>) => void;
		reject: (reason?: unknown) => void;
	}> = [];
	private readonly listeners = new Set<
		(state: TransportState, reason?: TransportCloseReason) => void
	>();
	private unsubscribe: (() => void) | undefined;

	constructor(private readonly bridge: DesktopByteBridge) {}

	get state(): TransportState {
		return this.currentState;
	}

	get queuedBytes(): number {
		return 0;
	}

	get bufferedBytes(): number {
		return this.inbound.reduce((total, frame) => total + frame.byteLength, 0);
	}

	get incoming(): AsyncIterable<Uint8Array> {
		return {
			[Symbol.asyncIterator]: () => ({
				next: () => this.next(),
				return: async () => {
					await this.close();
					return { done: true, value: undefined };
				},
			}),
		};
	}

	async open(signal?: AbortSignal): Promise<void> {
		abortIfSignalled(signal);
		if (this.currentState === 'open') return;
		if (this.currentState !== 'opening')
			throw new Error(`Desktop server transport is ${this.currentState}.`);
		this.unsubscribe = this.bridge.subscribe((frame) => {
			if (frame === null) {
				this.fail({
					code: 'protocol_error',
					message: 'Desktop server byte endpoint failed.',
				});
				return;
			}
			try {
				validateTransportFrame(frame, MAX_FRAME_BYTES);
			} catch (cause) {
				this.fail({
					code: 'protocol_error',
					message: 'Desktop server frame is invalid.',
					cause,
				});
				return;
			}
			const waiter = this.waiters.shift();
			if (waiter !== undefined)
				waiter.resolve({ done: false, value: frame.slice() });
			else this.inbound.push(frame.slice());
		});
		this.currentState = 'open';
		this.notify();
	}

	async send(
		frame: Uint8Array,
		options: TransportSendOptions = {},
	): Promise<void> {
		abortIfSignalled(options.signal);
		validateTransportFrame(frame, MAX_FRAME_BYTES);
		if (this.currentState !== 'open')
			throw new Error(`Desktop server transport is ${this.currentState}.`);
		await this.bridge.send(frame.slice());
	}

	async waitForWritable(
		requiredBytes = 1,
		signal?: AbortSignal,
	): Promise<void> {
		abortIfSignalled(signal);
		if (
			!Number.isSafeInteger(requiredBytes) ||
			requiredBytes <= 0 ||
			requiredBytes > MAX_FRAME_BYTES
		)
			throw new RangeError('requiredBytes is out of bounds.');
		if (this.currentState !== 'open')
			throw new Error(`Desktop server transport is ${this.currentState}.`);
	}

	async close(
		reason: TransportCloseReason = { code: 'normal' },
	): Promise<void> {
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return;
		this.currentState = 'closing';
		this.notify(reason);
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.finish();
		this.currentState = 'closed';
		this.notify(reason);
	}

	onStateChange(
		listener: (state: TransportState, reason?: TransportCloseReason) => void,
	): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private next(): Promise<IteratorResult<Uint8Array>> {
		const frame = this.inbound.shift();
		if (frame !== undefined)
			return Promise.resolve({ done: false, value: frame });
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve, reject) =>
			this.waiters.push({ resolve, reject }),
		);
	}

	private fail(reason: TransportCloseReason): void {
		if (this.currentState === 'closed' || this.currentState === 'failed')
			return;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.currentState = 'failed';
		this.finish(
			new Error(reason.message ?? 'Desktop server transport failed.'),
		);
		this.notify(reason);
	}

	private finish(error?: Error): void {
		this.inbound.splice(0);
		for (const waiter of this.waiters.splice(0)) {
			if (error === undefined) waiter.resolve({ done: true, value: undefined });
			else waiter.reject(error);
		}
	}

	private notify(reason?: TransportCloseReason): void {
		for (const listener of this.listeners) listener(this.currentState, reason);
	}
}

export async function acquireDesktopServerBootstrap(
	host: DesktopHostBridge | undefined,
	bytes: DesktopByteBridge | undefined,
): Promise<DesktopServerBootstrap | undefined> {
	if (host === undefined && bytes === undefined) return undefined;
	if (host === undefined || bytes === undefined || bytes.version !== 1)
		throw new Error('Desktop server bootstrap is incomplete.');
	await bytes.replaceEndpoint();
	const context = await host.getContext();
	if (context.hostKind !== 'desktop')
		throw new Error('Desktop server bootstrap has the wrong host kind.');
	return Object.freeze({ context, transport: new DesktopByteTransport(bytes) });
}
