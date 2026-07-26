import {
	type JSX,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { SidebarPane, type SidebarPaneProps } from './SidebarPane';
import {
	SIDEBAR_HEADER_MIN_HEIGHT,
	SidebarSplit,
} from './SidebarSplit';
import './sidebar.css';

export type SidebarPanelStackItem = Omit<SidebarPaneProps, 'reorder'> & {
	height: number;
	id: string;
};

export type SidebarPanelStackProps = {
	items: readonly SidebarPanelStackItem[];
	minPaneHeight?: number;
	onHeightChange: (id: string, height: number) => void;
	onHeightCommit?: (id: string, height: number) => void;
	onReorder: (orderedIds: string[]) => void;
};

export function reorderSidebarPanelIds(
	orderedIds: readonly string[],
	sourceId: string,
	targetId: string,
	position: 'before' | 'after',
): string[] {
	if (sourceId === targetId || !orderedIds.includes(sourceId)) {
		return [...orderedIds];
	}
	const withoutSource = orderedIds.filter((id) => id !== sourceId);
	const targetIndex = withoutSource.indexOf(targetId);
	if (targetIndex < 0) {
		return [...orderedIds];
	}
	const insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
	withoutSource.splice(insertionIndex, 0, sourceId);
	return withoutSource;
}

export function SidebarPanelStack({
	items,
	minPaneHeight = 80,
	onHeightChange,
	onHeightCommit,
	onReorder,
}: SidebarPanelStackProps): JSX.Element {
	const [draggedId, setDraggedId] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const itemsRef = useRef(items);
	const onReorderRef = useRef(onReorder);
	itemsRef.current = items;
	onReorderRef.current = onReorder;
	const dragStateRef = useRef<{
		active: boolean;
		pointerId: number;
		sourceId: string;
		startY: number;
		targetId?: string;
		targetPosition?: 'before' | 'after';
	} | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		position: 'before' | 'after';
	} | null>(null);

	const resetDrag = useCallback(() => {
		dragStateRef.current = null;
		document.body.classList.remove('sidebar-panel-reordering');
		setDraggedId(null);
		setDropTarget(null);
	}, []);

	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			const drag = dragStateRef.current;
			if (!drag || event.pointerId !== drag.pointerId) {
				return;
			}
			if (!drag.active) {
				if (Math.abs(event.clientY - drag.startY) < 4) {
					return;
				}
				drag.active = true;
				document.body.classList.add('sidebar-panel-reordering');
				setDraggedId(drag.sourceId);
			}
			event.preventDefault();

			const headers = Array.from(
				rootRef.current?.querySelectorAll<HTMLElement>(
					'[data-sidebar-panel-drop-id]',
				) ?? [],
			);
			let nearest:
				| {
						element: HTMLElement;
						distance: number;
				  }
				| undefined;
			for (const element of headers) {
				const rect = element.getBoundingClientRect();
				const distance =
					event.clientY < rect.top
						? rect.top - event.clientY
						: event.clientY > rect.bottom
							? event.clientY - rect.bottom
							: 0;
				if (!nearest || distance < nearest.distance) {
					nearest = { element, distance };
				}
			}
			const targetId = nearest?.element.dataset.sidebarPanelDropId;
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
			const drag = dragStateRef.current;
			if (!drag || event.pointerId !== drag.pointerId) {
				return;
			}
			if (drag.active && drag.targetId && drag.targetPosition) {
				onReorderRef.current(
					reorderSidebarPanelIds(
						itemsRef.current.map((item) => item.id),
						drag.sourceId,
						drag.targetId,
						drag.targetPosition,
					),
				);
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
			document.body.classList.remove('sidebar-panel-reordering');
		};
	}, [resetDrag]);

	const movePanel = useCallback(
		(id: string, direction: -1 | 1) => {
			const orderedIds = items.map((item) => item.id);
			const currentIndex = orderedIds.indexOf(id);
			const targetIndex = currentIndex + direction;
			if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
				return;
			}
			onReorder(
				reorderSidebarPanelIds(
					orderedIds,
					id,
					orderedIds[targetIndex],
					direction < 0 ? 'before' : 'after',
				),
			);
		},
		[items, onReorder],
	);

	const renderPane = useCallback(
		(item: SidebarPanelStackItem): ReactNode => (
			<SidebarPane
				{...item}
				reorder={{
					dragging: draggedId === item.id,
					dropPosition:
						dropTarget?.id === item.id ? dropTarget.position : null,
					panelId: item.id,
					onPointerDown: (
						event: ReactPointerEvent<HTMLButtonElement>,
					) => {
						if (event.button !== 0) {
							return;
						}
						event.preventDefault();
						dragStateRef.current = {
							active: false,
							pointerId: event.pointerId,
							sourceId: item.id,
							startY: event.clientY,
						};
						setDropTarget(null);
					},
					onMove: (direction) => movePanel(item.id, direction),
				}}
			/>
		),
		[draggedId, dropTarget, items, movePanel, onReorder, resetDrag],
	);

	const renderStack = useCallback(
		(remainingItems: readonly SidebarPanelStackItem[]): ReactNode => {
			const [top, ...bottom] = remainingItems;
			if (!top) {
				return null;
			}
			if (bottom.length === 0) {
				return renderPane(top);
			}
			return (
				<SidebarSplit
					key={`${top.id}:${bottom.map((item) => item.id).join(':')}`}
					top={renderPane(top)}
					bottom={renderStack(bottom)}
					topCollapsed={top.collapsed}
					bottomCollapsed={bottom.every((item) => item.collapsed)}
					topHeight={top.height}
					minPaneHeight={minPaneHeight}
					bottomMinHeight={SIDEBAR_HEADER_MIN_HEIGHT * bottom.length}
					onTopHeightChange={(height) => onHeightChange(top.id, height)}
					onTopHeightCommit={
						onHeightCommit
							? (height) => onHeightCommit(top.id, height)
							: undefined
					}
				/>
			);
		},
		[
			minPaneHeight,
			onHeightChange,
			onHeightCommit,
			renderPane,
		],
	);

	return (
		<div className="sidebar-panel-stack" ref={rootRef}>
			{renderStack(items)}
		</div>
	);
}
