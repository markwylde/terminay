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
 * Whether the window's upgrade card is up: while its server's upgrade is
 * followed, on any device, and on the device that asked for it until closed.
 */
export function showsUpgradeModal(
	progress: ServerUpgradeProgressView | undefined,
): progress is ServerUpgradeProgressView {
	if (progress === undefined) return false;
	return progress.outcome === undefined || progress.initiatedHere;
}

/**
 * The upgrade's ticklist, centred over the whole window and modal for as long
 * as it is up. It is drawn in this one place whether the connection is up or
 * down, so it never moves while the server restarts; nothing beneath it is of
 * use while the server is being replaced.
 */
export function ServerUpgradeModal({
	profileId,
}: Readonly<{ profileId: string | undefined }>) {
	const board = useProvidedServerUpgradeBoard();
	const progress = useServerUpgradeProgress(profileId);
	if (board === undefined || !showsUpgradeModal(progress)) return null;
	return (
		<div className="server-upgrade-modal" data-server-upgrade-modal>
			<ServerUpgradeProgress
				progress={progress}
				{...(progress.outcome === undefined
					? {}
					: { onClose: () => board.closeProgress(progress.profileId) })}
			/>
		</div>
	);
}
