export type SettingsMutationResult<T> = {
	current: boolean;
	error?: unknown;
	pending: number;
	snapshot: T | null;
};

export class SettingsMutationCoordinator<T> {
	private deferredSnapshot: T | null = null;
	private pending = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private revision = 0;

	get isPending(): boolean {
		return this.pending > 0;
	}

	observe(snapshot: T): T | null {
		if (!this.isPending) return snapshot;
		this.deferredSnapshot = snapshot;
		return null;
	}

	async run(
		operation: () => Promise<unknown>,
		read: () => Promise<T>,
	): Promise<SettingsMutationResult<T>> {
		const revision = ++this.revision;
		this.pending += 1;
		const transaction = this.queue.then(async () => {
			let error: unknown;
			try {
				await operation();
			} catch (nextError) {
				error = nextError;
			}
			let snapshot: T | null;
			try {
				snapshot = await read();
			} catch {
				snapshot = this.deferredSnapshot;
			}
			// A change event delivered while the transaction was pending is
			// ordered after the mutation began and may arrive after read()
			// sampled its snapshot. Replay that event before draining.
			if (this.deferredSnapshot !== null) {
				snapshot = this.deferredSnapshot;
				this.deferredSnapshot = null;
			}
			return { error, snapshot };
		});
		this.queue = transaction;
		const { error, snapshot } = await transaction;
		this.pending -= 1;
		const current = revision === this.revision;
		return { current, error, pending: this.pending, snapshot };
	}
}
