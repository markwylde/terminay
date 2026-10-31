import { isStateUnreadableError } from '@terminay/server-core';

/** The canonical store a startup failure could not read, when that is why it
 * failed: a StateUnreadableError, or a repository error caused by one. */
export function unreadableStateStore(error: unknown): string | undefined {
	if (isStateUnreadableError(error)) return error.store;
	const cause = (error as { cause?: unknown } | null)?.cause;
	if (isStateUnreadableError(cause)) return cause.store;
	const store = (error as { store?: unknown } | null)?.store;
	return typeof store === 'string' && store.length > 0 ? store : undefined;
}

/**
 * What a standalone server tells its operator when a canonical store is
 * corrupt and has no good `.previous` copy (ADR-0088). A server never starts
 * such a store fresh on its own; the operator moves the file aside. Names the
 * store only, never a path or its bytes.
 */
export function describeUnreadableState(store: string): string {
	return [
		`Terminay server did not start: its saved ${store} state is unreadable and has no good earlier copy.`,
		'The files are left exactly as they are.',
		'To start that state fresh, stop the server, move the file aside, and start again.',
		'See "Starting a corrupt store fresh" in docs/operations/standalone-server.md.',
		'',
	].join('\n');
}
