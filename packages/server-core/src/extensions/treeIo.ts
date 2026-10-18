/**
 * Run `task` over `items` with at most `limit` in flight.
 *
 * An extension tree is hundreds of small files. Copying or hashing them one
 * at a time left the file system and the crypto thread pool idle between
 * each, and that wait sat on the path to the first window.
 */
export async function forEachConcurrently<T>(
	items: readonly T[],
	limit: number,
	task: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failed = false;
	const worker = async (): Promise<void> => {
		while (!failed && next < items.length) {
			const item = items[next] as T;
			next += 1;
			try {
				await task(item);
			} catch (error) {
				failed = true;
				throw error;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
}

/** How many files of one tree are read, written, or hashed at once. */
export const TREE_IO_CONCURRENCY = 16;

/** SHA-256 on the crypto thread pool rather than the calling thread. */
export async function sha256Hex(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
	return Buffer.from(
		await globalThis.crypto.subtle.digest('SHA-256', bytes),
	).toString('hex');
}
