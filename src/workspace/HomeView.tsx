/**
 * Home's shell: its sidebar, beside whatever Home is showing.
 *
 * Home is not a project, so its sidebar holds no Explorer, Documentation,
 * Agents, or Changes panes. It lists Home's three sections and opens each as a
 * tab. It reuses the project sidebar's geometry — the same split layout, width
 * separator, and narrow-layout drawer — so it inherits the drawer's focus and
 * dismissal rules rather than defining its own.
 *
 * Home stays mounted while a project is in front, hidden and inert, so that
 * nothing typed into one of its tabs is lost by looking elsewhere.
 */

import { House, LayoutList, Workflow } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import {
	NARROW_LAYOUT_MEDIA_QUERY,
	WorkspaceSplitLayout,
} from '../shared/WorkspaceSplitLayout';
import {
	HOME_SECTION_LABELS,
	HOME_SECTIONS,
	type HomeSection,
} from './homeSection.ts';
import './homeView.css';

export const HOME_SECTION_ICONS: Readonly<Record<HomeSection, ReactNode>> = {
	automations: <Workflow size={15} aria-hidden="true" />,
	home: <House size={15} aria-hidden="true" />,
	tabs: <LayoutList size={15} aria-hidden="true" />,
};

const ID_PREFIX = 'home-section';

export type HomeViewProps = Readonly<{
	/** Home's tabs. */
	children: ReactNode;
	/** The section the tab in front belongs to; none when no tab is open. */
	currentSection: HomeSection | undefined;
	/** False while a project is in front: Home is kept, but out of the way. */
	isActive: boolean;
	isSidebarVisible: boolean;
	/** Dismissal a person asked for (Escape, the scrim, the toggle). */
	onDismissSidebar: () => void;
	/** Open a section as a tab, or bring its tab to the front. */
	onOpenSection: (section: HomeSection) => void;
	/**
	 * The narrow drawer closing itself because a section was chosen. It hides
	 * the drawer without changing the visibility this device remembers: only a
	 * person's own toggle does that.
	 */
	onSectionChosenInDrawer?: () => void;
	onSidebarWidthCommit: (width: number) => void;
	sidebarWidth: number;
}>;

export function HomeView({
	children,
	currentSection,
	isActive,
	isSidebarVisible,
	onDismissSidebar,
	onOpenSection,
	onSectionChosenInDrawer,
	onSidebarWidthCommit,
	sidebarWidth,
}: HomeViewProps) {
	const itemRefs = useRef(new Map<HomeSection, HTMLButtonElement | null>());
	const showsSidebar = isSidebarVisible && isActive;

	const choose = (next: HomeSection) => {
		onOpenSection(next);
		// A drawer over a phone-width window has done its job once a section is
		// chosen; leaving it open would hide the tab just opened.
		if (
			typeof window !== 'undefined' &&
			window.matchMedia(NARROW_LAYOUT_MEDIA_QUERY).matches
		) {
			(onSectionChosenInDrawer ?? onDismissSidebar)();
		}
	};

	// Arrow keys move through the list; opening a section is Enter or Space, as
	// on any button, so moving through the list never rearranges Home's tabs.
	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const focused = HOME_SECTIONS.findIndex(
			(candidate) => itemRefs.current.get(candidate) === document.activeElement,
		);
		const from = focused === -1 ? 0 : focused;
		let nextIndex: number;
		switch (event.key) {
			case 'ArrowDown':
				nextIndex = (from + 1) % HOME_SECTIONS.length;
				break;
			case 'ArrowUp':
				nextIndex = (from - 1 + HOME_SECTIONS.length) % HOME_SECTIONS.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = HOME_SECTIONS.length - 1;
				break;
			default:
				return;
		}
		event.preventDefault();
		const next = HOME_SECTIONS[nextIndex];
		if (next !== undefined) itemRefs.current.get(next)?.focus();
	};

	// One item is in the tab order: the current section, else the first.
	const tabStop = currentSection ?? HOME_SECTIONS[0];

	return (
		<div
			className={`home-view${isActive ? '' : ' home-view--hidden'}`}
			data-terminay-home-view={currentSection ?? 'none'}
			data-terminay-home-active={isActive ? 'true' : 'false'}
			inert={!isActive}
		>
			<WorkspaceSplitLayout
				className="home-view__layout"
				isNavigationVisible={showsSidebar}
				navigation={
					showsSidebar ? (
						<nav className="home-sidebar" data-terminay-home-sidebar="true">
							{/* An empty band, level with Home's tab strip, so the chrome
							    reads as one bar across the sidebar as it does in a
							    project. */}
							<div
								className="home-sidebar__band"
								data-terminay-home-sidebar-band="true"
								aria-hidden="true"
							/>
							<div
								className="home-sidebar__sections"
								role="tablist"
								aria-label="Home sections"
								aria-orientation="vertical"
								onKeyDown={handleKeyDown}
							>
								{HOME_SECTIONS.map((candidate) => {
									const current = candidate === currentSection;
									return (
										<button
											key={candidate}
											ref={(element) => {
												itemRefs.current.set(candidate, element);
											}}
											type="button"
											role="tab"
											id={`${ID_PREFIX}-item-${candidate}`}
											aria-selected={current}
											tabIndex={candidate === tabStop ? 0 : -1}
											className={`home-sidebar__section${current ? ' home-sidebar__section--active' : ''}`}
											data-terminay-home-section-tab={candidate}
											onClick={() => choose(candidate)}
										>
											{HOME_SECTION_ICONS[candidate]}
											<span className="home-sidebar__label">
												{HOME_SECTION_LABELS[candidate]}
											</span>
										</button>
									);
								})}
							</div>
						</nav>
					) : null
				}
				navigationWidth={sidebarWidth}
				onNavigationDismiss={onDismissSidebar}
				onNavigationWidthCommit={onSidebarWidthCommit}
				content={<div className="home-view__panel">{children}</div>}
			/>
		</div>
	);
}
