/**
 * The server selector that sits on every per-server surface.
 *
 * Settings, Macros, Recordings, Shell profiles, and Extensions are all owned
 * by one server. With several attached, the surface has to say which one it is
 * showing and let a person change it — and it must never merge two servers'
 * rows into one list, which is why this picks a connection rather than
 * combining them.
 *
 * It defaults to the active tab's server: the surface opens showing the
 * server the person was already looking at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceConnection } from './connections/connectionRegistry';
import { useConnections } from './connections/ConnectionsContext';
import {
	resolveSelectedServer,
	selectableConnections,
} from './connections/serverSelection';

export { resolveSelectedServer, selectableConnections };

/**
 * The connection a per-server surface should talk to.
 *
 * `activeServerId` is the active tab's server, which is the default. The
 * returned connection is always one that can actually be queried, so a
 * surface never has to guard against an inert server itself.
 */
export function useSelectedServerConnection(
	activeServerId?: string,
): Readonly<{
	connection?: WorkspaceConnection;
	connections: readonly WorkspaceConnection[];
	/** True when there is a choice to make. One server needs no selector. */
	showsSelector: boolean;
	select: (serverId: string) => void;
}> {
	const { activeServerId: workingServerId, connections } = useConnections();
	// The default is the server the window is working in unless the caller
	// names one, so a surface opens on the server the person was looking at.
	const fallback = activeServerId ?? workingServerId;
	const [requested, setRequested] = useState<string>();
	// The active tab moving to another server re-points a surface that has not
	// been given an explicit choice.
	useEffect(() => {
		setRequested(undefined);
	}, [fallback]);
	const select = useCallback((serverId: string) => {
		setRequested(serverId);
	}, []);
	return useMemo(() => {
		const usable = selectableConnections(connections);
		const connection = resolveSelectedServer(connections, requested, fallback);
		return Object.freeze({
			connections: usable,
			showsSelector: usable.length > 1,
			select,
			...(connection === undefined ? {} : { connection }),
		});
	}, [connections, fallback, requested, select]);
}

export type ServerSelectorProps = Readonly<{
	/** What the surface is scoped to, for the accessible name. */
	label: string;
	connections: readonly WorkspaceConnection[];
	selectedServerId?: string;
	onSelect: (serverId: string) => void;
}>;

export function ServerSelector({
	connections,
	label,
	onSelect,
	selectedServerId,
}: ServerSelectorProps) {
	// One server is not a choice, and a control that offers none is clutter.
	if (connections.length < 2) return null;
	return (
		<label className="server-selector">
			<span className="server-selector__label">{label}</span>
			<select
				className="server-selector__select"
				value={selectedServerId ?? ''}
				onChange={(event) => onSelect(event.target.value)}
			>
				{connections.map((connection) => (
					<option key={connection.profileId} value={connection.serverId ?? ''}>
						{connection.label}
					</option>
				))}
			</select>
		</label>
	);
}
