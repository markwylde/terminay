import { EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import {
	FOLDERS_COLUMN_PANE_IDS,
	type FoldersColumnLayout,
	type FoldersColumnPaneId,
} from '../../types/settings';
import {
	SidebarPanelStack,
	type SidebarPanelStackItem,
} from '../sidebar/SidebarPanelStack';
import { FoldersTree, type FoldersTreeProps } from './FoldersTree';
import './foldersTree.css';

/** What the column shows in its Agents pane. */
export type FoldersColumnAgents = {
	count: number;
	children: ReactNode;
};

function isFoldersColumnPaneId(id: string): id is FoldersColumnPaneId {
	return (FOLDERS_COLUMN_PANE_IDS as readonly string[]).includes(id);
}

/**
 * A project's left column: the Folders tree and the project's agents, stacked
 * as two panes that collapse, resize and reorder like the sidebar's.
 *
 * The band above the stack is the project chrome, the same band the panel tab
 * strip and the sidebar's group tabs draw, so the colour runs unbroken across
 * all three columns. It carries no title; each pane names itself.
 */
export function FoldersColumn({
	agents,
	footer,
	isMenuOpen = false,
	layout,
	onLayoutChange,
	onOpenMenu,
	...tree
}: FoldersTreeProps & {
	/** The Agents pane, or undefined when the project presents no agents. */
	agents?: FoldersColumnAgents;
	/** Pinned beneath the stack. */
	footer?: ReactNode;
	isMenuOpen?: boolean;
	layout: FoldersColumnLayout;
	/** Called once per completed collapse, resize or reorder. */
	onLayoutChange: (layout: FoldersColumnLayout) => void;
	/** Opens the menu of what is done to the folders as a list. */
	onOpenMenu?: (anchor: { x: number; y: number }) => void;
}) {
	const itemsById: Record<FoldersColumnPaneId, SidebarPanelStackItem | null> =
		{
			folders: {
				id: 'folders',
				title: 'Folders',
				height: layout.foldersHeight,
				collapsed: layout.isFoldersCollapsed,
				onToggleCollapsed: () =>
					onLayoutChange({
						...layout,
						isFoldersCollapsed: !layout.isFoldersCollapsed,
					}),
				className: 'folders-column__pane',
				children: <FoldersTree {...tree} />,
			},
			agents:
				agents === undefined
					? null
					: {
							id: 'agents',
							title: 'Agents',
							height: layout.agentsHeight,
							collapsed: layout.isAgentsCollapsed,
							onToggleCollapsed: () =>
								onLayoutChange({
									...layout,
									isAgentsCollapsed: !layout.isAgentsCollapsed,
								}),
							count: agents.count,
							children: agents.children,
						},
		};
	const items = layout.order.flatMap((id) => itemsById[id] ?? []);

	return (
		<div className="folders-column" data-terminay-folders-column="true">
			<div className="folders-column__header">
				{onOpenMenu === undefined ? null : (
					<button
						type="button"
						className={`folders-column__menu${isMenuOpen ? ' folders-column__menu--active' : ''}`}
						aria-label="Folders actions"
						aria-haspopup="menu"
						aria-expanded={isMenuOpen}
						title="Folders actions"
						onClick={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							onOpenMenu({ x: rect.left, y: rect.bottom + 4 });
						}}
					>
						<EllipsisVertical size={14} aria-hidden="true" />
					</button>
				)}
			</div>
			<div className="folders-column__body">
				<SidebarPanelStack
					items={items}
					onHeightsCommit={(heights) =>
						onLayoutChange({
							...layout,
							...(heights.folders === undefined
								? {}
								: { foldersHeight: heights.folders }),
							...(heights.agents === undefined
								? {}
								: { agentsHeight: heights.agents }),
						})
					}
					onReorder={(orderedIds) => {
						const shown = orderedIds.filter(isFoldersColumnPaneId);
						// A pane that is not shown keeps its place after the others.
						onLayoutChange({
							...layout,
							order: [
								...shown,
								...layout.order.filter((id) => !shown.includes(id)),
							],
						});
					}}
				/>
			</div>
			{footer}
		</div>
	);
}
