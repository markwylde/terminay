/**
 * Every attached server's agents, keyed by the server that owns them.
 *
 * Agent entry ids are unique only inside one server's projection, so these
 * snapshots are never merged into one map: they are kept per server and only
 * combined at the point of display, where each row carries its server.
 *
 * This is what lets a tab on a server the window is not currently working in
 * still show that something over there is waiting for a person.
 */

import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry.ts';
import {
	adaptServerAgentSnapshot,
	subscribeServerAgentSnapshots,
} from '../shared/rendererAgentConnection';
import type { AgentStatusSnapshot } from '../types/agentStatus';
import type { ActivityCountBadge } from './activityCountBadge.ts';
import {
	agentBadgesForOtherServers,
	type AgentSnapshotsByServer,
} from './crossServerAgentBadges.ts';

export type { AgentSnapshotsByServer };
export {
	agentBadgesForOtherServers,
	crossServerAgentStates,
} from './crossServerAgentBadges.ts';

/** Subscribe to every attached connection's agent projection at once. The set
 * is dynamic, so this is one effect over all of them rather than a hook each. */
export function useConnectionAgentSnapshots(
	connections: readonly WorkspaceConnection[],
): AgentSnapshotsByServer {
	const [snapshots, setSnapshots] = useState<AgentSnapshotsByServer>({});
	const identity = connections
		.map((connection) => connection.serverId ?? '')
		.filter((serverId) => serverId.length > 0)
		.join(' ');
	useEffect(() => {
		let disposed = false;
		const unsubscribes: Array<() => void> = [];
		const known = new Set<string>();
		for (const connection of connections) {
			const serverId = connection.serverId;
			const client = connection.context?.agentStatusClient;
			if (serverId === undefined || client === undefined) continue;
			known.add(serverId);
			const accept = (snapshot: AgentStatusSnapshot) => {
				if (disposed) return;
				setSnapshots((current) =>
					current[serverId] === snapshot
						? current
						: { ...current, [serverId]: snapshot },
				);
			};
			unsubscribes.push(subscribeServerAgentSnapshots(client, accept));
			void client.refresh().then(
				() => accept(adaptServerAgentSnapshot(client.snapshot)),
				() => undefined,
			);
		}
		// A detached server's agents leave with it rather than lingering as a
		// count nothing can be done about.
		setSnapshots((current) => {
			const next: Record<string, AgentStatusSnapshot> = {};
			for (const [serverId, snapshot] of Object.entries(current)) {
				if (known.has(serverId)) next[serverId] = snapshot;
			}
			return Object.keys(next).length === Object.keys(current).length
				? current
				: next;
		});
		return () => {
			disposed = true;
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [identity]);
	return snapshots;
}

export function useCrossServerAgentBadges(
	connections: readonly WorkspaceConnection[],
	activeServerId: string | undefined,
	projectForSession: (
		serverId: string,
		activationTerminalSessionId: string,
	) => string | undefined,
): Readonly<Record<string, ActivityCountBadge>> {
	const snapshots = useConnectionAgentSnapshots(connections);
	return useMemo(
		() =>
			agentBadgesForOtherServers(snapshots, activeServerId, projectForSession),
		[activeServerId, projectForSession, snapshots],
	);
}
