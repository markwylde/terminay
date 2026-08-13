export type PairingIntent = Readonly<{ revision: number }>;

/** Cancellation token for the unauthenticated, pre-profile enrollment form.
 * It deliberately cannot carry a profile identity or publish connection state. */
export class PairingIntentController {
	private revision = 0;

	begin(): PairingIntent {
		this.revision += 1;
		return Object.freeze({ revision: this.revision });
	}

	isCurrent(intent: PairingIntent): boolean {
		return intent.revision === this.revision;
	}

	cancel(): void {
		this.revision += 1;
	}
}
