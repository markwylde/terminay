import type { BotBuildProgress } from '@terminay/protocol';

type Send = (buildId: string) => Promise<void>;

/**
 * Ready notices the user has dismissed in this window. The server owns the
 * acknowledgement; this hides a notice at once and delivers it, again on a
 * later status if the server did not record it. Nothing is stored or timed.
 */
export function createBuildAcknowledgements() {
	const hidden = new Set<string>();
	const sending = new Set<string>();
	const listeners = new Set<() => void>();
	const deliver = (buildId: string, send: Send) => {
		if (sending.has(buildId)) return;
		sending.add(buildId);
		void send(buildId)
			.catch(() => {
				/* The next status that lacks it sends it again. */
			})
			.finally(() => sending.delete(buildId));
	};
	return {
		subscribe(listener: () => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		isHidden: (buildId: string): boolean => hidden.has(buildId),
		/** The user dismissed the notice, or saw it and left. */
		acknowledge(buildId: string, send: Send): void {
			hidden.add(buildId);
			for (const listener of listeners) listener();
			deliver(buildId, send);
		},
		/** A status arrived: resend what the server does not report. */
		reconcile(
			build: Pick<BotBuildProgress, 'id' | 'state' | 'acknowledged'>,
			send: Send,
		): void {
			if (
				build.state === 'completed' &&
				!build.acknowledged &&
				hidden.has(build.id)
			)
				deliver(build.id, send);
		},
	};
}

/** A build id is meaningful only on the server that issued it. */
const servers = new Map<
	string | undefined,
	ReturnType<typeof createBuildAcknowledgements>
>();
export function buildAcknowledgementsFor(serverId: string | undefined) {
	let store = servers.get(serverId);
	if (!store) {
		store = createBuildAcknowledgements();
		servers.set(serverId, store);
	}
	return store;
}
