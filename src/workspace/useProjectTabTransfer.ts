import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { computeDropIndex } from '../projectTabDrag';
import type {
	AdoptedProjectPayload,
	ProjectTabDragPreview,
	ProjectTabDragResult,
} from '../types/terminay';
import type { ProjectTab } from './projectTabModel';

type MovedProject = {
	terminals: unknown[];
	activeSessionId: string | null;
};

export function useProjectTabTransfer({
	closeProject,
	exportProject,
	isAdoptWindow,
	onAdopt,
	projectsRef,
}: {
	closeProject: (projectId: string) => void;
	exportProject: (projectId: string) => MovedProject | null;
	isAdoptWindow: boolean;
	onAdopt: (payload: AdoptedProjectPayload, insertIndex: number | null) => void;
	projectsRef: MutableRefObject<ProjectTab[]>;
}) {
	const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
	const [isProjectDropTarget, setIsProjectDropTarget] = useState(false);
	const [isDraggingTabTornOff, setIsDraggingTabTornOff] = useState(false);
	const projectTabBarRef = useRef<HTMLDivElement | null>(null);
	const [dropPreview, setDropPreview] = useState<{
		index: number;
		preview: ProjectTabDragPreview;
	} | null>(null);
	const dropPreviewIndexRef = useRef<number | null>(null);
	const dropTargetTabCentersRef = useRef<number[] | null>(null);

	const adopt = useCallback(
		(payload: AdoptedProjectPayload) => {
			onAdopt(payload, dropPreviewIndexRef.current);
			dropPreviewIndexRef.current = null;
			dropTargetTabCentersRef.current = null;
			setDropPreview(null);
			setIsProjectDropTarget(false);
		},
		[onAdopt],
	);

	const handleProjectTabDragStart = useCallback(
		(projectId: string) => {
			setDraggingProjectId(projectId);
			const project = projectsRef.current.find((item) => item.id === projectId);
			const tab = projectTabBarRef.current?.querySelector<HTMLElement>(
				`[data-project-id="${projectId}"]`,
			);
			void window.terminayProjectTabHost?.startDrag({
				title: project?.title ?? 'Project',
				emoji: project?.emoji ?? '',
				color: project?.color ?? '#4db5ff',
				width: tab ? Math.round(tab.getBoundingClientRect().width) : 160,
			});
		},
		[projectsRef],
	);

	const handleProjectTabDragEnd = useCallback(
		async (projectId: string) => {
			setDraggingProjectId(null);
			setIsDraggingTabTornOff(false);
			let decision: ProjectTabDragResult;
			try {
				decision = (await window.terminayProjectTabHost?.endDrag()) ?? {
					action: 'reorder',
				};
			} catch {
				return;
			}
			if (decision.action === 'reorder') return;
			const project = projectsRef.current.find((item) => item.id === projectId);
			const moved = exportProject(projectId);
			if (!project || !moved) return;
			const payload: AdoptedProjectPayload = {
				project: project as unknown as AdoptedProjectPayload['project'],
				terminals:
					moved.terminals as unknown as AdoptedProjectPayload['terminals'],
				activeSessionId: moved.activeSessionId,
			};
			if (decision.action === 'merge') {
				await window.terminayWorkspaceTransferHost?.mergeProject(
					payload,
					decision.targetWindowId,
				);
			} else {
				await window.terminayWorkspaceTransferHost?.popoutProject(
					payload,
					decision.x,
					decision.y,
				);
			}
			closeProject(projectId);
		},
		[closeProject, exportProject, projectsRef],
	);

	useEffect(() => {
		const unsubscribe =
			window.terminayWorkspaceTransferHost?.subscribeAdoptedProject(adopt);
		if (isAdoptWindow) {
			void window.terminayWorkspaceTransferHost
				?.getAdoptedProject()
				.then((payload) => payload && adopt(payload));
		}
		return () => unsubscribe?.();
	}, [adopt, isAdoptWindow]);

	useEffect(
		() =>
			window.terminayProjectTabHost?.subscribeDragHover((message) => {
				if (!message.active || !message.preview) {
					setIsProjectDropTarget(false);
					setDropPreview(null);
					dropPreviewIndexRef.current = null;
					dropTargetTabCentersRef.current = null;
					return;
				}
				setIsProjectDropTarget(true);
				if (!dropTargetTabCentersRef.current) {
					const tabs = projectTabBarRef.current
						? Array.from(
								projectTabBarRef.current.querySelectorAll<HTMLElement>(
									'.project-tab:not(.project-tab--drop-placeholder)',
								),
							)
						: [];
					dropTargetTabCentersRef.current = tabs.map((tab) => {
						const rect = tab.getBoundingClientRect();
						return rect.left + rect.width / 2;
					});
				}
				const index = computeDropIndex(
					dropTargetTabCentersRef.current ?? [],
					message.clientX ?? 0,
				);
				dropPreviewIndexRef.current = index;
				setDropPreview({ index, preview: message.preview });
			}),
		[],
	);

	useEffect(
		() =>
			window.terminayProjectTabHost?.subscribeTornOff((message) =>
				setIsDraggingTabTornOff(message.active),
			),
		[],
	);

	useEffect(() => {
		const element = projectTabBarRef.current;
		if (!element) return;
		const publishRect = () => {
			const rect = element.getBoundingClientRect();
			void window.terminayProjectTabHost?.publishBarRect({
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
			});
		};
		publishRect();
		const observer = new ResizeObserver(publishRect);
		observer.observe(element);
		window.addEventListener('resize', publishRect);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', publishRect);
			void window.terminayProjectTabHost?.publishBarRect(null);
		};
	}, []);

	return {
		draggingProjectId,
		dropPreview,
		handleProjectTabDragEnd,
		handleProjectTabDragStart,
		isDraggingTabTornOff,
		isProjectDropTarget,
		projectTabBarRef,
	};
}
