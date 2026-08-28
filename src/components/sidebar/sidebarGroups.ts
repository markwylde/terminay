import {
	SIDEBAR_GROUP_IDS,
	type SidebarGroupId,
	type SidebarPanelId,
} from '../../types/settings.ts';

export { SIDEBAR_GROUP_IDS };
export type { SidebarGroupId };

export const SIDEBAR_GROUP_PANELS: Readonly<
	Record<SidebarGroupId, readonly SidebarPanelId[]>
> = {
	explorer: ['explorer', 'git'],
	documentation: ['documentation'],
	agents: ['agents'],
};

const PANEL_GROUP: Readonly<Record<SidebarPanelId, SidebarGroupId>> = {
	explorer: 'explorer',
	git: 'explorer',
	documentation: 'documentation',
	agents: 'agents',
};

export const SIDEBAR_GROUP_LABELS: Readonly<Record<SidebarGroupId, string>> = {
	explorer: 'Explorer',
	documentation: 'Documentation',
	agents: 'Agents',
};

export function isSidebarGroupId(value: unknown): value is SidebarGroupId {
	return (
		typeof value === 'string' &&
		(SIDEBAR_GROUP_IDS as readonly string[]).includes(value)
	);
}

export function sidebarGroupForPanel(panelId: SidebarPanelId): SidebarGroupId {
	return PANEL_GROUP[panelId];
}

export function panelsInSidebarGroup(
	groupId: SidebarGroupId,
	panelOrder: readonly SidebarPanelId[],
): SidebarPanelId[] {
	const allowed = new Set(SIDEBAR_GROUP_PANELS[groupId]);
	return panelOrder.filter((id) => allowed.has(id));
}

export function applySidebarGroupReorder(
	panelOrder: readonly SidebarPanelId[],
	groupId: SidebarGroupId,
	reorderedGroupIds: readonly SidebarPanelId[],
): SidebarPanelId[] {
	const allowed = new Set(SIDEBAR_GROUP_PANELS[groupId]);
	const iterator = reorderedGroupIds
		.filter((id) => allowed.has(id))
		[Symbol.iterator]();
	return panelOrder.map((id) =>
		allowed.has(id) ? (iterator.next().value ?? id) : id,
	);
}

export function resolveVisibleSidebarGroup(
	selected: SidebarGroupId,
	agentsEnabled: boolean,
): SidebarGroupId {
	if (selected === 'agents' && !agentsEnabled) return 'explorer';
	return selected;
}
