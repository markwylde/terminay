/**
 * The window's one server-upgrade board, held above the workspace.
 *
 * The workspace is mounted afresh on every reconnect, and an upgrade is a
 * reconnect by design. The board lives here instead, inside the connections
 * provider that outlives each workspace: it is synced from the window's
 * connections whether or not a workspace is mounted, so the ticklist moves
 * through the restart that takes the workspace away.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import { useConnections } from '../shared/connections';
import { ServerUpgradeProgress } from './ServerUpgradeProgress.tsx';
import {
	createServerUpgradeMemory,
	ServerUpgradeBoard,
	type ServerUpgradeBoardSnapshot,
	type ServerUpgradeProgressView,
	serverUpgradeSources,
} from './serverUpgradeModel.ts';

const ServerUpgradeBoardContext = createContext<ServerUpgradeBoard | undefined>(
	undefined,
);

/** The board a host provides, when one does. */
export function useProvidedServerUpgradeBoard():
	| ServerUpgradeBoard
	| undefined {
	return useContext(ServerUpgradeBoardContext);
}

export function useServerUpgradeBoardSnapshot(
	board: ServerUpgradeBoard,
): ServerUpgradeBoardSnapshot {
	return useSyncExternalStore(
		useCallback((listener) => board.subscribe(listener), [board]),
		useCallback(() => board.snapshot, [board]),
		useCallback(() => board.snapshot, [board]),
	);
}

/** Owns, syncs and disposes the window's board, and provides it. */
export function ServerUpgradeBoardHost({
	children,
}: Readonly<{ children: ReactNode }>) {
	const [board] = useState(
		() => new ServerUpgradeBoard({ memory: createServerUpgradeMemory() }),
	);
	const { connections, profiles } = useConnections();
	const sources = useMemo(
		() => serverUpgradeSources(connections, profiles),
		[connections, profiles],
	);
	useEffect(() => {
		board.sync(sources);
	}, [board, sources]);
	useEffect(() => () => board.dispose(), [board]);
	return (
		<ServerUpgradeBoardContext.Provider value={board}>
			{children}
		</ServerUpgradeBoardContext.Provider>
	);
}

/** The followed upgrade of one connection, if any. */
export function useServerUpgradeProgress(
	profileId: string | undefined,
): ServerUpgradeProgressView | undefined {
	const board = useProvidedServerUpgradeBoard();
	const snapshot = useServerUpgradeBoardSnapshot(board ?? FALLBACK_BOARD);
	if (board === undefined || profileId === undefined) return undefined;
	return snapshot.progress.find((progress) => progress.profileId === profileId);
}

/** Never synced: stands in where no host provides a board. */
const FALLBACK_BOARD = new ServerUpgradeBoard();

/**
 * Whether the reconnecting overlay shows the ticklist in place of its own
 * text: while the window's server restarts for an upgrade it follows, and,
 * on the device that asked for it, for as long as the card is up.
 */
export function overlayShowsUpgrade(
	progress: ServerUpgradeProgressView | undefined,
): progress is ServerUpgradeProgressView {
	if (progress === undefined) return false;
	// Once it has ended, a card that was hidden stays hidden: a later drop for
	// any other reason is an ordinary reconnect.
	return (
		progress.outcome === undefined ||
		(progress.initiatedHere && !progress.hidden)
	);
}

/** The ticklist inside the reconnecting overlay. */
export function ServerUpgradeOverlayProgress({
	progress,
}: Readonly<{ progress: ServerUpgradeProgressView }>) {
	const board = useProvidedServerUpgradeBoard();
	return (
		<ServerUpgradeProgress
			progress={progress}
			placement="overlay"
			{...(progress.outcome !== undefined && board !== undefined
				? { onClose: () => board.closeProgress(progress.profileId) }
				: {})}
		/>
	);
}

/**
 * The ticklist over a usable workspace, on the device that asked for the
 * upgrade, until it is hidden or, once it has ended, closed.
 */
export function ServerUpgradeFloatingProgress({
	profileId,
	reconnecting,
}: Readonly<{ profileId: string | undefined; reconnecting: boolean }>) {
	const board = useProvidedServerUpgradeBoard();
	const progress = useServerUpgradeProgress(profileId);
	if (board === undefined || progress === undefined) return null;
	if (reconnecting || !progress.initiatedHere || progress.hidden) return null;
	const ended = progress.outcome !== undefined;
	return (
		<ServerUpgradeProgress
			progress={progress}
			placement="floating"
			{...(ended
				? { onClose: () => board.closeProgress(progress.profileId) }
				: { onHide: () => board.hideProgress(progress.profileId) })}
		/>
	);
}
