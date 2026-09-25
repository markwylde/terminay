/**
 * Home, with its sidebar.
 *
 * Home is not a project, so its sidebar holds no Explorer, Documentation,
 * Agents, or Git panes. It is a menu over Home's three sections. It reuses the
 * project sidebar's geometry — the same split layout, width separator, and
 * narrow-layout drawer — so it inherits the drawer's focus and dismissal rules
 * rather than defining its own.
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

const SECTION_ICONS: Readonly<Record<HomeSection, ReactNode>> = {
	automations: <Workflow size={15} aria-hidden="true" />,
	home: <House size={15} aria-hidden="true" />,
	tabs: <LayoutList size={15} aria-hidden="true" />,
};

const ID_PREFIX = 'home-section';

export type HomeViewProps = Readonly<{
	/**
	 * The band across the top of Home, in Home's chrome colour: what Home's
	 * control opens into, as a project tab opens into its tab strip.
	 */
	band?: ReactNode;
	/** The selected section's content. */
	children: ReactNode;
	isSidebarVisible: boolean;
	/** Dismissal a person asked for (Escape, the scrim, the toggle). */
	onDismissSidebar: () => void;
	/**
	 * The narrow drawer closing itself because a section was chosen. It hides
	 * the drawer without changing the visibility this device remembers: only a
	 * person's own toggle does that.
	 */
	onSectionChosenInDrawer?: () => void;
	onSelectSection: (section: HomeSection) => void;
	onSidebarWidthCommit: (width: number) => void;
	section: HomeSection;
	sidebarWidth: number;
}>;

export function HomeView({
	band,
	children,
	isSidebarVisible,
	onDismissSidebar,
	onSectionChosenInDrawer,
	onSelectSection,
	onSidebarWidthCommit,
	section,
	sidebarWidth,
}: HomeViewProps) {
	const tabRefs = useRef(new Map<HomeSection, HTMLButtonElement | null>());

	const choose = (next: HomeSection) => {
		onSelectSection(next);
		// A drawer over a phone-width window has done its job once a section is
		// chosen; leaving it open would hide the section just picked.
		if (
			typeof window !== 'undefined' &&
			window.matchMedia(NARROW_LAYOUT_MEDIA_QUERY).matches
		) {
			(onSectionChosenInDrawer ?? onDismissSidebar)();
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const currentIndex = HOME_SECTIONS.indexOf(section);
		let nextIndex: number;
		switch (event.key) {
			case 'ArrowDown':
				nextIndex = (currentIndex + 1) % HOME_SECTIONS.length;
				break;
			case 'ArrowUp':
				nextIndex =
					(currentIndex - 1 + HOME_SECTIONS.length) % HOME_SECTIONS.length;
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
		if (next === undefined) return;
		// Arrow keys move the selection, as the project sidebar's group tabs do,
		// but never dismiss a drawer: the keyboard user is still in the menu.
		onSelectSection(next);
		tabRefs.current.get(next)?.focus();
	};

	return (
		<div className="home-view" data-terminay-home-view={section}>
			{band === undefined ? null : (
				<div className="home-band" data-terminay-home-band="true">
					{band}
				</div>
			)}
			<WorkspaceSplitLayout
				className="home-view__layout"
				isNavigationVisible={isSidebarVisible}
				navigation={
					isSidebarVisible ? (
						<nav className="home-sidebar" data-terminay-home-sidebar="true">
							<div
								className="home-sidebar__sections"
								role="tablist"
								aria-label="Home sections"
								aria-orientation="vertical"
								onKeyDown={handleKeyDown}
							>
								{HOME_SECTIONS.map((candidate) => {
									const selected = candidate === section;
									return (
										<button
											key={candidate}
											ref={(element) => {
												tabRefs.current.set(candidate, element);
											}}
											type="button"
											role="tab"
											id={`${ID_PREFIX}-tab-${candidate}`}
											aria-selected={selected}
											aria-controls={`${ID_PREFIX}-panel`}
											tabIndex={selected ? 0 : -1}
											className={`home-sidebar__section${selected ? ' home-sidebar__section--active' : ''}`}
											data-terminay-home-section-tab={candidate}
											onClick={() => choose(candidate)}
										>
											{SECTION_ICONS[candidate]}
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
				content={
					<div
						className="home-view__panel"
						id={`${ID_PREFIX}-panel`}
						// With the sidebar hidden there is no tab to label the panel,
						// so it names itself.
						{...(isSidebarVisible
							? {
									role: 'tabpanel',
									'aria-labelledby': `${ID_PREFIX}-tab-${section}`,
								}
							: { role: 'region', 'aria-label': HOME_SECTION_LABELS[section] })}
						data-terminay-home-section={section}
					>
						{children}
					</div>
				}
			/>
		</div>
	);
}
