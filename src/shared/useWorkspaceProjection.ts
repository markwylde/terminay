import {
	createContext,
	useCallback,
	useContext,
	useRef,
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

/** One project as the projection holds it: the project, and the folders and
 * panels it lists. */
export type WorkspaceProjectSlice = Readonly<{
	project: ServerWorkspaceSnapshot['projects'][string] | undefined;
	folders: readonly (ServerWorkspaceSnapshot['folders'][string] | undefined)[];
	panels: readonly (ServerWorkspaceSnapshot['panels'][string] | undefined)[];
}>;

const NO_PROJECT_SLICE: WorkspaceProjectSlice = Object.freeze({
	project: undefined,
	folders: Object.freeze([]),
	panels: Object.freeze([]),
});

function sameMembers(
	left: readonly unknown[],
	right: readonly unknown[],
): boolean {
	return (
		left.length === right.length &&
		left.every((member, index) => member === right[index])
	);
}

/**
 * The part of the projection that belongs to one project, and a render only
 * when that part changes. A project's own objects keep their identity across
 * a change that concerned another project (ADR-0059), so the slice returned is
 * the one returned before until this project, one of its folders, or one of
 * its panels is a different object.
 */
export function useWorkspaceProjectSlice(
	store: WorkspaceSnapshotStore | undefined,
	projectId: string,
): WorkspaceProjectSlice {
	const held = useRef<{
		snapshot: ServerWorkspaceSnapshot | null;
		projectId: string;
		slice: WorkspaceProjectSlice;
	} | null>(null);
	const subscribe = useCallback(
		(notify: () => void) => store?.subscribeAny(notify) ?? unsubscribed,
		[store],
	);
	const read = (): WorkspaceProjectSlice => {
		const snapshot = store?.snapshot ?? null;
		const cached = held.current;
		if (
			cached !== null &&
			cached.snapshot === snapshot &&
			cached.projectId === projectId
		)
			return cached.slice;
		const project = snapshot?.projects[projectId];
		const next: WorkspaceProjectSlice =
			snapshot === null || project === undefined
				? NO_PROJECT_SLICE
				: {
						project,
						folders: project.folderIds.map((id) => snapshot.folders[id]),
						panels: project.panelIds.map((id) => snapshot.panels[id]),
					};
		const slice =
			cached !== null &&
			cached.projectId === projectId &&
			cached.slice.project === next.project &&
			sameMembers(cached.slice.folders, next.folders) &&
			sameMembers(cached.slice.panels, next.panels)
				? cached.slice
				: next;
		held.current = { snapshot, projectId, slice };
		return slice;
	};
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
