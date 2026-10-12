/**
 * The window's view of its attached servers' upgrades, for the header, the
 * connection menu, the compact switcher, and the confirmation.
 *
 * One board per window follows every connection but Local. It outlives each
 * connection's client, because an upgrade restarts the server and the outcome
 * arrives on the connection that replaces the one the upgrade began on.
 */

import type { ServerUpgradeMode } from '@terminay/client-core';
import {
	useCallback,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import type { ConnectionProfileSummary } from '../shared/connections/hostConnections';
import {
	activeServerUpgradeVersion,
	createServerUpgradeMemory,
	requestServerUpgrade,
	ServerUpgradeBoard,
	type ServerUpgradeEntry,
	type ServerUpgradeNotice,
	type ServerUpgradeRow,
	serverUpgradeRows,
	serverUpgradeSources,
} from './serverUpgradeModel.ts';

export type ServerUpgradeConfirmationState = Readonly<{
	entry: ServerUpgradeEntry;
	/** Resolves with why the server refused, or `undefined` once it began. */
	start: (mode: ServerUpgradeMode) => Promise<string | undefined>;
	close: () => void;
}>;

export type ServerUpgrades = Readonly<{
	/** The version the header warns of: the active tab's server's only. */
	activeVersion?: string;
	rows: readonly ServerUpgradeRow[];
	/** True when the window holds more than one server, so a row names its. */
	namesServers: boolean;
	notices: readonly ServerUpgradeNotice[];
	dismissNotice: (noticeId: string) => void;
	/** Open the confirmation. Nothing is sent until it is confirmed. */
	requestUpgrade: (profileId: string) => void;
	confirmation?: ServerUpgradeConfirmationState;
}>;

export function useServerUpgrades(
	options: Readonly<{
		connections: readonly WorkspaceConnection[];
		profiles: readonly ConnectionProfileSummary[];
		/** The connection the active tab belongs to. */
		activeProfileId: string | undefined;
	}>,
): ServerUpgrades {
	const { activeProfileId, connections, profiles } = options;
	// The workspace is unmounted while its server is away, and the outcome
	// arrives after it is mounted again: what was followed is kept on the device.
	const [board] = useState(
		() => new ServerUpgradeBoard({ memory: createServerUpgradeMemory() }),
	);
	const snapshot = useSyncExternalStore(
		useCallback((listener) => board.subscribe(listener), [board]),
		useCallback(() => board.snapshot, [board]),
		useCallback(() => board.snapshot, [board]),
	);
	const sources = useMemo(
		() => serverUpgradeSources(connections, profiles),
		[connections, profiles],
	);
	useEffect(() => {
		board.sync(sources);
	}, [board, sources]);
	useEffect(() => () => board.dispose(), [board]);
	const [confirmingProfileId, setConfirmingProfileId] = useState<string>();
	const requestUpgrade = useCallback((profileId: string) => {
		setConfirmingProfileId(profileId);
	}, []);
	const dismissNotice = useCallback(
		(noticeId: string) => board.dismiss(noticeId),
		[board],
	);
	const rows = useMemo(
		() => serverUpgradeRows(snapshot.entries),
		[snapshot.entries],
	);
	const confirmation = useMemo(():
		| ServerUpgradeConfirmationState
		| undefined => {
		const entry = snapshot.entries.find(
			(candidate) => candidate.profileId === confirmingProfileId,
		);
		// A server that detaches, or stops reporting an upgrade, has nothing left
		// to confirm.
		if (entry?.status.available === undefined) return undefined;
		const { profileId } = entry;
		return {
			entry,
			close: () => setConfirmingProfileId(undefined),
			start: async (mode) => {
				const refusal = await requestServerUpgrade(
					connections.find((connection) => connection.profileId === profileId)
						?.context?.serverUpgradeClient,
					mode,
				);
				if (refusal === undefined) board.markStarted(profileId);
				return refusal;
			},
		};
	}, [board, confirmingProfileId, connections, snapshot.entries]);
	// A confirmation that lost its server, or its upgrade, is over: it must not
	// reopen by itself when that server next reports one.
	useEffect(() => {
		if (confirmingProfileId !== undefined && confirmation === undefined)
			setConfirmingProfileId(undefined);
	}, [confirmation, confirmingProfileId]);
	const activeVersion = activeServerUpgradeVersion(
		snapshot.entries,
		activeProfileId,
	);
	return {
		rows,
		namesServers: connections.length > 1,
		notices: snapshot.notices,
		dismissNotice,
		requestUpgrade,
		...(activeVersion === undefined ? {} : { activeVersion }),
		...(confirmation === undefined ? {} : { confirmation }),
	};
}
