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

export function isTerminalRetryActionable(
	presentationUnavailable: boolean,
): boolean {
	return !presentationUnavailable;
}
