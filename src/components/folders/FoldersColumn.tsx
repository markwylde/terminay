import { EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FoldersColumnTabId } from '../../types/settings';
import { SidebarGroupTabs } from '../sidebar/SidebarGroupTabs';
import { FOLDERS_COLUMN_TABS } from './foldersColumnTabs';
import { FoldersTree, type FoldersTreeProps } from './FoldersTree';
import './foldersTree.css';

export type FoldersColumnForgeTab = Readonly<{
	pane: ReactNode;
	/** Open items it lists, drawn on its tab; undefined until known. */
	count: number | undefined;
}>;

/**
 * A project's left column: the Folders tree, the project's agents, and, when
 * a forge source claims its remote, its pull requests and issues, one at a
 * time, chosen from icon tabs.
 *
 * The band that holds the tabs is the project chrome, the same band the panel
 * tab strip and the sidebar's group tabs draw, so the colour runs unbroken
 * across all three columns. Both lists stay mounted and laid out, so the one
 * that is not shown keeps its scroll position and its open rows.
 */
export function FoldersColumn({
	agents,
	pullRequests,
	issues,
	footer,
	idPrefix,
	isMenuOpen = false,
	onOpenMenu,
	onSelectTab,
	selectedTab,
	...tree
}: FoldersTreeProps & {
	/** The Agents list, or undefined when the project presents no agents. */
	agents?: ReactNode;
	/** The Pull Requests tab, when a forge source claims the project's remote. */
	pullRequests?: FoldersColumnForgeTab;
	/** The Issues tab, likewise. */
	issues?: FoldersColumnForgeTab;
	/** Pinned beneath the lists. */
	footer?: ReactNode;
	/** Distinguishes this column's tab and panel ids from another project's. */
	idPrefix: string;
	isMenuOpen?: boolean;
	/** Opens the menu of what is done to the folders as a list. */
	onOpenMenu?: (anchor: { x: number; y: number }) => void;
	onSelectTab: (tabId: FoldersColumnTabId) => void;
	selectedTab: FoldersColumnTabId;
}) {
	// Only the lists this project has get a tab. With one list there is
	// nothing to choose between. A stored selection whose list is gone is
	// left as it is for when it comes back.
	const present: Readonly<Record<FoldersColumnTabId, boolean>> = {
		tabs: true,
		agents: agents !== undefined,
		pullRequests: pullRequests !== undefined,
		issues: issues !== undefined,
	};
	const tabs = FOLDERS_COLUMN_TABS.filter((tab) => present[tab.id]).map(
		(tab) => {
			const count =
				tab.id === 'pullRequests'
					? pullRequests?.count
					: tab.id === 'issues'
						? issues?.count
						: undefined;
			return count === undefined ? tab : { ...tab, badge: count };
		},
	);
	const hasTabs = tabs.length > 1;
	const shownTab: FoldersColumnTabId = present[selectedTab]
		? selectedTab
		: 'tabs';
	const panelId = (tabId: FoldersColumnTabId) => `${idPrefix}-panel-${tabId}`;
	const panelProps = (tabId: FoldersColumnTabId) => ({
		id: panelId(tabId),
		className: `folders-column__panel${shownTab === tabId ? '' : ' folders-column__panel--hidden'}`,
		'data-folders-column-panel': tabId,
		'aria-hidden': shownTab !== tabId,
		...(!hasTabs
			? {}
			: {
					role: 'tabpanel',
					'aria-labelledby': `${idPrefix}-tab-${tabId}`,
				}),
	});

	return (
		<div className="folders-column" data-terminay-folders-column="true">
			<div className="folders-column__header">
				{!hasTabs ? null : (
					<SidebarGroupTabs
						className="folders-column__tabs"
						activeTab={shownTab}
						tabs={tabs}
						idPrefix={idPrefix}
						label="Left column"
						panelId={panelId}
						onSelect={onSelectTab}
					/>
				)}
				{onOpenMenu === undefined || shownTab !== 'tabs' ? null : (
					<button
						type="button"
						className={`folders-column__menu${isMenuOpen ? ' folders-column__menu--active' : ''}`}
						aria-label="Tabs actions"
						aria-haspopup="menu"
						aria-expanded={isMenuOpen}
						title="Tabs actions"
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
				<div {...panelProps('tabs')}>
					<FoldersTree {...tree} />
				</div>
				{agents === undefined ? null : (
					<div {...panelProps('agents')}>{agents}</div>
				)}
				{pullRequests === undefined ? null : (
					<div {...panelProps('pullRequests')}>{pullRequests.pane}</div>
				)}
				{issues === undefined ? null : (
					<div {...panelProps('issues')}>{issues.pane}</div>
				)}
			</div>
			{footer}
		</div>
	);
}
