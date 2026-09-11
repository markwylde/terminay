import { Reorder } from 'framer-motion';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import {
	type ActivityCountBadge,
	formatActivityCount,
} from './activityCountBadge';
import { ProjectSwitcherMenu } from './ProjectSwitcherMenu';
import { ProjectTabActivityBadge } from './ProjectTabActivityBadge';
import { type ProjectTab, projectTabIsBusy } from './projectTabModel';
import {
	fitProjectTabOverflow,
	insertVisibleIdByClientX,
	isProjectTabBarCompact,
	mergeVisibleProjectReorderByIds,
	PROJECT_TAB_OVERFLOW_ESTIMATED_WIDTH,
	PROJECT_TAB_OVERFLOW_FADE_WIDTH,
	PROJECT_TAB_OVERFLOW_SWITCHER_ESTIMATED_WIDTH,
	projectTabStripAvailableWidth,
	sameIdList,
} from './projectTabOverflow';

export type ProjectTabDropPreview = {
	index: number;
	preview: Pick<ProjectTab, 'color' | 'emoji' | 'title'>;
};

type ProjectTabListProps = {
	activeProjectId: string;
	activityBadgesByProject?: Record<string, ActivityCountBadge>;
	draggingProjectId: string | null;
	dropPreview: ProjectTabDropPreview | null;
	isDraggingTabTornOff: boolean;
	onActivate: (projectId: string) => void;
	onClose: (projectId: string) => void;
	onDragEnd: (projectId: string) => void | Promise<void>;
	onDragMove?: (projectId: string, offsetY: number) => void;
	onDragStart: (projectId: string) => void;
	onEdit: (projectId: string) => void | Promise<void>;
	onReorder: (projects: ProjectTab[]) => void;
	onReorderCommit?: (movedId: string) => void;
	onSwitcherOpen?: () => void;
	onCreateProject?: () => void;
	canCreateProject?: boolean;
	projects: ProjectTab[];
};

function ProjectTabPreview({
	project,
}: {
	project: Pick<ProjectTab, 'color' | 'emoji' | 'title'>;
}) {
	return (
		<li
			className="project-tab project-tab--drop-placeholder"
			style={{ '--project-color': project.color } as CSSProperties}
		>
			<span className="project-tab-main">
				{project.emoji ? (
					<span className="project-tab-emoji" aria-hidden="true">
						{project.emoji}
					</span>
				) : null}
				<span className="project-tab-title">{project.title}</span>
			</span>
		</li>
	);
}

export function activityBadgeLayoutKey(
	badges: Record<string, ActivityCountBadge> | undefined,
): string {
	if (!badges) return '';
	return Object.entries(badges)
		.filter(([, badge]) => badge.count > 0)
		.map(([id, badge]) => `${id}:${formatActivityCount(badge.count)}`)
		.sort()
		.join('|');
}

