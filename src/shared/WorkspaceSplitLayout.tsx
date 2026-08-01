import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react';
import './WorkspaceSplitLayout.css';

const minimumNavigationWidth = 192;
const defaultNavigationWidth = 352;
const maximumNavigationWidthRatio = 0.8;
const navigationResizeStep = 16;

function getInitialRootWidth(): number | null {
	return typeof window === 'undefined' ? null : window.innerWidth;
}

export interface WorkspaceSplitLayoutProps {
	/** Host-owned navigational controls, such as a sidebar or workspace selector. */
	readonly navigation: ReactNode;
	/** Host-owned active workspace content, such as Dockview or a selected panel. */
	readonly content: ReactNode;
	/** Keep the content mounted while a host temporarily hides its navigation. */
	readonly isNavigationVisible?: boolean;
	readonly className?: string;
	/** Controlled production width. Supplying this keeps the grid track and the
	 * rendered sidebar on one authority instead of leaving an empty grid gutter. */
	readonly navigationWidth?: number;
	readonly maximumNavigationWidth?: number;
	readonly onNavigationWidthChange?: (width: number) => void;
	readonly onNavigationWidthCommit?: (width: number) => void;
}

/**
 * Host-neutral workspace geometry. Hosts keep all feature, transport, and
 * terminal ownership in their slots; this component provides only the shared
 * semantic regions and responsive layout contract.
 */
