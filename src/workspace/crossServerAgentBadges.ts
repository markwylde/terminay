/**
 * How another server's agents become a badge on its tab.
 *
 * Agent entry ids are unique only inside one server's projection, so nothing
 * here merges two servers: every badge key carries the server that owns it.
 */

import {
	EMPTY_AGENT_STATUS_SNAPSHOT,
	selectAgentStatusEntries,
} from '../agentStatusStore.ts';
import { compositionTabKey } from '../shared/connections/composition.ts';
import type { AgentStatusSnapshot } from '../types/agentStatus';
import {
	type ActivityBadgeSourceState,
	type ActivityCountBadge,
	summarizeActivityBadge,
} from './activityCountBadge.ts';

export type AgentSnapshotsByServer = Readonly<
	Record<string, AgentStatusSnapshot>
>;

/**
 * Tab badges for the servers the window is not currently working in.
 *
 * The active server's badges come from its live panel inventory, which knows
 * what every tab is doing. Another server has no inventory here, but its agent
 * projection still says which of its projects are waiting on a person — and
 * that is the thing worth crossing a server boundary to show.
 */
export function agentBadgesForOtherServers(
	snapshots: AgentSnapshotsByServer,
	activeServerId: string | undefined,
	projectForSession: (
		serverId: string,
		activationTerminalSessionId: string,
	) => string | undefined,
): Readonly<Record<string, ActivityCountBadge>> {
	const states = new Map<string, ActivityBadgeSourceState[]>();
	for (const [serverId, snapshot] of Object.entries(snapshots)) {
		if (serverId === activeServerId) continue;
		for (const entry of selectAgentStatusEntries(
			snapshot ?? EMPTY_AGENT_STATUS_SNAPSHOT,
		)) {
			const projectId = projectForSession(
				serverId,
				entry.activationTerminalSessionId,
			);
			if (projectId === undefined) continue;
			const key = compositionTabKey(serverId, projectId);
			const bucket = states.get(key) ?? [];
			bucket.push(entry.state as ActivityBadgeSourceState);
			states.set(key, bucket);
		}
	}
	const badges: Record<string, ActivityCountBadge> = {};
	for (const [key, bucket] of states) {
		const badge = summarizeActivityBadge(bucket);
		if (badge !== null) badges[key] = badge;
	}
	return badges;
}

/** The window's one header badge: every attached server's notable work. */
export function crossServerAgentStates(
	snapshots: AgentSnapshotsByServer,
): readonly ActivityBadgeSourceState[] {
	return Object.values(snapshots).flatMap((snapshot) =>
		selectAgentStatusEntries(snapshot ?? EMPTY_AGENT_STATUS_SNAPSHOT).map(
			(entry) => entry.state as ActivityBadgeSourceState,
		),
	);
}

