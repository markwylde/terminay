import type { TerminalStreamEvent, TerminalStreamSkipEvent } from './terminal.js';
import { isRecoverableSkip } from './terminal.js';
import { recordTerminalStreamDiagnostic } from './streamDiagnostics.js';

/**
 * The terminal panel's recovery state machine.
 *
 * A skip tells a display that the server has advanced the stream past bytes it
 * will never send. The only cure is to re-attach from a fresh checkpoint, so
 * this is the component that decides when that happens.
 *
 * It exists as its own module for one reason: the previous implementation was a
 * `resyncing` boolean inside the panel, cleared in exactly one place — the body
 * of the retry timer, behind a guard that could decline to run:
 *
 *     if (disposed || !resyncing || panelAttachment !== null) return;
 *     resyncing = false;
 *
 * When that guard returned, the flag stayed set. Every later skip was then
 * dropped by `if (resyncing) return` at the entry point, and the terminal could
 * never recover again. It kept its connection, kept accepting keystrokes, and
 * reported no error, because nothing had failed: a boolean was stuck. Only a
 * reload cleared it.
 *
 * The invariant that replaces it, and that the tests pin:
 *
 *   **A recoverable skip is never ignored unless a re-attach is already pending
 *   for it.** Every path out of `recovering` either starts that re-attach or
 *   returns to `streaming`, where the next skip is honoured. No exit leaves the
 *   controller unable to recover.
 *
 * Deciding *whether* a given attach should proceed belongs to the caller, which
 * owns binding fences and attachment lifetime. This controller only guarantees
 * it is asked, and that declining an attempt re-arms recovery rather than
 * ending it.
 */

export type TerminalRecoveryState = 'streaming' | 'recovering' | 'disposed';

/** What the caller decided when the controller asked it to re-attach. */
export type TerminalRecoveryAttemptOutcome =
	/** A re-attach was started. The controller waits for `noteAttached`. */
	| 'attaching'
	/** The caller declined this attempt. The controller returns to `streaming`
	 * so a later skip can try again, rather than latching shut. */
	| 'declined';

export interface TerminalRecoveryOptions {
	/** How long to wait before re-attaching. A display that never falls idle
	 * would otherwise re-attach into the same congestion it just escaped. */
	readonly retryDelayMs: number;
	/** Injected so tests drive recovery on a fake clock instead of real time. */
	readonly schedule: (run: () => void, delayMs: number) => () => void;
	readonly reattach: (attempt: number) => TerminalRecoveryAttemptOutcome;
	readonly onRecoveryStarted?: (
		attempt: number,
		event: TerminalStreamSkipEvent,
	) => void;
	readonly onRecovered?: (attempt: number, elapsedMs: number) => void;
	readonly now?: () => number;
	readonly onHydrationConvergenceExhausted?: () => void;
}

export class TerminalRecoveryController {
	private stateValue: TerminalRecoveryState = 'streaming';
	private attemptValue = 0;
	private startedAt = 0;
	private cancelScheduled: (() => void) | undefined;
	private readonly now: () => number;
	private hydrationGap: TerminalStreamSkipEvent | undefined;
	private convergenceAttempts = 0;
	private cancelConvergence: (() => void) | undefined;
	private attached = false;
	private sawHydrationGap = false;

	constructor(private readonly options: TerminalRecoveryOptions) {
		this.now = options.now ?? (() => Date.now());
	}

	get state(): TerminalRecoveryState {
		return this.stateValue;
	}

	/** Recovery attempts since the stream was last healthy. Zero while streaming
	 * normally, so the caller can distinguish a first attach from a recovery. */
	get attempt(): number {
		return this.attemptValue;
	}

	/**
	 * Offer a stream event. Returns true when this event started a recovery.
	 *
	 * A skip arriving while a re-attach is already pending is redundant rather
	 * than ignored: the pending attach starts from a fresh checkpoint and so
	 * already covers the newer gap.
	 */
	noteEvent(event: TerminalStreamEvent): boolean {
		if (this.stateValue !== 'streaming') return false;
		if (!isRecoverableSkip(event)) return false;
		return this.beginRecovery(event as TerminalStreamSkipEvent);
	}

	/** Observe current-binding arrivals before renderer work, so ongoing output
	 * defers convergence even while xterm is still rendering prior chunks. */
	noteStreamProgress(event: TerminalStreamEvent): void {
		if (this.stateValue === 'disposed') return;
		if (event.type === 'exit') { this.clearConvergence(); return; }
		if (event.type === 'skip' && event.reason === 'hydration') { this.hydrationGap = event; this.sawHydrationGap = true; }
		else if (event.type !== 'output') return;
		this.scheduleConvergence();
	}

