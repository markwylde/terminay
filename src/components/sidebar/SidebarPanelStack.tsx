import {
	type DragEvent,
	type JSX,
	type ReactNode,
	useCallback,
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
	const draggedIdRef = useRef<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		position: 'before' | 'after';
	} | null>(null);

	const resetDrag = useCallback(() => {
		draggedIdRef.current = null;
		setDraggedId(null);
		setDropTarget(null);
	}, []);

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
					onDragStart: (event: DragEvent<HTMLButtonElement>) => {
						event.dataTransfer.effectAllowed = 'move';
						event.dataTransfer.setData('text/plain', item.id);
						draggedIdRef.current = item.id;
						setDraggedId(item.id);
						setDropTarget(null);
					},
					onDragOver: (position) => {
						const sourceId = draggedIdRef.current;
						if (sourceId && sourceId !== item.id) {
							setDropTarget({ id: item.id, position });
						}
					},
					onDrop: (position) => {
						const sourceId = draggedIdRef.current;
						if (sourceId) {
							onReorder(
								reorderSidebarPanelIds(
									items.map((candidate) => candidate.id),
									sourceId,
									item.id,
									position,
								),
							);
						}
						resetDrag();
					},
					onDragEnd: resetDrag,
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

	return <div className="sidebar-panel-stack">{renderStack(items)}</div>;
}
