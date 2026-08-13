import { AnimatePresence, Reorder } from 'framer-motion';
import type { CSSProperties } from 'react';
import type { KeyboardEvent } from 'react';
import type { ProjectTab } from './projectTabModel';

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
	onDragStart: (projectId: string) => void;
	onEdit: (projectId: string) => void | Promise<void>;
	onReorder: (projects: ProjectTab[]) => void;
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
	onDragStart,
	onEdit,
	onReorder,
	projects,
}: ProjectTabListProps) {
	const handleTabKeyDown = (event: KeyboardEvent<HTMLElement>, projectIndex: number) => {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const nextIndex = event.key === 'Home'
			? 0
			: event.key === 'End'
				? projects.length - 1
				: (projectIndex + (event.key === 'ArrowRight' ? 1 : -1) + projects.length) % projects.length;
		const next = projects[nextIndex];
		if (next === undefined) return;
		onActivate(next.id);
		requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-project-id="${CSS.escape(next.id)}"]`)?.focus());
	};
	return (
		<Reorder.Group
			axis="x"
			values={projects}
			onReorder={onReorder}
			className="project-tabbar-list"
			role="tablist"
			aria-label="Projects"
		>
			<AnimatePresence initial={false}>
				{projects.flatMap((project, projectIndex) => [
					dropPreview?.index === projectIndex ? (
						<ProjectTabPreview key="__drop-placeholder" project={dropPreview.preview} />
					) : null,
					<Reorder.Item
						key={project.id}
						value={project}
						data-project-id={project.id}
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						className={`project-tab${project.id === activeProjectId ? ' project-tab--active' : ''}${project.id === draggingProjectId ? ' project-tab--dragging' : ''}${project.id === draggingProjectId && isDraggingTabTornOff ? ' project-tab--torn-off' : ''}`}
						role="tab"
						aria-selected={project.id === activeProjectId}
						tabIndex={project.id === activeProjectId ? 0 : -1}
						style={{ '--project-color': project.color } as CSSProperties}
						onDragStart={() => onDragStart(project.id)}
						onDragEnd={() => void onDragEnd(project.id)}
						onClick={() => onActivate(project.id)}
						onDoubleClick={() => void onEdit(project.id)}
						onKeyDown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								onActivate(project.id);
								return;
							}
							handleTabKeyDown(event, projectIndex);
						}}
						whileDrag={{ scale: 1.05, zIndex: 50 }}
						title="Double-click to edit tab"
					>
						<span className="project-tab-main">
							{project.projectEnvironmentId && project.projectEnvironmentId !== 'terminay:this-server' ? (
								<span
									className={`project-tab-environment project-tab-environment--${project.environmentStatus ?? 'ready'}`}
									role="img"
									aria-label={`${project.environmentLabel ?? 'Remote environment'} — ${project.environmentStatus ?? 'ready'}`}
									title={`${project.environmentLabel ?? 'Remote environment'} — ${project.environmentStatus ?? 'ready'}`}
								>
									⇄
								</span>
							) : null}
							{project.emoji ? (
								<span className="project-tab-emoji" aria-hidden="true">
									{project.emoji}
								</span>
							) : null}
							<span className="project-tab-title">{project.title}</span>
						</span>
						<button
							type="button"
							className="project-tab-close"
							onClick={(event) => {
								event.stopPropagation();
								onClose(project.id);
							}}
							aria-label={`Close ${project.title}`}
							title={projects.length <= 1 ? 'Close tab and exit app' : 'Close tab'}
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
					<ProjectTabPreview key="__drop-placeholder" project={dropPreview.preview} />
				) : null}
			</AnimatePresence>
		</Reorder.Group>
	);
}
