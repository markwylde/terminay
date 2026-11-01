import { abortError } from './abort.js';
import { ClientError, RequestNotSentError } from './types.js';

const MAX_OUTSTANDING_REQUESTS = 128;
const MAX_WAITING_REQUESTS = 4096;
interface WaitingRequest {
	readonly bytes: number;
	readonly resolve: (release: () => void) => void;
	readonly reject: (error: unknown) => void;
	cleanup: () => void;
}

/** Bound feature bursts before the wire; heartbeat/cancel do not enter here. */
export class RequestAdmission {
	private outstanding = 0;
	private outstandingBytes = 0;
	private waitingBytes = 0;
	private readonly waiting: WaitingRequest[] = [];
	private readonly byteBudget: () => number;

	constructor(byteBudget: () => number) {
		this.byteBudget = byteBudget;
	}

	acquire(
		bytes: number,
		signal?: AbortSignal,
		deadline?: number,
	): (() => void) | Promise<() => void> {
		if (signal?.aborted)
			return Promise.reject(
				abortError(signal),
			);
		if (deadline !== undefined && deadline <= Date.now())
			return Promise.reject(
				new ClientError('deadline', 'request deadline exceeded before send'),
			);
		if (bytes > this.byteBudget())
			return Promise.reject(
				new ClientError(
					'resource',
					'request exceeds the connection admission budget',
				),
			);
		if (this.waiting.length === 0 && this.canAdmit(bytes))
			return this.reserve(bytes);
		if (
			this.waiting.length >= MAX_WAITING_REQUESTS ||
			this.waitingBytes + bytes > this.byteBudget()
		)
			return Promise.reject(
				new ClientError(
					'resource',
					'pending request admission capacity reached',
				),
			);
		return new Promise((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const entry: WaitingRequest = {
				bytes,
				resolve,
				reject,
				cleanup: () => {
					if (timer !== undefined) clearTimeout(timer);
					signal?.removeEventListener('abort', abort);
				},
			};
			const remove = (error: unknown) => {
				const index = this.waiting.indexOf(entry);
				if (index < 0) return;
				this.waiting.splice(index, 1);
				this.waitingBytes -= bytes;
				entry.cleanup();
				reject(error);
				this.drain();
			};
			const abort = () =>
				remove(
					abortError(signal),
				);
			const armDeadline = () => {
				if (deadline === undefined) return;
				timer = setTimeout(
					() => {
						if (deadline > Date.now()) {
							armDeadline();
							return;
						}
						remove(
							new ClientError(
								'deadline',
								'request deadline exceeded before send',
							),
						);
					},
					Math.max(0, Math.min(2147483647, deadline - Date.now())),
				);
			};
			this.waiting.push(entry);
			this.waitingBytes += bytes;
			signal?.addEventListener('abort', abort, { once: true });
			armDeadline();
		});
	}

	/** All queued frames are definitively unsent, unlike outstanding commands. */
	clear(): void {
		for (const entry of this.waiting.splice(0)) {
			entry.cleanup();
			entry.reject(
				new RequestNotSentError(),
			);
		}
		this.waitingBytes = 0;
	}

	private canAdmit(bytes: number): boolean {
		return (
			this.outstanding < MAX_OUTSTANDING_REQUESTS &&
			this.outstandingBytes + bytes <= this.byteBudget()
		);
	}

	private reserve(bytes: number): () => void {
		this.outstanding++;
		this.outstandingBytes += bytes;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.outstanding--;
			this.outstandingBytes -= bytes;
			this.drain();
		};
	}

	private drain(): void {
		while (this.waiting.length > 0 && this.canAdmit(this.waiting[0]!.bytes)) {
			const entry = this.waiting.shift()!;
			this.waitingBytes -= entry.bytes;
			entry.cleanup();
			entry.resolve(this.reserve(entry.bytes));
		}
	}
}
