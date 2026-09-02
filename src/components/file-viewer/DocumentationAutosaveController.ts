export type DocumentationAutosaveState =
	| 'idle'
	| 'dirty'
	| 'saving'
	| 'saved'
	| 'conflict'
	| 'failed';

export interface DocumentationAutosaveRevision {
	readonly draftRevision: number;
	readonly diskRevision: number;
}

export interface DocumentationAutosaveSession {
	edit(
		text: string,
		expectedDraftRevision: number,
	): Promise<DocumentationAutosaveRevision>;
	save(
		expectedDraftRevision: number,
		expectedDiskRevision: number,
	): Promise<DocumentationAutosaveRevision>;
}

export interface DocumentationAutosaveOptions {
	readonly delayMs?: number;
	readonly setTimeoutFn?: (callback: () => void, ms: number) => number;
	readonly clearTimeoutFn?: (id: number) => void;
}

/** Ordered, one-second documentation autosave around existing edit/save. */
export class DocumentationAutosaveController {
	private newestText: string | undefined;
	private pendingText: string | undefined;
	private draftRevision: number;
	private diskRevision: number;
	private generation = 0;
	private pipeline: Promise<boolean> | undefined;
	private timer: number | undefined;
	private disposed = false;
	private automatic = true;
	private state: DocumentationAutosaveState = 'idle';
	private readonly session: DocumentationAutosaveSession;
	private readonly onState: (
		state: DocumentationAutosaveState,
		error?: unknown,
	) => void;
	private readonly delayMs: number;
	private readonly setTimeoutFn: (callback: () => void, ms: number) => number;
	private readonly clearTimeoutFn: (id: number) => void;

	constructor(
		session: DocumentationAutosaveSession,
		onState: (state: DocumentationAutosaveState, error?: unknown) => void,
		draftRevision = 0,
		diskRevision = 0,
		options: DocumentationAutosaveOptions = {},
	) {
		this.session = session;
		this.onState = onState;
		this.draftRevision = draftRevision;
		this.diskRevision = diskRevision;
		this.delayMs = options.delayMs ?? 1_000;
		this.setTimeoutFn =
			options.setTimeoutFn ??
			((callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number);
		this.clearTimeoutFn =
			options.clearTimeoutFn ?? ((id) => globalThis.clearTimeout(id));
	}

	get currentState(): DocumentationAutosaveState {
		return this.state;
	}

	changed(text: string, initial = false): void {
		if (this.disposed || initial) return;
		this.newestText = text;
		this.pendingText = text;
		this.generation += 1;
		this.setState('dirty');
		if (!this.automatic || this.pipeline !== undefined) return;
		this.arm();
	}

	async flush(): Promise<boolean> {
		if (this.disposed) return this.state !== 'failed' && this.state !== 'conflict';
		this.disarm();
		if (this.pipeline !== undefined) return this.pipeline;
		if (this.pendingText === undefined) return this.state !== 'failed' && this.state !== 'conflict';
		return this.run();
	}

	resolveConflict(kind: 'reload' | 'keep-local', next?: DocumentationAutosaveRevision): void {
		if (kind === 'reload' && next) {
			this.draftRevision = next.draftRevision;
			this.diskRevision = next.diskRevision;
			this.pendingText = undefined;
			this.newestText = undefined;
		}
		this.automatic = true;
		this.setState(this.pendingText === undefined ? 'idle' : 'dirty');
		if (this.pendingText !== undefined) this.arm();
	}

	dispose(): void {
		this.disposed = true;
		this.disarm();
		this.pipeline = undefined;
	}

	private arm(): void {
		this.disarm();
		this.timer = this.setTimeoutFn(() => {
			this.timer = undefined;
			void this.run();
		}, this.delayMs);
	}

	private disarm(): void {
		if (this.timer === undefined) return;
		this.clearTimeoutFn(this.timer);
		this.timer = undefined;
	}

	private run(): Promise<boolean> {
		const text = this.pendingText;
		if (text === undefined || this.pipeline !== undefined) {
			return this.pipeline ?? Promise.resolve(true);
		}
		const started = this.generation;
		this.pendingText = undefined;
		this.setState('saving');
		const pipeline = this.saveText(text)
			.then((ok) => {
				if (this.disposed) return ok;
				if (!ok) return false;
				if (started !== this.generation || this.pendingText !== undefined) {
					this.setState('dirty');
					return true;
				}
				this.setState('saved');
				return true;
			})
			.finally(() => {
				if (this.pipeline === pipeline) this.pipeline = undefined;
				if (
					!this.disposed &&
					this.automatic &&
					this.pendingText !== undefined &&
					this.state !== 'conflict' &&
					this.state !== 'failed'
				) {
					void this.run();
				}
			});
		this.pipeline = pipeline;
		return pipeline;
	}

	private async saveText(text: string): Promise<boolean> {
		try {
			const edited = await this.session.edit(text, this.draftRevision);
			this.draftRevision = edited.draftRevision;
			this.diskRevision = edited.diskRevision;
			const saved = await this.session.save(edited.draftRevision, edited.diskRevision);
			this.draftRevision = saved.draftRevision;
			this.diskRevision = saved.diskRevision;
			return true;
		} catch (error) {
			if (this.disposed) return false;
			this.pendingText = this.newestText;
			this.automatic = false;
			this.setState(isConflict(error) ? 'conflict' : 'failed', error);
			return false;
		}
	}

	private setState(state: DocumentationAutosaveState, error?: unknown): void {
		this.state = state;
		this.onState(state, error);
	}
}

function isConflict(error: unknown): boolean {
	return /conflict|reload|keep local|stale|revision/iu.test(
		error instanceof Error ? error.message : String(error),
	);
}
