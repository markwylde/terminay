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
	/**
	 * Minimum height the bottom pane keeps when both panes are expanded so its
	 * header(s) stay visible even if the top pane wants more room than fits.
	 * Defaults to a single header. Pass a larger value when the bottom is itself
	 * a nested split that needs room for more than one header.
	 */
	bottomMinHeight?: number;
	onTopHeightChange: (height: number) => void;
	/** Called once when a resize drag ends, with the final height. */
	onTopHeightCommit?: (height: number) => void;
};

const SPLITTER_HEIGHT = 4;

/**
 * Approximate height of a single collapsed pane header row. Used as the hard
 * floor so a pane can never shrink so far that its own header is clipped, and so
 * an expanded sibling can never push another section's header off the page.
 */
export const SIDEBAR_HEADER_MIN_HEIGHT = 30;

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
		bottomMinHeight = SIDEBAR_HEADER_MIN_HEIGHT,
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
		? // Allow the fixed-height top pane to shrink (flex-shrink: 1) when the
			// container is too short, so it can never crush the bottom section's
			// headers off the page. Its own header stays visible via minHeight.
			{
				flex: '0 1 auto',
				height: `${topHeight}px`,
				minHeight: `${SIDEBAR_HEADER_MIN_HEIGHT}px`,
			}
		: topCollapsed
			? { flex: '0 0 auto' }
			: { flex: '1 1 auto', minHeight: 0 };

	const bottomStyle: CSSProperties = bottomCollapsed
		? { flex: '0 0 auto' }
		: { flex: '1 1 auto', minHeight: `${bottomMinHeight}px` };

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
