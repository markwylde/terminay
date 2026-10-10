import { useCallback, useSyncExternalStore } from 'react';
import type { ServerWorkspaceSnapshot } from './serverWorkspaceReconciliation';
import type { TerminalTitleStore } from './TerminalTitleStore';
import type { WorkspaceSnapshotStore } from './WorkspaceSnapshotStore';

const unsubscribed = (): void => undefined;

/**
 * Read one part of a connection's workspace projection, and render again only
 * when that part changes.
 *
 * `select` must return a value the projection holds (a project, a panel, an
 * id list) or a primitive. A projection keeps the identity of everything a
 * change left alone (ADR-0059), so such a value is the same value until it
 * really changes. A selector that builds a new object on each call would make
 * every projection look like a change, and React would say so.
 */
export function useWorkspaceSelection<T>(
	store: WorkspaceSnapshotStore | undefined,
	select: (snapshot: ServerWorkspaceSnapshot | null) => T,
): T {
	const subscribe = useCallback(
		(notify: () => void) => store?.subscribeAny(notify) ?? unsubscribed,
		[store],
	);
	const read = (): T => select(store?.snapshot ?? null);
	return useSyncExternalStore(subscribe, read, read);
}

/**
 * The title a terminal displays: the one the server published for it, or
 * `fallback` (the title the workspace projection holds) until one arrives or
 * when the server publishes none. Renders again only when this terminal's
 * title changes.
 */
export function useTerminalTitle(
	store: TerminalTitleStore | undefined,
	panelId: string | undefined,
	fallback: string | undefined,
): string | undefined {
	const subscribe = useCallback(
		(notify: () => void) =>
			store === undefined || panelId === undefined
				? unsubscribed
				: store.subscribe(panelId, notify),
		[store, panelId],
	);
	const read = (): string | undefined =>
		(panelId === undefined ? undefined : store?.title(panelId)) ?? fallback;
	return useSyncExternalStore(subscribe, read, read);
}
