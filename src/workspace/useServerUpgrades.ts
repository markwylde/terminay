/**
 * The window's view of its attached servers' upgrades, for the header, the
 * connection menu, the compact switcher, and the confirmation.
 *
 * One board per window follows every connection but Local. It outlives each
 * connection's client, because an upgrade restarts the server and the outcome
 * arrives on the connection that replaces the one the upgrade began on.
 */

import type { ServerUpgradeMode } from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import type { ConnectionProfileSummary } from '../shared/connections/hostConnections';
import {
	useProvidedServerUpgradeBoard,
	useServerUpgradeBoardSnapshot,
} from './ServerUpgradeBoardHost.tsx';
import {
	activeServerUpgradeVersion,
	createServerUpgradeMemory,
	requestServerUpgrade,
	ServerUpgradeBoard,
	type ServerUpgradeEntry,
	type ServerUpgradeNotice,
	type ServerUpgradeProgressView,
	type ServerUpgradeRow,
	serverUpgradeRows,
	serverUpgradeSources,
} from './serverUpgradeModel.ts';

export type ServerUpgradeConfirmationState = Readonly<{
	entry: ServerUpgradeEntry;
	/** Resolves with why the server refused, or `undefined` once it began. */
	start: (mode: ServerUpgradeMode) => Promise<string | undefined>;
	close: () => void;
	/**
	 * Set when this confirms Install latest on the channel (ADR-0117) rather
	 * than an upgrade: the release it installs, and whether it is older.
	 */
	installLatest?: Readonly<{ version: string; downgrade: boolean }>;
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
	/** Each followed upgrade's ticklist, by connection. */
	progress: readonly ServerUpgradeProgressView[];
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
	// The window's board outlives this workspace, which is mounted afresh on
	// every reconnect; without a host to hold it, this workspace keeps its own,
	// and what was followed is kept on the device.
	const provided = useProvidedServerUpgradeBoard();
	const [own] = useState(() =>
		provided === undefined
			? new ServerUpgradeBoard({ memory: createServerUpgradeMemory() })
			: undefined,
	);
	const board = provided ?? (own as ServerUpgradeBoard);
	const snapshot = useServerUpgradeBoardSnapshot(board);
	const sources = useMemo(
		() => serverUpgradeSources(connections, profiles),
		[connections, profiles],
	);
	useEffect(() => {
		if (own !== undefined) own.sync(sources);
	}, [own, sources]);
	useEffect(() => () => own?.dispose(), [own]);
	const [confirmingProfileId, setConfirmingProfileId] = useState<string>();
	const requestUpgrade = useCallback((profileId: string) => {
		setConfirmingProfileId(profileId);
	}, []);
	const dismissNotice = useCallback(
		(noticeId: string) => board.dismiss(noticeId),
		[board],
	);
	const rows = useMemo(
		() => serverUpgradeRows(snapshot.entries, snapshot.progress),
		[snapshot.entries, snapshot.progress],
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
		const to = entry.status.available.version;
		return {
			entry,
			close: () => setConfirmingProfileId(undefined),
			start: async (mode) => {
				const refusal = await requestServerUpgrade(
					connections.find((connection) => connection.profileId === profileId)
						?.context?.serverUpgradeClient,
					mode,
				);
				if (refusal === undefined) board.markStarted(profileId, { mode, to });
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
		progress: snapshot.progress,
		namesServers: connections.length > 1,
		notices: snapshot.notices,
		dismissNotice,
		requestUpgrade,
		...(activeVersion === undefined ? {} : { activeVersion }),
		...(confirmation === undefined ? {} : { confirmation }),
	};
}
