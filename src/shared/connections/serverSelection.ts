/**
 * Which server a per-server surface is showing.
 *
 * Settings, Macros, Recordings, Shell profiles, and Extensions each belong to
 * one server. This is the rule for picking it: the active tab's server unless
 * a person has chosen otherwise, and never a server that cannot answer.
 */

import type { WorkspaceConnection } from './connectionRegistry.ts';

/** Only a ready connection can answer a feature query. An unreachable or
 * incompatible server is shown, but nothing is asked of it. */
export function selectableConnections(
	connections: readonly WorkspaceConnection[],
): readonly WorkspaceConnection[] {
	return connections.filter((connection) => connection.context !== undefined);
}

export function resolveSelectedServer(
	connections: readonly WorkspaceConnection[],
	requested: string | undefined,
	fallback: string | undefined,
): WorkspaceConnection | undefined {
	const usable = selectableConnections(connections);
	return (
		usable.find((connection) => connection.serverId === requested) ??
		usable.find((connection) => connection.serverId === fallback) ??
		usable[0]
	);
}
