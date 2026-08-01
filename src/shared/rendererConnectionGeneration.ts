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
	private active: ActiveContext<T> | undefined;

	begin(key: string): RendererConnectionAttempt {
		this.generation += 1;
		return Object.freeze({ key, generation: this.generation });
	}

	isCurrent(attempt: RendererConnectionAttempt): boolean {
		return attempt.generation === this.generation;
	}

	async activate(attempt: RendererConnectionAttempt, context: T): Promise<boolean> {
		if (!this.isCurrent(attempt)) {
			await disposeContext(context);
			return false;
		}
		const previous = this.active;
		this.active = Object.freeze({ attempt, context });
		if (previous !== undefined && previous.context !== context) {
			await disposeContext(previous.context);
		}
		return true;
	}

	async disposeActive(key?: string): Promise<void> {
		const current = this.active;
		if (current === undefined) return;
		if (key !== undefined && current.attempt.key !== key) return;
		this.generation += 1;
		this.active = undefined;
		await disposeContext(current.context);
	}

	invalidate(key?: string): void {
		if (key === undefined || this.active?.attempt.key === key) {
			this.generation += 1;
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
