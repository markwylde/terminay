export type TerminalPanelBinding = Readonly<{ generation: number }>;

/**
 * Owns the single terminal attachment generation allowed to mutate a mounted
 * panel. Async work retains its binding token and must prove it is still
 * current before committing renderer state.
 */
export class TerminalPanelBindingFence {
	private generation = 0;
	private current: TerminalPanelBinding | null = null;

	begin(): TerminalPanelBinding {
		const binding = { generation: ++this.generation };
		this.current = binding;
		return binding;
	}

	isCurrent(binding: TerminalPanelBinding): boolean {
		return this.current === binding;
	}

	retire(binding?: TerminalPanelBinding): void {
		if (binding === undefined || this.current === binding) {
			this.current = null;
		}
	}
}

/**
 * Retry is hidden only when there is nothing to retry: the terminal exited or
 * was interrupted. A refused presentation is retryable — Retry asks for a
 * fresh presentation — so `presentationUnavailable` alone never hides it. It
 * used to, which left a reconnected phone on a dead error with no way out.
 */
export function isTerminalRetryActionable(
	state: Readonly<{ presentationUnavailable: boolean; sessionEnded: boolean }>,
): boolean {
	return !state.sessionEnded;
}
