import { Reorder } from 'framer-motion';
import type { CSSProperties, KeyboardEvent } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { ProjectSwitcherMenu } from './ProjectSwitcherMenu';
import type { ProjectTab } from './projectTabModel';
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

export function ProjectTabList({
	activeProjectId,
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
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const widthsRef = useRef(new Map<string, number>());
	const [hiddenIds, setHiddenIds] = useState<string[]>([]);
	const [compact, setCompact] = useState(false);
	const hidden = new Set(hiddenIds);
	const visibleProjects = projects.filter((project) => !hidden.has(project.id));
	const visibleIds = visibleProjects.map((project) => project.id);
	const dropStateRef = useRef({
		hiddenIds,
		onReorder,
		projects,
		visibleIds,
	});
	dropStateRef.current = { hiddenIds, onReorder, projects, visibleIds };

	useLayoutEffect(() => {
		const root = rootRef.current;
		const list = listRef.current;
		if (!root || !list) return;
		const tabbar = root.closest('.project-tabbar') ?? root;

		const layout = () => {
			if (draggingProjectId !== null) return;
			const nextCompact = isProjectTabBarCompact(tabbar.clientWidth);
			for (const element of list.querySelectorAll<HTMLElement>(
				'[data-project-id]',
			)) {
				const id = element.dataset.projectId;
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
				id: project.id,
				width:
					widthsRef.current.get(project.id) ??
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
	}, [activeProjectId, draggingProjectId, projects]);

	const handleTabKeyDown = (
		event: KeyboardEvent<HTMLElement>,
		projectId: string,
	) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const sequence = visibleProjects.length > 0 ? visibleProjects : projects;
		const projectIndex = sequence.findIndex(
			(project) => project.id === projectId,
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
		onActivate(next.id);
		requestAnimationFrame(() =>
			document
				.querySelector<HTMLElement>(
					`[data-project-id="${CSS.escape(next.id)}"]`,
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
		const centers = [...list.querySelectorAll<HTMLElement>('[data-project-id]')]
			.filter((element) => !element.classList.contains('project-tab--overflowed'))
			.flatMap((element) => {
				const id = element.dataset.projectId;
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
		reorder(mergeVisibleProjectReorderByIds(items, nextVisibleIds, hiddenNow));
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
							),
						)
					}
					className="project-tabbar-list"
					role="tablist"
					aria-label="Projects"
				>
					{visibleProjects.flatMap((project) => [
						dropPreview?.index ===
						projects.findIndex((item) => item.id === project.id) ? (
							<ProjectTabPreview
								key="__drop-placeholder"
								project={dropPreview.preview}
							/>
						) : null,
						<Reorder.Item
							key={project.id}
							value={project.id}
							data-project-id={
								project.creationStatus === undefined ? project.id : undefined
							}
							data-pending-project-id={
								project.creationStatus === undefined ? undefined : project.id
							}
							className={`project-tab${project.id === activeProjectId ? ' project-tab--active' : ''}${project.id === draggingProjectId ? ' project-tab--dragging' : ''}${project.id === draggingProjectId && isDraggingTabTornOff ? ' project-tab--torn-off' : ''}${project.creationStatus ? ` project-tab--creation-${project.creationStatus}` : ''}`}
							role="tab"
							aria-selected={project.id === activeProjectId}
							tabIndex={project.id === activeProjectId ? 0 : -1}
							style={{ '--project-color': project.color } as CSSProperties}
							dragMomentum={false}
							dragListener={project.creationStatus === undefined}
							transition={{ layout: { duration: 0 } }}
							onDragStart={() => {
								if (project.creationStatus !== undefined) return;
								document.body.classList.add('project-tabbar-reordering');
								onDragStart(project.id);
							}}
							onDrag={(_event, info) => onDragMove?.(project.id, info.offset.y)}
							onDragEnd={(_event, info) => {
								commitVisibleDrop(project.id, info.point.x);
								document.body.classList.remove('project-tabbar-reordering');
								void onDragEnd(project.id);
							}}
							onClick={() => {
								if (project.creationStatus !== 'loading') onActivate(project.id);
							}}
							onDoubleClick={() => {
								if (project.creationStatus === undefined) void onEdit(project.id);
							}}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onActivate(project.id);
									return;
								}
								handleTabKeyDown(event, project.id);
							}}
							whileDrag={{ scale: 1.05, zIndex: 50 }}
							title="Double-click to edit tab"
						>
							<span className="project-tab-main">
								{project.creationStatus === 'loading' ? (
									<span
										className="project-tab-creation-spinner"
										role="img"
										aria-label="Creating project"
									/>
								) : project.creationStatus === 'failed' ? (
									<span
										className="project-tab-creation-error"
										role="img"
										aria-label="Project creation failed"
									>
										!
									</span>
								) : project.projectEnvironmentId &&
								project.projectEnvironmentId !== 'terminay:this-server' ? (
									<span
										className={`project-tab-environment project-tab-environment--${project.environmentStatus ?? 'ready'}`}
										role="img"
										aria-label={`${project.environmentLabel ?? 'Remote environment'} — ${project.environmentStatus ?? 'ready'}`}
										title={`${project.environmentLabel ?? 'Remote environment'} — ${project.environmentStatus ?? 'ready'}`}
									>
										⇄
									</span>
								) : null}
								{project.creationStatus === undefined && project.emoji ? (
									<span className="project-tab-emoji" aria-hidden="true">
										{project.emoji}
									</span>
								) : null}
								<span className="project-tab-title">{project.title}</span>
							</span>
							<button
								type="button"
								disabled={project.creationStatus === 'loading'}
								className="project-tab-close"
								onClick={(event) => {
									event.stopPropagation();
									onClose(project.id);
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
					.filter((project) => hidden.has(project.id))
					.map((project) => (
						<div
							key={project.id}
							className="project-tab project-tab--overflowed"
							data-project-id={
								project.creationStatus === undefined ? project.id : undefined
							}
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
							</span>
						</div>
					))}
			</div>
			{compact || hiddenIds.length > 0 ? (
				<ProjectSwitcherMenu
					activeProjectId={activeProjectId}
					canCreate={canCreateProject}
					compact={compact}
					hiddenCount={hiddenIds.length}
					onActivate={onActivate}
					onClose={onClose}
					onCreateProject={onCreateProject}
					onOpen={onSwitcherOpen}
					onReorder={onReorder}
					onReorderCommit={onReorderCommit}
					projects={projects}
				/>
			) : null}
		</div>
	);
}
