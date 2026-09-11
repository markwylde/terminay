/**
 * One tab strip over several servers.
 *
 * Each attached connection projects its own list of project tabs from its own
 * workspace. This module is the only place those lists become one strip: it
 * interleaves them in the window's remembered order, keeps every tab keyed by
 * `(serverId, projectId)` so two servers restored from one data root cannot
 * collide, and decides which tabs are inert because their server is not
 * currently usable.
 *
 * It merges nothing else. A tab still belongs entirely to its own server:
 * its panels, layout, terminals, and settings never mix with another's.
 */

import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import {
	type CompositionTabHandle,
	compositionTabKey,
	orderCompositionTabs,
} from '../shared/connections/composition.ts';
import type { ProjectTab } from './projectTabModel';

/** One connection's contribution to the strip. */
export type ProjectTabSource = Readonly<{
	serverId: string;
	serverLabel: string;
	/** False when the server is unreachable, reconnecting, or incompatible:
	 * its tabs stay in the strip, greyed, and take no operations. */
	usable: boolean;
	/** Why the tabs are greyed, shown on the tab and in the connections
	 * control. For an incompatible server this is the compatibility message,
	 * which names the side to upgrade. */
	statusMessage?: string;
	projects: readonly ProjectTab[];
}>;

export function projectTabHandle(tab: ProjectTab): CompositionTabHandle {
	return Object.freeze({ serverId: tab.serverId, projectId: tab.id });
}

export function projectTabIdentity(tab: ProjectTab): string {
	return compositionTabKey(tab.serverId, tab.id);
}

/** A connection as the strip sees it. Only `ready` is usable; every other
 * phase keeps the tabs and greys them. */
export function projectTabSourceFor(
	connection: WorkspaceConnection,
	projects: readonly ProjectTab[],
): ProjectTabSource | undefined {
	if (connection.serverId === undefined) return undefined;
	const message =
		connection.phase === 'incompatible'
			? (connection.compatibility?.state === 'incompatible'
					? connection.compatibility.message
					: connection.error) ?? 'This server needs updating.'
			: connection.phase === 'ready'
				? undefined
				: (connection.error ?? describePhase(connection.phase));
	return Object.freeze({
		serverId: connection.serverId,
		serverLabel: connection.label,
		usable: connection.phase === 'ready',
		projects,
		...(message === undefined ? {} : { statusMessage: message }),
	});
}

function describePhase(phase: WorkspaceConnection['phase']): string {
	switch (phase) {
		case 'connecting':
			return 'Connecting…';
		case 'reconnecting':
			return 'Reconnecting…';
		case 'unreachable':
			return 'This server is unreachable.';
		default:
			return '';
	}
}

/**
 * The strip, in the window's order.
 *
 * `serverLabel` is stamped on every tab so the strip can name the server
 * without reaching back into the registry, and `inert` marks the tabs a
 * person can see but not act on.
 */
export type ComposedProjectTab = ProjectTab &
	Readonly<{
		serverLabel: string;
		inert: boolean;
		statusMessage?: string;
		/** `(serverId, projectId)` as one string, for keys and drag ids. */
		handle: string;
	}>;

export function composeProjectTabs(
	sources: readonly ProjectTabSource[],
	rememberedOrder: readonly CompositionTabHandle[] = [],
): readonly ComposedProjectTab[] {
	const bySource = new Map<string, ProjectTabSource>();
	const byHandle = new Map<string, ProjectTab>();
	const live: CompositionTabHandle[] = [];
	for (const source of sources) {
		bySource.set(source.serverId, source);
		for (const project of source.projects) {
			// A source only ever contributes its own server's projects; a tab
			// claiming another server's id is dropped rather than re-homed.
			if (project.serverId !== source.serverId) continue;
			const key = compositionTabKey(source.serverId, project.id);
			if (byHandle.has(key)) continue;
			byHandle.set(key, project);
			live.push(projectTabHandle(project));
		}
	}
	const composed: ComposedProjectTab[] = [];
	for (const handle of orderCompositionTabs(live, rememberedOrder)) {
		const key = compositionTabKey(handle.serverId, handle.projectId);
		const project = byHandle.get(key);
		const source = bySource.get(handle.serverId);
		if (project === undefined || source === undefined) continue;
		composed.push(
			Object.freeze({
				...project,
				serverLabel: source.serverLabel,
				inert: !source.usable,
				handle: key,
				...(source.statusMessage === undefined
					? {}
					: { statusMessage: source.statusMessage }),
			}),
		);
	}
	return Object.freeze(composed);
}

/** The window names a server on a tab only when it is showing more than one. */
export function shouldNameServers(
	sources: readonly ProjectTabSource[],
): boolean {
	return new Set(sources.map((source) => source.serverId)).size > 1;
}

/**
 * A panel can move to another project only on its own server.
 *
 * Moving a panel across servers would mean one server's terminal running under
 * another's workspace, which is the routing hop the whole design exists to
 * avoid. It is refused by not being offered: cross-server projects are never
 * drop targets and never appear in the move menu.
 */
export function canMovePanelToProject(
	from: Pick<ProjectTab, 'id' | 'serverId'>,
	to: Pick<ProjectTab, 'id' | 'serverId'>,
): boolean {
	if (from.serverId !== to.serverId) return false;
	return from.id !== to.id;
}

/** The move menu and drop targets for one panel: same server, other project. */
export function panelMoveTargets<T extends Pick<ProjectTab, 'id' | 'serverId'>>(
	from: Pick<ProjectTab, 'id' | 'serverId'>,
	candidates: readonly T[],
): readonly T[] {
	return Object.freeze(
		candidates.filter((candidate) => canMovePanelToProject(from, candidate)),
	);
}
