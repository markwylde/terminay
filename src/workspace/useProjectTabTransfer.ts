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

export function useProjectTabTransfer({
	projectsRef,
	workspaceSnapshotStore,
	workspaceViewId,
}: {
	projectsRef: MutableRefObject<ProjectTab[]>;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
	workspaceViewId: string | null;
}) {
	const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
		null,
	);
	const [isDraggingTabTornOff, setDraggingTabTornOff] = useState(false);
	const projectTabBarRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => subscribeWorkspaceDragState(setDraggingTabTornOff), []);

	/** A native window may only be presented after the source renderer has
	 * observed the server-authoritative move.  Presenting on the command ack
	 * alone races the workspace delta: two renderers can briefly claim the
	 * project, and a just-created child can be torn down with that stale view. */
	const awaitProjectMove = useCallback(
		async (projectId: string, targetViewId: string) => {
			const snapshot = await workspaceSnapshotStore?.waitForSnapshot(
				(candidate) =>
					candidate.views[workspaceViewId ?? '']?.projectIds.includes(
						projectId,
					) === false &&
					candidate.views[targetViewId]?.projectIds.includes(projectId) ===
						true,
				{ timeoutMs: 10_000 },
			);
			if (snapshot === null || snapshot === undefined) {
				const reason = workspaceSnapshotStore?.status.error?.message;
				throw new Error(
					reason === undefined
						? 'Timed out waiting for the project move to reconcile.'
						: `Unable to reconcile the project move. ${reason}`,
				);
			}
			return snapshot;
		},
		[workspaceSnapshotStore, workspaceViewId],
	);

	const handleProjectTabDragStart = useCallback(
		(projectId: string) => {
			setDraggingProjectId(projectId);
			if (workspaceViewId === null) return;
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
			setDraggingProjectId(null);
			if (workspaceSnapshotStore === undefined || workspaceViewId === null)
				return;
			const project = projectsRef.current.find((item) => item.id === projectId);
			if (project === undefined) return;
			const decision = await endWorkspaceDrag().catch(() => ({
				action: 'reorder' as const,
			}));
			if (decision.action === 'reorder') return;
			const targetViewId =
				decision.action === 'merge'
					? decision.targetViewId
					: `view-${crypto.randomUUID()}`;
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
				await awaitProjectMove(projectId, targetViewId);
				if (decision.action === 'popout') {
					await presentWorkspaceView(targetViewId, decision);
				}
				if (projectsRef.current.length === 1) {
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
		[awaitProjectMove, projectsRef, workspaceSnapshotStore, workspaceViewId],
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
			let created = false;
			try {
				await workspaceSnapshotStore.createView({
					viewId: targetViewId,
					name: project.title,
				});
				created = true;
				await workspaceSnapshotStore.moveProject({ projectId, targetViewId });
				await awaitProjectMove(projectId, targetViewId);
				await presentWorkspaceView(targetViewId, { x: 120, y: 120 });
				if (projectsRef.current.length === 1) {
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
		[awaitProjectMove, projectsRef, workspaceSnapshotStore, workspaceViewId],
	);

	return {
		draggingProjectId,
		dropPreview: null as {
			index: number;
			preview: ProjectTabDragPreview;
		} | null,
		handleProjectTabDragEnd,
		handleProjectTabDragStart,
		isDraggingTabTornOff,
		isProjectDropTarget: false,
		popoutProject,
		projectTabBarRef,
	};
}
