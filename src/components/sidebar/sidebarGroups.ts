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
};

/** The Agents pane is in workspace state and in no sidebar group: it is a tab
 * of the left column. */
const PANEL_GROUP: Readonly<
	Record<SidebarPanelId, SidebarGroupId | undefined>
> = {
	explorer: 'explorer',
	git: 'explorer',
	documentation: 'documentation',
	agents: undefined,
};

export const SIDEBAR_GROUP_LABELS: Readonly<Record<SidebarGroupId, string>> = {
	explorer: 'Explorer',
	documentation: 'Documentation',
};

export function isSidebarGroupId(value: unknown): value is SidebarGroupId {
	return (
		typeof value === 'string' &&
		(SIDEBAR_GROUP_IDS as readonly string[]).includes(value)
	);
}

export function sidebarGroupForPanel(
	panelId: SidebarPanelId,
): SidebarGroupId | undefined {
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
