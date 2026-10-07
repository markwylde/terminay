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
	type WorkspaceDragDecision,
} from '../host/nativeActions';
import {
	computeDropIndex,
	createNativeProjectDragSession,
	projectDragPreviewWidth,
} from '../projectTabDrag';
import { recordBootstrapDiagnostic } from '../shared/rendererDiagnostics';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import {
	subscribeWorkspaceDragState,
	subscribeWorkspaceDropTarget,
} from '../host/nativeEvents';
import type { ProjectTab } from './projectTabModel';

/** Stay in-bar until the pointer leaves the strip; native tear-off is 100px. */
const PROJECT_TAB_NATIVE_DRAG_OFFSET_Y = 40;
/** How long a released tab waits for its project before it is forgotten. */
const DROPPED_PROJECT_ARRIVAL_TIMEOUT_MS = 10_000;

/** A project tab from another window held over, or released on, this bar. */
export type IncomingProjectDrop = {
	serverId: string;
	projectId: string;
	preview: Pick<ProjectTab, 'color' | 'emoji' | 'title'>;
	/** The tab it lands immediately before; null lands it last. */
	before: { serverId: string; projectId: string } | null;
	/** Released: the project is on its way and takes this place when it arrives. */
	dropped: boolean;
};

/** The visible tab a pointer at `x` would insert before, from tab centres. */
function projectTabAtDropX(
	bar: HTMLElement | null,
	x: number,
): IncomingProjectDrop['before'] {
	if (bar === null) return null;
	const tabs = [
		...bar.querySelectorAll<HTMLElement>(
			'.project-tab[data-project-id]:not(.project-tab--overflowed):not(.project-tab--torn-off)',
		),
	];
	const centers = tabs.map((tab) => {
		const rect = tab.getBoundingClientRect();
		return rect.left + rect.width / 2;
	});
	const tab = tabs[computeDropIndex(centers, x)];
	const serverId = tab?.dataset.serverId;
	const projectId = tab?.dataset.projectId;
	return serverId === undefined || projectId === undefined
		? null
		: { serverId, projectId };
}

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
	const nativeDragRef = useRef(
		createNativeProjectDragSession<
			Parameters<typeof beginWorkspaceDrag>[0],
			WorkspaceDragDecision
		>({
			begin: beginWorkspaceDrag,
			end: endWorkspaceDrag,
			onRefused: (error) => {
				recordBootstrapDiagnostic('workspace.drag.start-refused');
				console.warn('native project drag was refused', error);
			},
		}),
	);
	// Torn-off belongs to one drag: the host announces it, but a drag never
	// starts or ends torn off whether or not the host's retraction arrives.
	const [isDraggingTabTornOff, setDraggingTabTornOff] = useState(false);
	const projectTabBarRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => subscribeWorkspaceDragState(setDraggingTabTornOff), []);

	const [incomingProjectDrop, setIncomingProjectDrop] =
		useState<IncomingProjectDrop | null>(null);
	useEffect(
		() =>
			subscribeWorkspaceDropTarget((event) => {
				if (event.phase === 'leave') {
					// A released tab stays shown until its project arrives.
					setIncomingProjectDrop((current) =>
						current?.dropped ? current : null,
					);
					return;
				}
				setIncomingProjectDrop({
					serverId: event.serverId,
					projectId: event.projectId,
					preview: {
						title: event.title,
						emoji: event.emoji,
						color: event.color,
					},
					before: projectTabAtDropX(projectTabBarRef.current, event.x),
					dropped: event.phase === 'drop',
				});
			}),
		[],
	);
	const clearIncomingProjectDrop = useCallback(
		() => setIncomingProjectDrop(null),
		[],
	);
	const awaitingDroppedProject = incomingProjectDrop?.dropped === true;
	useEffect(() => {
		if (!awaitingDroppedProject) return;
		const timer = window.setTimeout(
			clearIncomingProjectDrop,
			DROPPED_PROJECT_ARRIVAL_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [awaitingDroppedProject, clearIncomingProjectDrop]);

	const handleProjectTabDragStart = useCallback((projectId: string) => {
		setDraggingProjectId(projectId);
		draggingProjectIdRef.current = projectId;
		setDraggingTabTornOff(false);
	}, [draggingProjectIdRef]);

	const handleProjectTabDragMove = useCallback(
		(projectId: string, offsetY: number) => {
			if (
				nativeDragRef.current.requested ||
				workspaceViewId === null ||
				Math.abs(offsetY) <= PROJECT_TAB_NATIVE_DRAG_OFFSET_Y
			) {
				return;
			}
			const project = projectsRef.current.find((item) => item.id === projectId);
			const tab = projectTabBarRef.current?.querySelector<HTMLElement>(
				`[data-project-id="${projectId}"]`,
			);
			nativeDragRef.current.start({
				viewId: workspaceViewId,
				projectId,
				preview: {
					title: project?.title ?? 'Project',
					emoji: project?.emoji ?? '',
					color: project?.color ?? '#4db5ff',
					width: projectDragPreviewWidth(
						tab ? tab.getBoundingClientRect().width : 160,
					),
				},
			});
		},
		[projectsRef, workspaceViewId],
	);

	const handleProjectTabDragEnd = useCallback(
		async (projectId: string) => {
			const nextIds = projectsRef.current.map((item) => item.id);
			const nextIndex = nextIds.indexOf(projectId);
			setDraggingProjectId(null);
			draggingProjectIdRef.current = null;
			const decision: WorkspaceDragDecision = (await nativeDragRef.current
				.finish()
				.catch(() => null)) ?? { action: 'reorder' };
			setDraggingTabTornOff(false);
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
		clearIncomingProjectDrop,
		draggingProjectId,
		handleProjectTabDragEnd,
		handleProjectTabDragMove,
		handleProjectTabDragStart,
		incomingProjectDrop,
		isDraggingTabTornOff,
		popoutProject,
		projectTabBarRef,
	};
}
