import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import {
	beginWorkspaceDrag,
	closeHostPresentation,
	endWorkspaceDrag,
	presentWorkspaceView,
} from '../host/nativeActions';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import { subscribeWorkspaceDragState } from '../host/nativeEvents';
import type { ProjectTabDragPreview } from '../types/terminay';
import type { ProjectTab } from './projectTabModel';

/** Stay in-bar until the pointer leaves the strip; native tear-off is 100px. */
const PROJECT_TAB_NATIVE_DRAG_OFFSET_Y = 40;

export function useProjectTabTransfer({
	draggingProjectIdRef,
	projectsRef,
	workspaceSnapshotStore,
	workspaceViewId,
}: {
	draggingProjectIdRef: MutableRefObject<string | null>;
	projectsRef: MutableRefObject<ProjectTab[]>;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
	workspaceViewId: string | null;
}) {
	const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
		null,
	);
	const nativeDragStartedRef = useRef(false);
	const [isDraggingTabTornOff, setDraggingTabTornOff] = useState(false);
	const projectTabBarRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => subscribeWorkspaceDragState(setDraggingTabTornOff), []);

	const handleProjectTabDragStart = useCallback((projectId: string) => {
		setDraggingProjectId(projectId);
		draggingProjectIdRef.current = projectId;
		nativeDragStartedRef.current = false;
	}, [draggingProjectIdRef]);

	const handleProjectTabDragMove = useCallback(
		(projectId: string, offsetY: number) => {
			if (
				nativeDragStartedRef.current ||
				workspaceViewId === null ||
				Math.abs(offsetY) <= PROJECT_TAB_NATIVE_DRAG_OFFSET_Y
			) {
				return;
			}
			nativeDragStartedRef.current = true;
			const project = projectsRef.current.find((item) => item.id === projectId);
			const tab = projectTabBarRef.current?.querySelector<HTMLElement>(
				`[data-project-id="${projectId}"]`,
			);
			void beginWorkspaceDrag({
				viewId: workspaceViewId,
				preview: {
					title: project?.title ?? 'Project',
					emoji: project?.emoji ?? '',
					color: project?.color ?? '#4db5ff',
					width: tab ? Math.round(tab.getBoundingClientRect().width) : 160,
				},
			});
		},
		[projectsRef, workspaceViewId],
	);

	const handleProjectTabDragEnd = useCallback(
		async (projectId: string) => {
			const nextIds = projectsRef.current.map((item) => item.id);
			const nextIndex = nextIds.indexOf(projectId);
			const startedNative = nativeDragStartedRef.current;
			nativeDragStartedRef.current = false;
			setDraggingProjectId(null);
			draggingProjectIdRef.current = null;
			if (workspaceSnapshotStore === undefined || workspaceViewId === null)
				return;
			const project = projectsRef.current.find((item) => item.id === projectId);
			if (project === undefined) return;
			const persistReorder = async () => {
				if (nextIndex < 0) return;
				const current =
					workspaceSnapshotStore.snapshot?.views[workspaceViewId]
						?.projectIds ?? [];
				if (
					current.length === nextIds.length &&
					current.every((id, position) => id === nextIds[position])
				) {
					return;
				}
				await workspaceSnapshotStore.moveProject({
					index: nextIndex,
					projectId,
					targetViewId: workspaceViewId,
				});
			};
			if (!startedNative) {
				await persistReorder();
				return;
			}
			const decision = await endWorkspaceDrag().catch(() => ({
				action: 'reorder' as const,
			}));
			if (decision.action === 'reorder') {
				await persistReorder();
				return;
			}
			const targetViewId =
				decision.action === 'merge'
					? decision.targetViewId
					: `view-${crypto.randomUUID()}`;
			// Capture this before moving.  After a two-project source moves one
			// project, its reconciled list has length one but it must remain open.
			const sourceWillBeEmpty = projectsRef.current.length === 1;
			let created = false;
			try {
				if (decision.action === 'popout') {
					await workspaceSnapshotStore.createView({
						viewId: targetViewId,
						name: project.title,
					});
					created = true;
				}
				await workspaceSnapshotStore.moveProject({ projectId, targetViewId });
				if (decision.action === 'popout') {
					await presentWorkspaceView(targetViewId, decision);
				}
				if (sourceWillBeEmpty) {
					await workspaceSnapshotStore.closeView(workspaceViewId);
					await closeHostPresentation();
				}
			} catch {
				await workspaceSnapshotStore
					.moveProject({ projectId, targetViewId: workspaceViewId })
					.catch(() => undefined);
				if (created) {
					await workspaceSnapshotStore
						.closeView(targetViewId)
						.catch(() => undefined);
				}
			}
		},
		[
			draggingProjectIdRef,
			projectsRef,
			workspaceSnapshotStore,
			workspaceViewId,
		],
	);

	/** A native popout is a second presentation of a server-owned workspace
	 * view, never a renderer-created Dockview window.  Moving the active
	 * project preserves its terminal/session ownership while the host presents
	 * the newly-created logical view. */
	const popoutProject = useCallback(
		async (projectId: string) => {
			if (workspaceSnapshotStore === undefined || workspaceViewId === null)
				return;
			const project = projectsRef.current.find((item) => item.id === projectId);
			if (project === undefined) return;
			const targetViewId = `view-${crypto.randomUUID()}`;
			// This is source ownership before the authoritative move, not the
			// asynchronously reconciled post-move tab count.
			const sourceWillBeEmpty = projectsRef.current.length === 1;
			let created = false;
			try {
				await workspaceSnapshotStore.createView({
					viewId: targetViewId,
					name: project.title,
				});
				created = true;
				await workspaceSnapshotStore.moveProject({ projectId, targetViewId });
				await presentWorkspaceView(targetViewId, { x: 120, y: 120 });
				if (sourceWillBeEmpty) {
					await workspaceSnapshotStore.closeView(workspaceViewId);
					await closeHostPresentation();
				}
			} catch {
				await workspaceSnapshotStore
					.moveProject({ projectId, targetViewId: workspaceViewId })
					.catch(() => undefined);
				if (created) {
					await workspaceSnapshotStore
						.closeView(targetViewId)
						.catch(() => undefined);
				}
			}
		},
		[projectsRef, workspaceSnapshotStore, workspaceViewId],
	);

	return {
		draggingProjectId,
		dropPreview: null as {
			index: number;
			preview: ProjectTabDragPreview;
		} | null,
		handleProjectTabDragEnd,
		handleProjectTabDragMove,
		handleProjectTabDragStart,
		isDraggingTabTornOff,
		isProjectDropTarget: false,
		popoutProject,
		projectTabBarRef,
	};
}
