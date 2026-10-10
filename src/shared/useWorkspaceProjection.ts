import {
	createContext,
	useCallback,
	useContext,
	useSyncExternalStore,
} from 'react';
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

/**
 * The title store of the connection a window presents. Lists that name
 * terminals (the folders tree, the dashboard, the switcher, the notifications
 * menu, the status bar) sit far from the connection and read it from here.
 */
export const TerminalTitleStoreContext = createContext<
	TerminalTitleStore | undefined
>(undefined);

/**
 * The title a terminal displays now. `fallback` is the title a row was built
 * with: rows are built when their list changes, and a title changes far more
 * often than that, so the text is read live and only this caller renders
 * again when it changes.
 */
export function useLiveTerminalTitle(
	panelId: string | undefined,
	fallback: string | undefined,
): string | undefined {
	return useTerminalTitle(
		useContext(TerminalTitleStoreContext),
		panelId,
		fallback,
	);
}

/** A terminal's title as text that follows the terminal. */
export function LiveTerminalTitle({
	panelId,
	fallback,
}: {
	panelId: string | undefined;
	fallback: string;
}) {
	// Text only: the caller owns the element around it and its class.
	return useLiveTerminalTitle(panelId, fallback) ?? fallback;
}
