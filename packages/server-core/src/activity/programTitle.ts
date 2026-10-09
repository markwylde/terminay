/** The bound a named title has; a program title is truncated to it. */
export const PROGRAM_TITLE_MAX_LENGTH = 256;
export const PROGRAM_TITLE_COMMIT_WINDOW_MS = 250;

// C0, DEL, C1, and the bidirectional override and isolate characters.
const UNSAFE_TITLE_CHARACTERS =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
	/[\u0000-\u0008\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/gu;

/**
 * Reduce a title a program wrote to its terminal to display text. The input is
 * untrusted PTY output (ADR-0056). `undefined` means the program has no title.
 */
export function sanitiseProgramTitle(raw: string): string | undefined {
	// Whitespace controls (tab, line feed, carriage return, ...) survive the
	// first pass only to be collapsed into a single space by the second.
	const text = raw
		.replace(UNSAFE_TITLE_CHARACTERS, '')
		.replace(/\s+/gu, ' ')
		.trim();
	let bounded = '';
	for (const character of text) {
		if (bounded.length + character.length > PROGRAM_TITLE_MAX_LENGTH) break;
		bounded += character;
	}
	bounded = bounded.trimEnd();
	return bounded.length === 0 ? undefined : bounded;
}

export interface ProgramTitleCoalescerOptions {
	/** Commits one terminal's program title; `undefined` clears it. */
	readonly commit: (sessionId: string, title: string | undefined) => void;
	readonly windowMs?: number;
	readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
}

interface PendingTitle {
	timer: unknown;
	/** Present when a title arrived inside the open window. */
	latest?: { readonly title: string | undefined };
}

/**
 * Bounds how often a program can change workspace state by printing: the
 * first title commits at once, and titles inside the following window collapse
 * into one trailing commit of the latest. The timer is one-shot and armed only
 * by output (ADR-0028); a quiet terminal holds no timer and no entry.
 */
export class ProgramTitleCoalescer {
	private readonly pending = new Map<string, PendingTitle>();
	private readonly windowMs: number;
	private readonly scheduleTimeout: (
		handler: () => void,
		milliseconds: number,
	) => unknown;
	private readonly cancelTimeout: (handle: unknown) => void;

	constructor(private readonly options: ProgramTitleCoalescerOptions) {
		this.windowMs = options.windowMs ?? PROGRAM_TITLE_COMMIT_WINDOW_MS;
		this.scheduleTimeout =
			options.setTimeout ??
			((handler, milliseconds) => {
				const timer = setTimeout(handler, milliseconds);
				timer.unref?.();
				return timer;
			});
		this.cancelTimeout =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	push(sessionId: string, title: string | undefined): void {
		const open = this.pending.get(sessionId);
		if (open !== undefined) {
			open.latest = { title };
			return;
		}
		this.arm(sessionId);
		this.options.commit(sessionId, title);
	}

	/** Drop a terminal's uncommitted title, e.g. when its panel closes. */
	forget(sessionId: string): void {
		const open = this.pending.get(sessionId);
		if (open === undefined) return;
		this.cancelTimeout(open.timer);
		this.pending.delete(sessionId);
	}

	dispose(): void {
		for (const sessionId of [...this.pending.keys()]) this.forget(sessionId);
	}

	private arm(sessionId: string): void {
		const entry: PendingTitle = { timer: undefined };
		entry.timer = this.scheduleTimeout(() => {
			this.pending.delete(sessionId);
			if (entry.latest === undefined) return;
			this.arm(sessionId);
			this.options.commit(sessionId, entry.latest.title);
		}, this.windowMs);
		this.pending.set(sessionId, entry);
	}
}
