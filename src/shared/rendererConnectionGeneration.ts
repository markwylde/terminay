export type RendererConnectionAttempt = Readonly<{
	key: string;
	generation: number;
}>;

type DisposableContext = {
	readonly dispose?: () => void | Promise<void>;
};

type ActiveContext<T extends DisposableContext> = Readonly<{
	attempt: RendererConnectionAttempt;
	context: T;
}>;

/**
 * Shared stale-client guard for web and Electron renderers. Async connection
 * attempts may finish out of order; only the newest generation may become the
 * active server context, and losing contexts are disposed immediately.
 */
export class RendererConnectionGeneration<T extends DisposableContext> {
	private generation = 0;
	private currentKey: string | undefined;
	private active: ActiveContext<T> | undefined;
	private activationTail: Promise<void> = Promise.resolve();

	begin(key: string): RendererConnectionAttempt {
		this.generation += 1;
		this.currentKey = key;
		return Object.freeze({ key, generation: this.generation });
	}

	isCurrent(attempt: RendererConnectionAttempt): boolean {
		return attempt.generation === this.generation;
	}

	async activate(attempt: RendererConnectionAttempt, context: T): Promise<boolean> {
		const activation = this.activationTail.then(async () => {
			if (!this.isCurrent(attempt)) {
				await disposeContext(context);
				return false;
			}
			const previous = this.active;
			// Do not expose the candidate as active until replacement disposal has
			// completed and generation ownership has been checked again.
			this.active = undefined;
			if (previous !== undefined && previous.context !== context) {
				await disposeContext(previous.context);
			}
			if (!this.isCurrent(attempt)) {
				await disposeContext(context);
				return false;
			}
			this.active = Object.freeze({ attempt, context });
			return true;
		});
		this.activationTail = activation.then(
			() => undefined,
			() => undefined,
		);
		return activation;
	}

	async disposeActive(key?: string): Promise<void> {
		const current = this.active;
		if (
			key !== undefined &&
			current?.attempt.key !== key &&
			this.currentKey !== key
		) return;
		// Fence both an installed context and a candidate currently waiting for
		// previous-context disposal. The generation changes synchronously so that
		// no pending activation can revive a connection after forget/unmount.
		this.generation += 1;
		this.currentKey = undefined;
		this.active = undefined;
		if (current !== undefined) await disposeContext(current.context);
		await this.activationTail;
	}

	invalidate(key?: string): void {
		if (
			key === undefined ||
			this.active?.attempt.key === key ||
			this.currentKey === key
		) {
			this.generation += 1;
			this.currentKey = undefined;
		}
	}
}

async function disposeContext(context: DisposableContext): Promise<void> {
	try {
		await context.dispose?.();
	} catch {
		// Stale context cleanup must not surface as a renderer-level failure.
	}
}
