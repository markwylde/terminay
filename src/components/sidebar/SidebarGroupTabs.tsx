import { BookOpen, Bot, FolderTree } from 'lucide-react';
import {
	type JSX,
	type KeyboardEvent,
	type ReactNode,
} from 'react';
import {
	SIDEBAR_GROUP_IDS,
	SIDEBAR_GROUP_LABELS,
	type SidebarGroupId,
} from './sidebarGroups';
import './sidebar.css';

const GROUP_ICONS: Readonly<Record<SidebarGroupId, ReactNode>> = {
	explorer: <FolderTree size={16} aria-hidden="true" />,
	documentation: <BookOpen size={16} aria-hidden="true" />,
	agents: <Bot size={16} aria-hidden="true" />,
};

export type SidebarGroupTabsProps = {
	activeGroup: SidebarGroupId;
	groups: readonly SidebarGroupId[];
	idPrefix: string;
	onSelect: (groupId: SidebarGroupId) => void;
};

export function SidebarGroupTabs({
	activeGroup,
	groups,
	idPrefix,
	onSelect,
}: SidebarGroupTabsProps): JSX.Element {
	const ordered = SIDEBAR_GROUP_IDS.filter((id) => groups.includes(id));

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		event.preventDefault();
		const currentIndex = ordered.indexOf(activeGroup);
		if (currentIndex < 0) return;
		const delta = event.key === 'ArrowRight' ? 1 : -1;
		const next =
			ordered[(currentIndex + delta + ordered.length) % ordered.length];
		if (next) onSelect(next);
	};

	return (
		<div
			className="sidebar-group-tabs"
			role="tablist"
			aria-label="Sidebar"
			onKeyDown={handleKeyDown}
		>
			{ordered.map((groupId) => {
				const selected = groupId === activeGroup;
				const label = SIDEBAR_GROUP_LABELS[groupId];
				return (
					<button
						key={groupId}
						type="button"
						role="tab"
						id={`${idPrefix}-tab-${groupId}`}
						aria-label={label}
						aria-selected={selected}
						aria-controls={`${idPrefix}-panel`}
						tabIndex={selected ? 0 : -1}
						className={`sidebar-group-tab${selected ? ' sidebar-group-tab--active' : ''}`}
						title={label}
						onClick={() => onSelect(groupId)}
					>
						{GROUP_ICONS[groupId]}
					</button>
				);
			})}
		</div>
	);
}
