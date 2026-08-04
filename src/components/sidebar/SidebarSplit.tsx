import {
	type CSSProperties,
	type JSX,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { useResizeObserver } from '../../hooks/useResizeObserver';
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

export const SIDEBAR_SPLITTER_HEIGHT = 4;

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

	const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const topPaneRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef<{
		pointerId: number;
		startHeight: number;
		startY: number;
		latestHeight: number;
	} | null>(null);

	const bothExpanded = !topCollapsed && !bottomCollapsed;

	// Watch the container so the applied height re-clamps whenever the sidebar
	// (or window) resizes, keeping every header on screen at all times.
	const { height: containerHeight } = useResizeObserver(rootElement);
	const setRoot = useCallback((element: HTMLDivElement | null) => {
		rootRef.current = element;
		setRootElement(element);
	}, []);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const state = dragStateRef.current;
			if (!state || event.pointerId !== state.pointerId) {
				return;
			}

			const rootElement = rootRef.current;
			const containerHeight = rootElement
				? rootElement.getBoundingClientRect().height - SIDEBAR_SPLITTER_HEIGHT
				: state.startHeight;

			const nextHeight = clamp(
				state.startHeight + (event.clientY - state.startY),
				minPaneHeight,
				Math.max(
					minPaneHeight,
					containerHeight - Math.max(minPaneHeight, bottomMinHeight),
				),
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
	}, [bottomMinHeight, minPaneHeight, onTopHeightChange, onTopHeightCommit]);

	// The stored height is the user's preference; the applied height is clamped
	// against the live container size so the bottom section's header(s) can never
	// be pushed off the page — during drags, window resizes, or restored state.
	// The preference itself is left untouched, so growing the window back
	// restores the pane to the size the user chose.
	const effectiveTopHeight =
		containerHeight > 0
			? clamp(
					topHeight,
					SIDEBAR_HEADER_MIN_HEIGHT,
					Math.max(
						SIDEBAR_HEADER_MIN_HEIGHT,
						containerHeight - SIDEBAR_SPLITTER_HEIGHT - bottomMinHeight,
					),
				)
			: topHeight;

	const topStyle: CSSProperties = bothExpanded
		? // A hard fixed height (no flex shrink) so dragging the splitter maps
			// 1:1 to pixels; header visibility is guaranteed by the clamp above.
			{ flex: '0 0 auto', height: `${effectiveTopHeight}px` }
		: topCollapsed
			? { flex: '0 0 auto' }
			: { flex: '1 1 auto', minHeight: 0 };

	const bottomStyle: CSSProperties = bottomCollapsed
		? { flex: '0 0 auto' }
		: { flex: '1 1 auto', minHeight: `${bottomMinHeight}px` };

	return (
		<div className="sidebar-split" ref={setRoot}>
			<div
				className="sidebar-split__pane sidebar-split__pane--top"
				style={topStyle}
				ref={topPaneRef}
			>
				{top}
			</div>
			{bothExpanded ? (
				// biome-ignore lint/a11y/useSemanticElements: a draggable resize handle needs a div with role="separator", not an <hr>.
				<div
					className="sidebar-split__splitter"
					role="separator"
					aria-orientation="horizontal"
					aria-valuenow={Math.round(effectiveTopHeight)}
					tabIndex={0}
					onPointerDown={(event) => {
						// Start from the rendered height, not the stored preference —
						// they differ when the clamp is active, and starting from the
						// stored value would make the splitter jump away from the mouse.
						const renderedHeight =
							topPaneRef.current?.getBoundingClientRect().height ??
							effectiveTopHeight;
						dragStateRef.current = {
							pointerId: event.pointerId,
							startHeight: renderedHeight,
							startY: event.clientY,
							latestHeight: renderedHeight,
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
