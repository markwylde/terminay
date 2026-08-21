export type DocumentationAutosaveState =
	| 'dirty'
	| 'saving'
	| 'saved'
	| 'conflict'
	| 'failed';

/** Ordered, one-second documentation autosave. A later edit is never folded
 * into an in-flight revision: it is queued and saved after the current server
 * revision completes. Explicit close/blur flushes the same queue. */
export class DocumentationAutosaveController {
	private pending = false;
	private saving: Promise<boolean> | undefined;
	private timer: number | undefined;
	private readonly save: () => Promise<void>;
	private readonly onState: (state: DocumentationAutosaveState, error?: unknown) => void;
	private readonly delayMs: number;
	constructor(
		save: () => Promise<void>,
		onState: (state: DocumentationAutosaveState, error?: unknown) => void,
		delayMs = 1_000,
	) { this.save = save; this.onState = onState; this.delayMs = delayMs; }

	changed(): void {
		this.pending = true;
		this.onState('dirty');
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = undefined;
			void this.flush();
		}, this.delayMs);
	}

	async flush(): Promise<boolean> {
		if (this.timer !== undefined) {
			window.clearTimeout(this.timer);
			this.timer = undefined;
		}
		if (this.saving !== undefined) return this.saving;
		if (!this.pending) return true;
		this.pending = false;
		this.onState('saving');
		const run = this.save()
			.then(() => {
				this.onState(this.pending ? 'dirty' : 'saved');
				return true;
			})
			.catch((error: unknown) => {
				// A conflict/failure must not spin an automatic retry loop. The
				// document remains locally dirty; a subsequent user edit/explicit
				// conflict action schedules the next revision.
				this.pending = false;
				this.onState(/conflict|reload|keep local/iu.test(error instanceof Error ? error.message : String(error)) ? 'conflict' : 'failed', error);
				return false;
			})
			.finally(() => {
				this.saving = undefined;
				if (this.pending && this.timer === undefined) {
					this.timer = window.setTimeout(() => { this.timer = undefined; void this.flush(); }, this.delayMs);
				}
			});
		this.saving = run;
		return run;
	}

	dispose(): void {
		if (this.timer !== undefined) window.clearTimeout(this.timer);
		this.timer = undefined;
	}
}
