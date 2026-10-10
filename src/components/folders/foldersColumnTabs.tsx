import { Bot, PanelsTopLeft } from 'lucide-react';
import type { FoldersColumnTabId } from '../../types/settings';
import type { SidebarGroupTab } from '../sidebar/SidebarGroupTabs';

/** The left column's lists, in the order their tabs are drawn. The compact
 * switcher offers the same two. */
export const FOLDERS_COLUMN_TABS: readonly SidebarGroupTab<FoldersColumnTabId>[] =
	[
		{
			id: 'tabs',
			label: 'Tabs',
			icon: <PanelsTopLeft size={16} aria-hidden="true" />,
		},
		{
			id: 'agents',
			label: 'Agents',
			icon: <Bot size={16} aria-hidden="true" />,
		},
	];
