type PendingAcknowledgement = { trailing: boolean };

/** Preserve a trailing interaction without retaining one RPC for every key. */
export class CoalescedSessionAcknowledgements {
	private readonly pending = new Map<string, PendingAcknowledgement>();
	private readonly send: (sessionId: string) => unknown | Promise<unknown>;

	constructor(send: (sessionId: string) => unknown | Promise<unknown>) {
		this.send = send;
	}

	acknowledge(sessionId: string): void {
		const current = this.pending.get(sessionId);
		if (current !== undefined) {
			current.trailing = true;
			return;
		}
		const pending = { trailing: false };
		this.pending.set(sessionId, pending);
		void this.deliver(sessionId, pending);
	}

	/** Cancel unsent trailing work when a view leaves; in-flight RPCs settle. */
	clear(): void {
		this.pending.clear();
	}

	private async deliver(
		sessionId: string,
		pending: PendingAcknowledgement,
	): Promise<void> {
		try {
			do {
				pending.trailing = false;
				try {
					await this.send(sessionId);
				} catch {
					/* attention must not fail terminal input */
				}
			} while (this.pending.get(sessionId) === pending && pending.trailing);
		} finally {
			if (this.pending.get(sessionId) === pending)
				this.pending.delete(sessionId);
		}
	}
}
