/**
 * Every attached server's project tabs, for the one strip.
 *
 * The window edits one server at a time — the one whose tab is active — and
 * that server's projects come from the full `useProjectCollection` in `App`.
 * Every *other* attached connection contributes tabs read straight from its
 * own workspace projection: enough to draw and click a tab, and nothing that
 * could mutate a server the person is not currently on.
 *
 * That asymmetry is the point. There is one dockview, one file explorer, and
 * one sidebar in a window, so only one server can be being worked in; a tab
 * from another server is a place to go, and going there is what binds the
 * workspace surfaces to it.
 */

import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry.ts';
import { subscriptionKey } from './connectionSubscriptionIdentity.ts';
import {
	type ProjectTabSource,
	projectTabSourceFor,
} from './projectTabComposition.ts';
import { createProjectTab, type ProjectTab } from './projectTabModel.ts';
import type { SidebarSettings } from '../types/settings';
import type { ServerWorkspaceSnapshot } from '../shared/serverWorkspaceReconciliation.ts';

/** One server's projects, in its own view order, as read-only tabs. */
export function projectTabsFromSnapshot(
	serverId: string,
	snapshot: ServerWorkspaceSnapshot | null,
	sidebarDefaults: SidebarSettings,
	viewId?: string,
): readonly ProjectTab[] {
	if (snapshot === null) return Object.freeze([]);
	const chosenViewId = viewId ?? snapshot.viewOrder[0];
	const view = chosenViewId === undefined ? undefined : snapshot.views[chosenViewId];
	if (view === undefined) return Object.freeze([]);
	const usedColors: string[] = [];
	const tabs: ProjectTab[] = [];
	for (const projectId of view.projectIds) {
		const project = snapshot.projects[projectId];
		if (project === undefined) continue;
		const base = createProjectTab(
			tabs.length + 1,
			project.root,
			usedColors,
			sidebarDefaults,
			serverId,
		);
		const color = project.color ?? base.color;
		usedColors.push(color);
		tabs.push({
			...base,
			id: project.id,
			serverId,
			title: project.name,
			rootFolder: project.root,
			color,
			...(project.icon === undefined ? {} : { emoji: project.icon }),
		});
	}
	return Object.freeze(tabs);
}

/**
 * The strip's sources.
 *
 * `activeServerId`'s own source is supplied by the caller, because the active
 * server's tabs carry live creation state, hydration, and device-local sidebar
 * flags that only the full collection knows. Everything else is projected
 * here.
 */
export function useConnectionProjectTabs(
	connections: readonly WorkspaceConnection[],
	activeServerId: string | undefined,
	activeSource: ProjectTabSource | undefined,
	sidebarDefaults: SidebarSettings,
): readonly ProjectTabSource[] {
	const [snapshots, setSnapshots] = useState<
		Readonly<Record<string, ServerWorkspaceSnapshot | null>>
	>({});
	// One effect subscribes to every attached store: the set is dynamic, so a
	// hook per connection is not available, and a store that goes away simply
	// stops contributing.
	//
	// The key is the identity of what is subscribed to, not merely of the
	// attached set: a reconnect keeps the server id and hands out a fresh
	// snapshot store, and this effect has to follow the live one.
	const stores = subscriptionKey(
		connections,
		(connection) => connection.context?.workspaceSnapshotStore,
	);
	useEffect(() => {
		const unsubscribes: Array<() => void> = [];
		const next: Record<string, ServerWorkspaceSnapshot | null> = {};
		for (const connection of connections) {
			const serverId = connection.serverId;
			const store = connection.context?.workspaceSnapshotStore;
			if (serverId === undefined || store === undefined) continue;
			next[serverId] = store.snapshot;
			unsubscribes.push(
				store.subscribe((snapshot) => {
					// Tabs are made from a server's projects and views. A projection
					// that left both alone (a panel renamed, a session ended) makes
					// the tabs it already made.
					setSnapshots((current) => {
						const held = current[serverId];
						return held === snapshot ||
							(held !== null &&
								held !== undefined &&
								held.projects === snapshot.projects &&
								held.views === snapshot.views &&
								held.viewOrder === snapshot.viewOrder)
							? current
							: { ...current, [serverId]: snapshot };
					});
				}),
			);
		}
		setSnapshots(next);
		return () => {
			for (const unsubscribe of unsubscribes) unsubscribe();
		};
		// `stores` is the identity of the subscribed stores; `connections` changes
		// on every phase transition and would resubscribe for no reason.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [stores]);

	return useMemo(() => {
		const sources: ProjectTabSource[] = [];
		for (const connection of connections) {
			if (connection.serverId === undefined) continue;
			if (connection.serverId === activeServerId) {
				if (activeSource !== undefined) sources.push(activeSource);
				continue;
			}
			const source = projectTabSourceFor(
				connection,
				projectTabsFromSnapshot(
					connection.serverId,
					snapshots[connection.serverId] ?? null,
					sidebarDefaults,
				),
			);
			if (source !== undefined) sources.push(source);
		}
		return Object.freeze(sources);
	}, [activeServerId, activeSource, connections, sidebarDefaults, snapshots]);
}