export function ProjectTabList({
	activeProjectId,
	activityBadgesByProject,
	draggingProjectId,
	dropPreview,
	isDraggingTabTornOff,
	onActivate,
	onClose,
	onDragEnd,
	onDragMove,
	onDragStart,
	onEdit,
	onReorder,
	onReorderCommit,
	onSwitcherOpen,
	onCreateProject,
	canCreateProject = true,
	projects,
}: ProjectTabListProps) {
	// A tab's identity is `(serverId, projectId)`, because project ids are
	// per-server namespaces: two attached servers restored from one data root
	// hand out the same ids for different projects. Composed tabs carry that
	// handle; a plain single-server list still identifies by project id.
	const keyOf = (project: ProjectTab & { readonly handle?: string }) =>
		project.handle ?? project.id;
	// A tab whose server is unreachable, reconnecting, or incompatible stays in
	// the strip so the composition is stable, greyed and taking no action.
	const isInert = (project: ProjectTab & { readonly inert?: boolean }) =>
		project.inert === true;
	const inertReason = (
		project: ProjectTab & { readonly inert?: boolean; readonly statusMessage?: string },
	) => (project.inert === true ? project.statusMessage : undefined);
	const namesServers =
		new Set(projects.map((project) => project.serverId)).size > 1;
	const serverLabelOf = (
		project: ProjectTab & { readonly serverLabel?: string },
	) => (namesServers ? (project.serverLabel ?? project.serverId) : undefined);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const widthsRef = useRef(new Map<string, number>());
	const [hiddenIds, setHiddenIds] = useState<string[]>([]);
	const [compact, setCompact] = useState(false);
	const hidden = new Set(hiddenIds);
	const visibleProjects = projects.filter(
		(project) => !hidden.has(keyOf(project)),
	);
	const visibleIds = visibleProjects.map(keyOf);
	const dropStateRef = useRef({
		hiddenIds,
		onReorder,
		projects,
		visibleIds,
	});
	dropStateRef.current = { hiddenIds, onReorder, projects, visibleIds };
	// A badge appearing, vanishing, or changing digit count changes a tab's
	// width without resizing the observed containers, so the overflow layout
	// must re-measure whenever this key changes.
	const badgeLayoutKey = activityBadgeLayoutKey(activityBadgesByProject);

	useLayoutEffect(() => {
		void badgeLayoutKey;
		const root = rootRef.current;
		const list = listRef.current;
		if (!root || !list) return;
		const tabbar = root.closest('.project-tabbar') ?? root;

		const layout = () => {
			if (draggingProjectId !== null) return;
			const nextCompact = isProjectTabBarCompact(tabbar.clientWidth);
			for (const element of list.querySelectorAll<HTMLElement>(
				'[data-tab-handle]',
			)) {
				const id = element.dataset.tabHandle;
				if (!id || element.classList.contains('project-tab--overflowed'))
					continue;
				if (element.offsetWidth > 0)
					widthsRef.current.set(id, element.offsetWidth);
			}
			const tabBarStyle = getComputedStyle(tabbar);
			const reservedWidth =
				(Number.parseFloat(tabBarStyle.paddingLeft) || 0) +
				(Number.parseFloat(tabBarStyle.paddingRight) || 0) +
				[...tabbar.children].reduce((sum, child) => {
					if (!(child instanceof HTMLElement) || child === root) return sum;
					return sum + child.offsetWidth;
				}, 0);
			const switcherButton = root.querySelector('.project-switcher-button');
			const switcherWidth =
				switcherButton instanceof HTMLElement && switcherButton.offsetWidth > 0
					? switcherButton.offsetWidth + 4
					: PROJECT_TAB_OVERFLOW_SWITCHER_ESTIMATED_WIDTH;
			root.style.setProperty(
				'--project-switcher-button-width',
				`${switcherWidth}px`,
			);
			root.style.setProperty(
				'--project-tab-overflow-fade',
				`${Math.max(PROJECT_TAB_OVERFLOW_FADE_WIDTH, Math.round(switcherWidth * 0.85))}px`,
			);
			const items = projects.map((project) => ({
				id: keyOf(project),
				width:
					widthsRef.current.get(keyOf(project)) ??
					PROJECT_TAB_OVERFLOW_ESTIMATED_WIDTH,
			}));
			const result = fitProjectTabOverflow({
				activeId: activeProjectId,
				availableWidth: projectTabStripAvailableWidth(
					tabbar.clientWidth,
					reservedWidth,
				),
				compact: nextCompact,
				items,
				overlapWidth: Math.max(
					PROJECT_TAB_OVERFLOW_FADE_WIDTH,
					Math.round(switcherWidth * 0.85),
				),
			});
			setCompact(result.layout === 'compact');
			setHiddenIds((current) =>
				sameIdList(current, result.hiddenIds) ? current : result.hiddenIds,
			);
		};

		const observer = new ResizeObserver(layout);
		observer.observe(tabbar);
		observer.observe(root);
		layout();
		return () => {
			observer.disconnect();
			document.body.classList.remove('project-tabbar-reordering');
		};
	}, [activeProjectId, badgeLayoutKey, draggingProjectId, projects]);

	const handleTabKeyDown = (
		event: KeyboardEvent<HTMLElement>,
		projectId: string,
	) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const sequence = visibleProjects.length > 0 ? visibleProjects : projects;
		const projectIndex = sequence.findIndex(
			(project) => keyOf(project) === projectId,
		);
		if (projectIndex < 0) return;
		const nextIndex =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? sequence.length - 1
					: (projectIndex +
							(event.key === 'ArrowRight' ? 1 : -1) +
							sequence.length) %
						sequence.length;
		const next = sequence[nextIndex];
		if (next === undefined) return;
		onActivate(keyOf(next));
		requestAnimationFrame(() =>
			document
				.querySelector<HTMLElement>(
					`[data-tab-handle="${CSS.escape(keyOf(next))}"]`,
				)
				?.focus(),
		);
	};

	const commitVisibleDrop = (projectId: string, clientX: number) => {
		const list = listRef.current;
		const {
			hiddenIds: hiddenNow,
			onReorder: reorder,
			projects: items,
			visibleIds: currentVisible,
		} = dropStateRef.current;
		if (!list) return;
		const centers = [...list.querySelectorAll<HTMLElement>('[data-tab-handle]')]
			.filter(
				(element) => !element.classList.contains('project-tab--overflowed'),
			)
			.flatMap((element) => {
				const id = element.dataset.tabHandle;
				if (!id) return [];
				const rect = element.getBoundingClientRect();
				return [{ id, center: rect.left + rect.width / 2 }];
			});
		const nextVisibleIds = insertVisibleIdByClientX(
			currentVisible,
			centers,
			projectId,
			clientX,
		);
		if (sameIdList(currentVisible, nextVisibleIds)) return;
		reorder(
			mergeVisibleProjectReorderByIds(
				items,
				nextVisibleIds,
				hiddenNow,
				keyOf,
			),
		);
	};

	return (
		<div
			ref={rootRef}
			className={`project-tabbar-projects${compact ? ' project-tabbar-projects--compact' : ''}${!compact && hiddenIds.length > 0 ? ' project-tabbar-projects--overflow' : ''}`}
			data-project-tab-layout={compact ? 'compact' : 'tabs'}
			data-project-tab-hidden-count={hiddenIds.length}
		>
			<div
				ref={listRef}
				className={`project-tabbar-list-slot${draggingProjectId !== null ? ' project-tabbar-list-slot--dragging' : ''}`}
			>
				<Reorder.Group
					axis="x"
					values={visibleIds}
					onReorder={(nextVisibleIds) =>
						onReorder(
							mergeVisibleProjectReorderByIds(
								projects,
								nextVisibleIds,
								hiddenIds,
								keyOf,
							),
						)
					}
					className="project-tabbar-list"
					role="tablist"
					aria-label="Projects"
				>
					{visibleProjects.flatMap((project) => [
						dropPreview?.index ===
						projects.findIndex((item) => keyOf(item) === keyOf(project)) ? (
							<ProjectTabPreview
								key="__drop-placeholder"
								project={dropPreview.preview}
							/>
						) : null,
						<Reorder.Item
							key={keyOf(project)}
							value={keyOf(project)}
							data-tab-handle={
								project.creationStatus === undefined
									? keyOf(project)
									: undefined
							}
							data-project-id={
								project.creationStatus === undefined ? project.id : undefined
							}
							data-server-id={project.serverId}
							data-pending-project-id={
								project.creationStatus === undefined ? undefined : project.id
							}
							className={`project-tab${keyOf(project) === activeProjectId ? ' project-tab--active' : ''}${keyOf(project) === draggingProjectId ? ' project-tab--dragging' : ''}${keyOf(project) === draggingProjectId && isDraggingTabTornOff ? ' project-tab--torn-off' : ''}${project.creationStatus ? ` project-tab--creation-${project.creationStatus}` : ''}${projectTabIsBusy(project) && project.creationStatus !== 'failed' ? ' project-tab--creation-loading' : ''}${isInert(project) ? ' project-tab--inert' : ''}`}
							role="tab"
							aria-selected={keyOf(project) === activeProjectId}
							aria-disabled={isInert(project) || undefined}
							title={
								inertReason(project) ??
								'Double-click or long-press to edit tab'
							}
							tabIndex={keyOf(project) === activeProjectId ? 0 : -1}
							style={{ '--project-color': project.color } as CSSProperties}
							dragMomentum={false}
							dragListener={project.creationStatus === undefined}
							transition={{ layout: { duration: 0 } }}
							onDragStart={() => {
								if (project.creationStatus !== undefined) return;
								document.body.classList.add('project-tabbar-reordering');
								onDragStart(keyOf(project));
							}}
							onDrag={(_event, info) =>
								onDragMove?.(keyOf(project), info.offset.y)
							}
							onDragEnd={(_event, info) => {
								commitVisibleDrop(keyOf(project), info.point.x);
								document.body.classList.remove('project-tabbar-reordering');
								void onDragEnd(keyOf(project));
							}}
							onClick={() => {
								if (project.creationStatus !== 'loading')
									onActivate(keyOf(project));
							}}
							onDoubleClick={() => {
								if (project.creationStatus === undefined && !isInert(project))
									void onEdit(keyOf(project));
							}}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onActivate(keyOf(project));
									return;
								}
								handleTabKeyDown(event, keyOf(project));
							}}
							whileDrag={{ scale: 1.05, zIndex: 50 }}
						>
							<span className="project-tab-main">
								{project.creationStatus === 'failed' ? (
									<span
										className="project-tab-creation-error"
										role="img"
										aria-label="Project creation failed"
									>
										!
									</span>
								) : projectTabIsBusy(project) ? (
									<span
										className="project-tab-creation-spinner"
										role="img"
										aria-label="Creating project"
									/>
								) : null}
								{project.creationStatus === undefined && project.emoji ? (
									<span className="project-tab-emoji" aria-hidden="true">
										{project.emoji}
									</span>
								) : null}
								<span className="project-tab-title">{project.title}</span>
								{/* The server is named only when the window is showing
								    more than one; with one server it is noise. */}
								{serverLabelOf(project) === undefined ? null : (
									<span className="project-tab-server">
										{serverLabelOf(project)}
									</span>
								)}
							</span>
							<ProjectTabActivityBadge
								badge={activityBadgesByProject?.[keyOf(project)]}
							/>
							<button
								type="button"
								disabled={project.creationStatus === 'loading'}
								className="project-tab-close"
								onClick={(event) => {
									event.stopPropagation();
									onClose(keyOf(project));
								}}
								aria-label={`Close ${project.title}`}
								title={
									projects.length <= 1 ? 'Close tab and exit app' : 'Close tab'
								}
							>
								<svg
									aria-hidden="true"
									width="12"
									height="12"
									viewBox="0 0 12 12"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									<path
										d="M9 3L3 9M3 3L9 9"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</svg>
							</button>
						</Reorder.Item>,
					])}
					{dropPreview && dropPreview.index >= projects.length ? (
						<ProjectTabPreview
							key="__drop-placeholder"
							project={dropPreview.preview}
						/>
					) : null}
				</Reorder.Group>
				{projects
					.filter((project) => hidden.has(keyOf(project)))
					.map((project) => (
						<div
							key={keyOf(project)}
							className="project-tab project-tab--overflowed"
							data-tab-handle={
								project.creationStatus === undefined
									? keyOf(project)
									: undefined
							}
							data-project-id={
								project.creationStatus === undefined ? project.id : undefined
							}
							data-server-id={project.serverId}
							data-pending-project-id={
								project.creationStatus === undefined ? undefined : project.id
							}
							aria-hidden="true"
							style={{ '--project-color': project.color } as CSSProperties}
						>
							<span className="project-tab-main">
								{project.emoji ? (
									<span className="project-tab-emoji" aria-hidden="true">
										{project.emoji}
									</span>
								) : null}
								<span className="project-tab-title">{project.title}</span>
								{/* The server is named only when the window is showing
								    more than one; with one server it is noise. */}
								{serverLabelOf(project) === undefined ? null : (
									<span className="project-tab-server">
										{serverLabelOf(project)}
									</span>
								)}
							</span>
							<ProjectTabActivityBadge
								badge={activityBadgesByProject?.[keyOf(project)]}
							/>
						</div>
					))}
			</div>
			{compact || hiddenIds.length > 0 ? (
				<ProjectSwitcherMenu
					activeProjectId={activeProjectId}
					activityBadgesByProject={activityBadgesByProject}
					canCreate={canCreateProject}
					compact={compact}
					hiddenCount={hiddenIds.length}
					onActivate={onActivate}
					onClose={onClose}
					onCreateProject={onCreateProject}
					onEdit={onEdit}
					onOpen={onSwitcherOpen}
					onReorder={onReorder}
					onReorderCommit={onReorderCommit}
					projects={projects}
				/>
			) : null}
		</div>
	);
}
