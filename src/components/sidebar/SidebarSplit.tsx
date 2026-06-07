import {
	type CSSProperties,
	type JSX,
	type ReactNode,
	useEffect,
	useRef,
} from 'react';
import './sidebar.css';

export type SidebarSplitProps = {
	top: ReactNode;
	bottom: ReactNode;
	topCollapsed: boolean;
	bottomCollapsed: boolean;
	topHeight: number;
	minPaneHeight?: number;
	onTopHeightChange: (height: number) => void;
	/** Called once when a resize drag ends, with the final height. */
	onTopHeightCommit?: (height: number) => void;
};

const SPLITTER_HEIGHT = 4;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function SidebarSplit(props: SidebarSplitProps): JSX.Element {
	const {
		top,
		bottom,
		topCollapsed,
		bottomCollapsed,
		topHeight,
		minPaneHeight = 80,
		onTopHeightChange,
		onTopHeightCommit,
	} = props;

	const rootRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef<{
		pointerId: number;
		startHeight: number;
		startY: number;
		latestHeight: number;
	} | null>(null);

	const bothExpanded = !topCollapsed && !bottomCollapsed;

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const state = dragStateRef.current;
			if (!state || event.pointerId !== state.pointerId) {
				return;
			}

			const rootElement = rootRef.current;
			const containerHeight = rootElement
				? rootElement.getBoundingClientRect().height - SPLITTER_HEIGHT
				: state.startHeight;

			const nextHeight = clamp(
				state.startHeight + (event.clientY - state.startY),
				minPaneHeight,
				Math.max(minPaneHeight, containerHeight - minPaneHeight),
			);
			state.latestHeight = nextHeight;
			onTopHeightChange(nextHeight);
		};

		const handlePointerUp = (event: PointerEvent) => {
			const state = dragStateRef.current;
			if (!state || event.pointerId !== state.pointerId) {
				return;
			}
			dragStateRef.current = null;
			onTopHeightCommit?.(state.latestHeight);
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', handlePointerUp);
		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('pointercancel', handlePointerUp);
		};
	}, [minPaneHeight, onTopHeightChange, onTopHeightCommit]);

	const topStyle: CSSProperties = bothExpanded
		? { flex: '0 0 auto', height: `${topHeight}px` }
		: topCollapsed
			? { flex: '0 0 auto' }
			: { flex: '1 1 auto', minHeight: 0 };

	const bottomStyle: CSSProperties = bottomCollapsed
		? { flex: '0 0 auto' }
		: { flex: '1 1 auto', minHeight: 0 };

	return (
		<div className="sidebar-split" ref={rootRef}>
			<div
				className="sidebar-split__pane sidebar-split__pane--top"
				style={topStyle}
			>
				{top}
			</div>
			{bothExpanded ? (
				// biome-ignore lint/a11y/useSemanticElements: a draggable resize handle needs a div with role="separator", not an <hr>.
				<div
					className="sidebar-split__splitter"
					role="separator"
					aria-orientation="horizontal"
					aria-valuenow={Math.round(topHeight)}
					tabIndex={0}
					onPointerDown={(event) => {
						dragStateRef.current = {
							pointerId: event.pointerId,
							startHeight: topHeight,
							startY: event.clientY,
							latestHeight: topHeight,
						};
						event.currentTarget.setPointerCapture(event.pointerId);
					}}
				/>
			) : null}
			<div
				className="sidebar-split__pane sidebar-split__pane--bottom"
				style={bottomStyle}
			>
				{bottom}
			</div>
		</div>
	);
}