export function WorkspaceSplitLayout({
	navigation,
	content,
	className,
	isNavigationVisible = true,
	navigationWidth: controlledNavigationWidth,
	maximumNavigationWidth: controlledMaximumNavigationWidth,
	onNavigationWidthChange,
	onNavigationWidthCommit,
}: WorkspaceSplitLayoutProps) {
	const navigationId = useId();
	const [uncontrolledNavigationWidth, setUncontrolledNavigationWidth] =
		useState(defaultNavigationWidth);
	const [rootWidth, setRootWidth] = useState<number | null>(
		getInitialRootWidth,
	);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const dragStateRef = useRef<{
		pointerId: number;
		separator: HTMLElement;
		root: HTMLElement;
		startWidth: number;
		startX: number;
		latestWidth: number;
		removeListeners: () => void;
	} | null>(null);
	const navigationWidth =
		controlledNavigationWidth ?? uncontrolledNavigationWidth;
	const responsiveMaximumNavigationWidth = Math.max(
		minimumNavigationWidth,
		Math.floor(
			(rootWidth ?? defaultNavigationWidth) * maximumNavigationWidthRatio,
		),
	);
	const resolvedMaximumNavigationWidth =
		controlledMaximumNavigationWidth ?? responsiveMaximumNavigationWidth;
	const clampNavigationWidth = (width: number) =>
		Math.min(
			resolvedMaximumNavigationWidth,
			Math.max(minimumNavigationWidth, width),
		);
	const resolvedNavigationWidth = clampNavigationWidth(navigationWidth);

	function applyNavigationWidth(width: number) {
		rootRef.current?.style.setProperty(
			'--workspace-navigation-width',
			`${clampNavigationWidth(width)}px`,
		);
	}

	function resizeNavigation(width: number) {
		const nextWidth = clampNavigationWidth(width);
		if (controlledNavigationWidth === undefined)
			setUncontrolledNavigationWidth(nextWidth);
		onNavigationWidthChange?.(nextWidth);
		return nextWidth;
	}

	function handleSeparatorKeyDown(event: KeyboardEvent<HTMLHRElement>) {
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				onNavigationWidthCommit?.(
					resizeNavigation(resolvedNavigationWidth - navigationResizeStep),
				);
				break;
			case 'ArrowRight':
				event.preventDefault();
				onNavigationWidthCommit?.(
					resizeNavigation(resolvedNavigationWidth + navigationResizeStep),
				);
				break;
			case 'Home':
				event.preventDefault();
				onNavigationWidthCommit?.(resizeNavigation(minimumNavigationWidth));
				break;
			case 'End':
				event.preventDefault();
				onNavigationWidthCommit?.(
					resizeNavigation(resolvedMaximumNavigationWidth),
				);
				break;
		}
	}

	function stopNavigationResize() {
		const state = dragStateRef.current;
		if (state === null) return;
		dragStateRef.current = null;
		state.removeListeners();
		if (state.separator.hasPointerCapture(state.pointerId)) {
			state.separator.releasePointerCapture(state.pointerId);
		}
		const finalWidth = resizeNavigation(state.latestWidth);
		applyNavigationWidth(finalWidth);
		onNavigationWidthCommit?.(finalWidth);
	}

	function previewNavigationResize(pointerId: number, clientX: number) {
		const state = dragStateRef.current;
		if (state === null || pointerId !== state.pointerId) return;
		state.latestWidth = clampNavigationWidth(
			state.startWidth + clientX - state.startX,
		);
		state.root.style.setProperty(
			'--workspace-navigation-width',
			`${state.latestWidth}px`,
		);
	}

	function completeNavigationResize(pointerId: number) {
		const state = dragStateRef.current;
		if (state === null || pointerId !== state.pointerId) return;
		stopNavigationResize();
	}

	function handleSeparatorPointerDown(event: ReactPointerEvent<HTMLHRElement>) {
		if (event.button !== 0) return;
		const root = rootRef.current;
		if (root === null) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const ownerWindow = event.currentTarget.ownerDocument.defaultView;
		const handleWindowPointerMove = (windowEvent: PointerEvent) => {
			windowEvent.preventDefault();
			previewNavigationResize(windowEvent.pointerId, windowEvent.clientX);
		};
		const handleWindowPointerEnd = (windowEvent: PointerEvent) => {
			windowEvent.preventDefault();
			completeNavigationResize(windowEvent.pointerId);
		};
		const removeListeners = () => {
			ownerWindow?.removeEventListener('pointermove', handleWindowPointerMove);
			ownerWindow?.removeEventListener('pointerup', handleWindowPointerEnd);
			ownerWindow?.removeEventListener('pointercancel', handleWindowPointerEnd);
		};
		dragStateRef.current = {
			pointerId: event.pointerId,
			separator: event.currentTarget,
			root,
			startWidth: resolvedNavigationWidth,
			startX: event.clientX,
			latestWidth: resolvedNavigationWidth,
			removeListeners,
		};
		ownerWindow?.addEventListener('pointermove', handleWindowPointerMove);
		ownerWindow?.addEventListener('pointerup', handleWindowPointerEnd);
		ownerWindow?.addEventListener('pointercancel', handleWindowPointerEnd);
		applyNavigationWidth(resolvedNavigationWidth);
	}

	function handleSeparatorPointerMove(event: ReactPointerEvent<HTMLHRElement>) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		previewNavigationResize(event.pointerId, event.clientX);
	}

	function handleSeparatorPointerEnd(event: ReactPointerEvent<HTMLHRElement>) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		completeNavigationResize(event.pointerId);
	}

	useEffect(() => {
		const root = rootRef.current;
		if (root === null) return;
		const ownerWindow = root.ownerDocument.defaultView;
		const updateRootWidth = () => {
			setRootWidth(root.clientWidth);
		};
		updateRootWidth();
		if (typeof ResizeObserver === 'undefined') {
			ownerWindow?.addEventListener('resize', updateRootWidth);
			return () => {
				ownerWindow?.removeEventListener('resize', updateRootWidth);
			};
		}
		const observer = new ResizeObserver(updateRootWidth);
		observer.observe(root);
		ownerWindow?.addEventListener('resize', updateRootWidth);
		return () => {
			observer.disconnect();
			ownerWindow?.removeEventListener('resize', updateRootWidth);
		};
	}, []);

	useEffect(() => {
		return () => {
			const state = dragStateRef.current;
			if (state === null) return;
			state.removeListeners();
			dragStateRef.current = null;
		};
	}, []);

	return (
		<div
			ref={rootRef}
			className={['workspace-split-layout', className]
				.filter((value): value is string => Boolean(value))
				.join(' ')}
			data-shared-ui="workspace-split-layout"
			data-navigation-visible={isNavigationVisible ? 'true' : 'false'}
			style={
				{
					'--workspace-navigation-width': `${resolvedNavigationWidth}px`,
				} as CSSProperties
			}
		>
			<aside
				id={navigationId}
				className="workspace-split-layout__navigation"
				aria-label="Workspace navigation"
				data-shared-ui="workspace-navigation"
			>
				{navigation}
			</aside>
			<hr
				className="workspace-split-layout__separator"
				tabIndex={0}
				aria-label="Resize workspace navigation"
				aria-controls={navigationId}
				aria-orientation="vertical"
				aria-valuemin={minimumNavigationWidth}
				aria-valuemax={resolvedMaximumNavigationWidth}
				aria-valuenow={resolvedNavigationWidth}
				aria-valuetext={`${resolvedNavigationWidth} pixels`}
				onKeyDown={handleSeparatorKeyDown}
				onPointerDown={handleSeparatorPointerDown}
				onPointerMove={handleSeparatorPointerMove}
				onPointerUp={handleSeparatorPointerEnd}
				onPointerCancel={handleSeparatorPointerEnd}
			/>
			<section
				className="workspace-split-layout__content"
				aria-label="Workspace content"
				data-shared-ui="workspace-content"
			>
				{content}
			</section>
		</div>
	);
}
