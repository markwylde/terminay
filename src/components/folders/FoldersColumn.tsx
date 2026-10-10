import { EllipsisVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FoldersColumnTabId } from '../../types/settings';
import { SidebarGroupTabs } from '../sidebar/SidebarGroupTabs';
import { FOLDERS_COLUMN_TABS } from './foldersColumnTabs';
import { FoldersTree, type FoldersTreeProps } from './FoldersTree';
import './foldersTree.css';

/**
 * A project's left column: the Folders tree and the project's agents, one at a
 * time, chosen from icon tabs.
 *
 * The band that holds the tabs is the project chrome, the same band the panel
 * tab strip and the sidebar's group tabs draw, so the colour runs unbroken
 * across all three columns. Both lists stay mounted and laid out, so the one
 * that is not shown keeps its scroll position and its open rows.
 */
export function FoldersColumn({
	agents,
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
	// With no Agents list there is one list and nothing to choose between. The
	// stored selection is left as it is for when agents come back.
	const shownTab: FoldersColumnTabId =
		agents === undefined ? 'tabs' : selectedTab;
	const panelId = (tabId: FoldersColumnTabId) => `${idPrefix}-panel-${tabId}`;
	const panelProps = (tabId: FoldersColumnTabId) => ({
		id: panelId(tabId),
		className: `folders-column__panel${shownTab === tabId ? '' : ' folders-column__panel--hidden'}`,
		'data-folders-column-panel': tabId,
		'aria-hidden': shownTab !== tabId,
		...(agents === undefined
			? {}
			: {
					role: 'tabpanel',
					'aria-labelledby': `${idPrefix}-tab-${tabId}`,
				}),
	});

	return (
		<div className="folders-column" data-terminay-folders-column="true">
			<div className="folders-column__header">
				{agents === undefined ? null : (
					<SidebarGroupTabs
						className="folders-column__tabs"
						activeTab={shownTab}
						tabs={FOLDERS_COLUMN_TABS}
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
			</div>
			{footer}
		</div>
	);
}
