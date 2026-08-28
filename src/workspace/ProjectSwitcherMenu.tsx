import { ChevronDown, GripVertical, Plus } from 'lucide-react';
import type {
	CSSProperties,
	KeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { projectTabIsBusy, type ProjectTab } from './projectTabModel';
import { moveItemByDrop } from './projectTabOverflow';

export function ProjectSwitcherMenu({
	activeProjectId,
	canCreate = true,
	compact,
	hiddenCount,
	onActivate,
	onClose,
	onCreateProject,
	onOpen,
	onReorder,
	onReorderCommit,
	projects,
}: {
	activeProjectId: string;
	canCreate?: boolean;
	compact: boolean;
	hiddenCount: number;
	onActivate: (projectId: string) => void;
	onClose: (projectId: string) => void;
	onCreateProject?: () => void;
	onOpen?: () => void;
	onReorder: (projects: ProjectTab[]) => void;
	onReorderCommit?: (movedId: string) => void;
	projects: ProjectTab[];
}) {
	const [open, setOpen] = useState(false);
	const [draggedId, setDraggedId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		position: 'before' | 'after';
	} | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const projectsRef = useRef(projects);
	const onReorderRef = useRef(onReorder);
	const onReorderCommitRef = useRef(onReorderCommit);
	projectsRef.current = projects;
	onReorderRef.current = onReorder;
	onReorderCommitRef.current = onReorderCommit;
	const dragRef = useRef<{
		active: boolean;
		pointerId: number;
		sourceId: string;
		startY: number;
		targetId?: string;
		targetPosition?: 'before' | 'after';
	} | null>(null);
	const active =
		projects.find((project) => project.id === activeProjectId) ?? projects[0];
	const badgeCount = compact ? projects.length : hiddenCount;
	const label = compact
		? (active?.title ?? 'Projects')
		: `${projects.length} project${projects.length === 1 ? '' : 's'}`;
	const buttonState = compact
		? `Switch project, ${label}`
		: `Open project menu, ${projects.length} projects${hiddenCount > 0 ? `, ${hiddenCount} hidden` : ''}`;

	const resetDrag = useCallback(() => {
		dragRef.current = null;
		document.body.classList.remove('project-switcher-reordering');
		setDraggedId(null);
		setDropTarget(null);
	}, []);

	useLayoutEffect(() => {
		if (!open || !compact) return;
		const root = rootRef.current;
		const menu = root?.querySelector('.project-switcher-menu');
		if (!(root instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;
		const place = () => {
			const tabbar = root.closest('.project-tabbar');
			const rect = (
				tabbar instanceof HTMLElement ? tabbar : root
			).getBoundingClientRect();
			root.style.setProperty(
				'--project-switcher-menu-top',
				`${Math.round(rect.bottom + 6)}px`,
			);
		};
		place();
		window.addEventListener('resize', place);
		return () => {
			window.removeEventListener('resize', place);
			root.style.removeProperty('--project-switcher-menu-top');
		};
	}, [compact, open]);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (dragRef.current) return;
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			) {
				setOpen(false);
			}
		};
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		window.addEventListener('pointerdown', closeOutside);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('pointerdown', closeOutside);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (!drag.active) {
				if (Math.abs(event.clientY - drag.startY) < 4) return;
				drag.active = true;
				document.body.classList.add('project-switcher-reordering');
				setDraggedId(drag.sourceId);
			}
			event.preventDefault();
			const rows = [
				...(rootRef.current?.querySelectorAll<HTMLElement>(
					'[data-project-switcher-row]',
				) ?? []),
			];
			let nearest: { element: HTMLElement; distance: number } | undefined;
			for (const element of rows) {
				const rect = element.getBoundingClientRect();
				const distance =
					event.clientY < rect.top
						? rect.top - event.clientY
						: event.clientY > rect.bottom
							? event.clientY - rect.bottom
							: 0;
				if (!nearest || distance < nearest.distance)
					nearest = { element, distance };
			}
			const targetId = nearest?.element.dataset.projectSwitcherRow;
			if (!nearest || !targetId || targetId === drag.sourceId) {
				drag.targetId = undefined;
				drag.targetPosition = undefined;
				setDropTarget(null);
				return;
			}
			const rect = nearest.element.getBoundingClientRect();
			const position =
				event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
			drag.targetId = targetId;
			drag.targetPosition = position;
			setDropTarget((current) =>
				current?.id === targetId && current.position === position
					? current
					: { id: targetId, position },
			);
		};
		const onPointerEnd = (event: PointerEvent) => {
			const drag = dragRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (drag.active && drag.targetId && drag.targetPosition) {
				onReorderRef.current(
					moveItemByDrop(
						projectsRef.current,
						drag.sourceId,
						drag.targetId,
						drag.targetPosition,
					),
				);
				onReorderCommitRef.current?.(drag.sourceId);
			}
			resetDrag();
		};
		window.addEventListener('pointermove', onPointerMove, { passive: false });
		window.addEventListener('pointerup', onPointerEnd);
		window.addEventListener('pointercancel', onPointerEnd);
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerEnd);
			window.removeEventListener('pointercancel', onPointerEnd);
			document.body.classList.remove('project-switcher-reordering');
		};
	}, [resetDrag]);

	const toggle = () => {
		setOpen((current) => {
			const next = !current;
			if (next) onOpen?.();
			else resetDrag();
			return next;
		});
	};

	const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const items = [
			...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
				'[data-project-switcher-item]',
			) ?? []),
		];
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			items[index < 0 ? 0 : (index + 1) % items.length]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			items[
				index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
			]?.focus();
		}
	};

	const beginReorder = (
		event: ReactPointerEvent<HTMLButtonElement>,
		projectId: string,
	) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		document.body.classList.add('project-switcher-reordering');
		dragRef.current = {
			active: false,
			pointerId: event.pointerId,
			sourceId: projectId,
			startY: event.clientY,
		};
		setDropTarget(null);
	};

	if (projects.length === 0 || active === undefined) return null;

	return (
		<div
			ref={rootRef}
			className={`project-switcher${open ? ' project-switcher--open' : ''}${compact ? ' project-switcher--compact' : ''}`}
			style={{ '--project-color': active.color } as CSSProperties}
		>
			<button
				type="button"
				className="project-switcher-button"
				onClick={toggle}
				title={buttonState}
				aria-label={buttonState}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				{compact && active.emoji ? (
					<span className="project-switcher-button__emoji" aria-hidden="true">
						{active.emoji}
					</span>
				) : (
					<span
						className="project-switcher-button__swatch"
						aria-hidden="true"
					/>
				)}
				<span className="project-switcher-button__label">{label}</span>
				<span className="project-switcher-button__meta">
					{badgeCount > 0 ? (
						<span className="project-switcher-button__count" aria-hidden="true">
							{badgeCount}
						</span>
					) : null}
					<ChevronDown
						className="project-switcher-button__chevron"
						size={12}
						aria-hidden="true"
					/>
				</span>
			</button>
			{open ? (
				<div
					className="project-switcher-menu"
					role="menu"
					aria-label="Projects"
					onKeyDown={handleMenuKeyDown}
				>
					<div className="project-switcher-menu__section-label">
						All projects
					</div>
					{projects.map((project) => (
						<div
							key={project.id}
							className={`project-switcher-menu__row${project.id === activeProjectId ? ' project-switcher-menu__row--active' : ''}${draggedId === project.id ? ' project-switcher-menu__row--dragging' : ''}${dropTarget?.id === project.id ? ` project-switcher-menu__row--drop-${dropTarget.position}` : ''}`}
							style={{ '--project-color': project.color } as CSSProperties}
							data-project-switcher-row={project.id}
						>
							<button
								type="button"
								className="project-switcher-menu__grip"
								disabled={project.creationStatus !== undefined}
								onPointerDown={(event) => beginReorder(event, project.id)}
								aria-label={`Reorder ${project.title}`}
								title="Drag to reorder"
							>
								<GripVertical size={12} aria-hidden="true" />
							</button>
							<button
								type="button"
								className="project-switcher-menu__item"
								data-project-switcher-item={project.id}
								role="menuitem"
								onClick={() => {
									if (project.creationStatus === 'loading') return;
									onActivate(project.id);
									setOpen(false);
								}}
							>
								{projectTabIsBusy(project) ? (
									<span
										className="project-tab-creation-spinner"
										role="img"
										aria-label={
											project.creationStatus === 'loading'
												? 'Creating project'
												: 'Connecting project'
										}
									/>
								) : (
									<span
										className="project-switcher-menu__swatch"
										aria-hidden="true"
									/>
								)}
								{project.creationStatus === undefined && project.emoji ? (
									<span
										className="project-switcher-menu__emoji"
										aria-hidden="true"
									>
										{project.emoji}
									</span>
								) : null}
								<span className="project-switcher-menu__title">
									{project.title}
								</span>
								{project.id === activeProjectId ? (
									<span
										className="project-switcher-menu__check"
										aria-hidden="true"
									>
										✓
									</span>
								) : null}
							</button>
							<button
								type="button"
								className="project-switcher-menu__close"
								onClick={(event) => {
									event.stopPropagation();
									onClose(project.id);
								}}
								disabled={
									projects.length <= 1 || project.creationStatus === 'loading'
								}
								aria-label={`Close ${project.title}`}
							>
								×
							</button>
						</div>
					))}
					{compact && onCreateProject ? (
						<button
							type="button"
							className="project-switcher-menu__create"
							data-project-switcher-item="__create"
							role="menuitem"
							disabled={!canCreate}
							aria-label="Create project on This server"
							onClick={() => {
								onCreateProject();
								setOpen(false);
							}}
						>
							<Plus size={14} aria-hidden="true" />
							New project
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
