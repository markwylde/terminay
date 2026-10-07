/**
 * A byte-bounded queue of output chunks whose cost per chunk does not depend
 * on what it already holds (ADR-0044).
 *
 * The byte total is maintained as chunks enter and leave, never recomputed,
 * and eviction advances a head index instead of shifting the array, so a
 * terminal that delivers a megabyte as tens of thousands of tiny chunks pays
 * the same per chunk as one that delivers it as a few hundred.
 *
 * The two retention rules differ only in what the bound promises:
 *
 * - `within-bound` never holds more than the bound. Whole chunks leave until
 *   the total fits, so the queue may hold slightly less than the bound.
 * - `cover-bound` always holds at least the most recent bytes up to the bound.
 *   A chunk leaves only once the chunks after it cover the bound on their own,
 *   and `readTail` trims the oldest survivor to return exactly those bytes.
 */
export type BoundedChunkRetention = 'within-bound' | 'cover-bound';

export interface ByteChunk {
	readonly bytes: Uint8Array;
}

/** Below this many dead entries the backing array is never worth compacting. */
const MIN_COMPACTION_ENTRIES = 32;

export class BoundedChunkQueue<T extends ByteChunk> implements Iterable<T> {
	private chunks: T[] = [];
	private head = 0;
	private total = 0;

	constructor(
		readonly maxBytes: number,
		private readonly retention: BoundedChunkRetention,
	) {
		if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
			throw new RangeError('maxBytes must be a positive safe integer');
	}

	/** Bytes currently retained. */
	get byteLength(): number {
		return this.total;
	}

	/** Chunks currently retained. */
	get length(): number {
		return this.chunks.length - this.head;
	}

	/** The oldest retained chunk. */
	get first(): T | undefined {
		return this.chunks[this.head];
	}

	push(chunk: T): void {
		this.chunks.push(chunk);
		this.total += chunk.bytes.byteLength;
		if (this.retention === 'within-bound') {
			while (this.total > this.maxBytes && this.head < this.chunks.length)
				this.evict();
		} else {
			for (;;) {
				const oldest = this.chunks[this.head];
				if (
					oldest === undefined ||
					this.total - oldest.bytes.byteLength < this.maxBytes
				)
					break;
				this.evict();
			}
		}
		// Reclaim the dead prefix once it is most of the array. Each compaction
		// is paid for by the evictions that made it necessary.
		if (
			this.head >= MIN_COMPACTION_ENTRIES &&
			this.head * 2 >= this.chunks.length
		) {
			this.chunks = this.chunks.slice(this.head);
			this.head = 0;
		}
	}

	/**
	 * The most recent retained bytes, up to `maxBytes`, as one contiguous
	 * value. This is the only operation proportional to what is retained.
	 */
	readTail(maxBytes: number = this.maxBytes): Uint8Array {
		const size = Math.max(0, Math.min(maxBytes, this.total));
		const bytes = new Uint8Array(size);
		let end = size;
		for (let index = this.chunks.length - 1; index >= this.head; index -= 1) {
			if (end === 0) break;
			const chunk = this.chunks[index]!.bytes;
			const take = Math.min(end, chunk.byteLength);
			bytes.set(chunk.subarray(chunk.byteLength - take), end - take);
			end -= take;
		}
		return bytes;
	}

	*[Symbol.iterator](): IterableIterator<T> {
		for (let index = this.head; index < this.chunks.length; index += 1)
			yield this.chunks[index]!;
	}

	private evict(): void {
		const chunk = this.chunks[this.head]!;
		// Drop the reference now; the slot itself is reclaimed by compaction.
		this.chunks[this.head] = undefined as unknown as T;
		this.head += 1;
		this.total -= chunk.bytes.byteLength;
	}
}
