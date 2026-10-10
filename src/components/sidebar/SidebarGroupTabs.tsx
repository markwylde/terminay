import { BookOpen, FolderTree } from 'lucide-react';
import {
	type JSX,
	type KeyboardEvent,
	type ReactNode,
} from 'react';
import { SIDEBAR_GROUP_LABELS, type SidebarGroupId } from './sidebarGroups';
import './sidebar.css';

export type SidebarGroupTab<Id extends string> = Readonly<{
	id: Id;
	label: string;
	icon: ReactNode;
}>;

/** The right sidebar's groups, in the order they are drawn. */
export const SIDEBAR_GROUP_TABS: readonly SidebarGroupTab<SidebarGroupId>[] = [
	{
		id: 'explorer',
		label: SIDEBAR_GROUP_LABELS.explorer,
		icon: <FolderTree size={16} aria-hidden="true" />,
	},
	{
		id: 'documentation',
		label: SIDEBAR_GROUP_LABELS.documentation,
		icon: <BookOpen size={16} aria-hidden="true" />,
	},
];

export type SidebarGroupTabsProps<Id extends string> = {
	activeTab: Id;
	tabs: readonly SidebarGroupTab<Id>[];
	idPrefix: string;
	/** What the tab list is called to assistive technology. */
	label: string;
	onSelect: (tabId: Id) => void;
	/** The element a tab controls. One panel serves every tab when absent. */
	panelId?: (tabId: Id) => string;
	/** Draw each tab's name beside its icon. */
	showLabels?: boolean;
	className?: string;
};

/**
 * A row of icon tabs: the right sidebar's groups, the left column's lists, and
 * the compact switcher's. One implementation, so the three look and move alike.
 */
export function SidebarGroupTabs<Id extends string>({
	activeTab,
	tabs,
	idPrefix,
	label,
	onSelect,
	panelId,
	showLabels = false,
	className,
}: SidebarGroupTabsProps<Id>): JSX.Element {
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
		event.preventDefault();
		const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
		if (currentIndex < 0) return;
		const delta = event.key === 'ArrowRight' ? 1 : -1;
		const next = tabs[(currentIndex + delta + tabs.length) % tabs.length];
		if (next === undefined) return;
		onSelect(next.id);
		// The roving tabindex moves with the selection; focus follows it.
		const list = event.currentTarget;
		window.requestAnimationFrame(() =>
			list
				.querySelector<HTMLElement>(`[id="${idPrefix}-tab-${next.id}"]`)
				?.focus(),
		);
	};

	return (
		<div
			className={`sidebar-group-tabs${showLabels ? ' sidebar-group-tabs--labelled' : ''}${className === undefined ? '' : ` ${className}`}`}
			role="tablist"
			aria-label={label}
			onKeyDown={handleKeyDown}
		>
			{tabs.map((tab) => {
				const selected = tab.id === activeTab;
				return (
					<button
						key={tab.id}
						type="button"
						role="tab"
						id={`${idPrefix}-tab-${tab.id}`}
						aria-label={tab.label}
						aria-selected={selected}
						aria-controls={panelId?.(tab.id) ?? `${idPrefix}-panel`}
						tabIndex={selected ? 0 : -1}
						className={`sidebar-group-tab${selected ? ' sidebar-group-tab--active' : ''}`}
						title={tab.label}
						onClick={() => onSelect(tab.id)}
					>
						{tab.icon}
						{showLabels ? (
							<span className="sidebar-group-tab__label">{tab.label}</span>
						) : null}
					</button>
				);
			})}
		</div>
	);
}
