import { Bot, CircleDot, GitPullRequest, PanelsTopLeft } from 'lucide-react';
import type { FoldersColumnTabId } from '../../types/settings';
import type { SidebarGroupTab } from '../sidebar/SidebarGroupTabs';

/** The left column's lists, in the order their tabs are drawn. Pull Requests
 * and Issues are drawn only when a forge source claims the project's remote. */
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
		{
			id: 'pullRequests',
			label: 'Pull Requests',
			icon: <GitPullRequest size={16} aria-hidden="true" />,
		},
		{
			id: 'issues',
			label: 'Issues',
			icon: <CircleDot size={16} aria-hidden="true" />,
		},
	];