	private scheduleConvergence(): void {
		this.cancelConvergence?.();
		this.cancelConvergence = undefined;
		if (!this.attached || this.stateValue !== 'streaming') return;
		if (!this.hydrationGap) {
			if (this.convergenceAttempts > 0) this.cancelConvergence = this.options.schedule(() => {
				this.cancelConvergence = undefined;
				if (!this.hydrationGap && this.attached && this.stateValue === 'streaming') this.convergenceAttempts = 0;
			}, 500);
			return;
		}
		this.cancelConvergence = this.options.schedule(() => {
			this.cancelConvergence = undefined;
			const gap = this.hydrationGap;
			if (!gap || !this.attached || this.stateValue !== 'streaming') return;
			if (this.convergenceAttempts >= 3) {
				this.hydrationGap = undefined;
				recordTerminalStreamDiagnostic('hydration_convergence_exhausted');
				this.options.onHydrationConvergenceExhausted?.();
				return;
			}
			this.convergenceAttempts += 1;
			recordTerminalStreamDiagnostic('hydration_convergence_refresh', { attempt: this.convergenceAttempts });
			this.beginRecovery(gap);
		}, 500 * (2 ** this.convergenceAttempts));
	}

	/** The caller's attach completed and the display is live again. */
	noteAttached(options: { readonly freshPresentation?: boolean } = {}): void {
		if (this.stateValue === 'disposed') return;
		this.cancelPending();
		if (this.attemptValue > 0) {
			this.options.onRecovered?.(this.attemptValue, this.now() - this.startedAt);
			recordTerminalStreamDiagnostic('recovery_completed', {
				attempts: this.attemptValue,
				elapsedMs: this.now() - this.startedAt,
			});
		}
		this.stateValue = 'streaming';
		this.attemptValue = 0;
		this.startedAt = 0;
		this.attached = true;
		if (options.freshPresentation !== false && !this.sawHydrationGap) this.hydrationGap = undefined;
		this.scheduleConvergence();
	}

	/**
	 * The caller's attach failed. Recovery re-arms rather than ending, because a
	 * failed re-attach leaves the display exactly as stuck as the skip did.
	 */
	noteAttachFailed(): void {
		if (this.stateValue === 'disposed') return;
		this.cancelPending();
		this.stateValue = 'streaming';
		recordTerminalStreamDiagnostic('recovery_attach_failed', {
			attempts: this.attemptValue,
		});
	}

	/** Transport-level restarts own the attachment outright; recovery yields. */
	reset(options: { readonly renewConvergenceBudget?: boolean } = {}): void {
		if (this.stateValue === 'disposed') return;
		this.cancelPending();
		if (options.renewConvergenceBudget) this.convergenceAttempts = 0;
		this.stateValue = 'streaming';
		this.attemptValue = 0;
		this.startedAt = 0;
		this.cancelConvergence?.();
		this.cancelConvergence = undefined;
		this.attached = false;
		this.sawHydrationGap = false;
	}

	dispose(): void {
		this.cancelPending();
		this.clearConvergence();
		this.stateValue = 'disposed';
	}

	private clearConvergence(): void {
		this.cancelConvergence?.();
		this.cancelConvergence = undefined;
		this.hydrationGap = undefined;
		this.convergenceAttempts = 0;
		this.attached = false;
		this.sawHydrationGap = false;
	}

	private beginRecovery(event: TerminalStreamSkipEvent): boolean {
		this.cancelConvergence?.();
		this.cancelConvergence = undefined;
		this.sawHydrationGap = false;
		this.attached = false;
		if (this.attemptValue === 0) this.startedAt = this.now();
		this.attemptValue += 1;
		this.stateValue = 'recovering';
		this.options.onRecoveryStarted?.(this.attemptValue, event);
		recordTerminalStreamDiagnostic('recovery_started', {
			attempt: this.attemptValue,
			reason: event.reason,
			fromPosition: event.fromPosition,
			toPosition: event.toPosition,
		});
		this.cancelScheduled = this.options.schedule(() => {
			this.cancelScheduled = undefined;
			if (this.stateValue !== 'recovering') return;
			// Whatever the caller decides, the controller must not stay in
			// `recovering` without a pending attach. Declining returns to
			// `streaming` so the next skip is honoured.
			let outcome: TerminalRecoveryAttemptOutcome;
			try {
				outcome = this.options.reattach(this.attemptValue);
			} catch (error) {
				this.stateValue = 'streaming';
				recordTerminalStreamDiagnostic('recovery_attach_threw', {
					attempts: this.attemptValue,
					message: error instanceof Error ? error.message : String(error),
				});
				return;
			}
			if (outcome !== 'attaching') this.stateValue = 'streaming';
		}, this.options.retryDelayMs);
		return true;
	}

	private cancelPending(): void {
		this.cancelScheduled?.();
		this.cancelScheduled = undefined;
	}
}
