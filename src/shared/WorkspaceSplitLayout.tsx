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
const maximumPersistedNavigationWidth = 2_000;
const navigationResizeStep = 16;

/** Must match `@media (max-width: 720px)` in WorkspaceSplitLayout.css. */
export const NARROW_LAYOUT_MEDIA_QUERY = '(max-width: 720px)';

const drawerFocusableSelector =
	'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function getInitialRootWidth(): number | null {
	return typeof window === 'undefined' ? null : window.innerWidth;
}

function getInitialNarrowLayout(): boolean {
	return typeof window === 'undefined'
		? false
		: window.matchMedia(NARROW_LAYOUT_MEDIA_QUERY).matches;
}

function getVisibleFocusableElements(root: HTMLElement): HTMLElement[] {
	return [
		...root.querySelectorAll<HTMLElement>(drawerFocusableSelector),
	].filter((element) => element.offsetParent !== null);
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
	/** Called once for a completed width change; never for a pointer preview. */
	readonly onNavigationWidthChange?: (width: number) => void;
	/** Preferred committed callback for canonical width persistence. */
	readonly onNavigationWidthCommit?: (width: number) => void;
	/** Called when a narrow-layout drawer is dismissed via Escape or the scrim. */
	readonly onNavigationDismiss?: () => void;
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
	onNavigationDismiss,
}: WorkspaceSplitLayoutProps) {
	const navigationId = useId();
	const [uncontrolledNavigationWidth, setUncontrolledNavigationWidth] =
		useState(defaultNavigationWidth);
	// A local width is the presentation authority while a resize is active and
	// until a completed controlled update has reached this component. React may
	// render for an unrelated workspace snapshot during that interval; rendering
	// the canonical prop in that pass would visibly fight the pointer.
	const [localNavigationWidth, setLocalNavigationWidth] = useState<
		number | null
	>(null);
	const [rootWidth, setRootWidth] = useState<number | null>(
		getInitialRootWidth,
	);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const [isNarrowLayout, setIsNarrowLayout] = useState(getInitialNarrowLayout);
	const navigationRef = useRef<HTMLElement | null>(null);
	const restoreFocusRef = useRef<HTMLElement | null>(null);
	const onNavigationDismissRef = useRef(onNavigationDismiss);
	onNavigationDismissRef.current = onNavigationDismiss;
	const isDrawerOpen = isNarrowLayout && isNavigationVisible;
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
	const resolvedMaximumNavigationWidth = Math.max(
		minimumNavigationWidth,
		Math.min(
			maximumPersistedNavigationWidth,
			controlledMaximumNavigationWidth ?? responsiveMaximumNavigationWidth,
		),
	);
	const clampNavigationWidth = (width: number) =>
		Math.min(
			resolvedMaximumNavigationWidth,
			Math.max(minimumNavigationWidth, width),
		);
	const resolvedNavigationWidth = clampNavigationWidth(navigationWidth);
	const canonicalNavigationWidthRef = useRef(resolvedNavigationWidth);
	const clampNavigationWidthRef = useRef(clampNavigationWidth);
	canonicalNavigationWidthRef.current = resolvedNavigationWidth;
	clampNavigationWidthRef.current = clampNavigationWidth;
	const activePreviewNavigationWidth = dragStateRef.current?.latestWidth;
	const renderedNavigationWidth =
		activePreviewNavigationWidth ??
		localNavigationWidth ??
		resolvedNavigationWidth;

	function applyNavigationWidth(width: number) {
		rootRef.current?.style.setProperty(
			'--workspace-navigation-width',
			`${clampNavigationWidthRef.current(width)}px`,
		);
	}

	function resizeNavigation(width: number) {
		const nextWidth = clampNavigationWidth(width);
		if (controlledNavigationWidth === undefined)
			setUncontrolledNavigationWidth(nextWidth);
		return nextWidth;
	}

	function commitNavigationWidth(width: number) {
		const nextWidth = resizeNavigation(width);
		setLocalNavigationWidth(nextWidth);
		applyNavigationWidth(nextWidth);
		// `onNavigationWidthChange` is retained as the legacy committed-value
		// callback. Live pointer movement intentionally updates only the inline
		// presentation variable; canonical owners receive one value here.
		onNavigationWidthChange?.(nextWidth);
		onNavigationWidthCommit?.(nextWidth);
	}

	function handleSeparatorKeyDown(event: KeyboardEvent<HTMLHRElement>) {
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				commitNavigationWidth(renderedNavigationWidth - navigationResizeStep);
				break;
			case 'ArrowRight':
				event.preventDefault();
				commitNavigationWidth(renderedNavigationWidth + navigationResizeStep);
				break;
			case 'Home':
				event.preventDefault();
				commitNavigationWidth(minimumNavigationWidth);
				break;
			case 'End':
				event.preventDefault();
				commitNavigationWidth(resolvedMaximumNavigationWidth);
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
		commitNavigationWidth(state.latestWidth);
	}

	function cancelNavigationResize() {
		const state = dragStateRef.current;
		if (state === null) return;
		dragStateRef.current = null;
		state.removeListeners();
		if (state.separator.hasPointerCapture(state.pointerId)) {
			state.separator.releasePointerCapture(state.pointerId);
		}
		// Pointer cancellation abandons the transient CSS preview and restores the
		// latest canonical width without producing a workspace mutation. The
		// canonical prop might have changed while the pointer was held.
		setLocalNavigationWidth(null);
		applyNavigationWidth(canonicalNavigationWidthRef.current);
	}

	function previewNavigationResize(pointerId: number, clientX: number) {
		const state = dragStateRef.current;
		if (state === null || pointerId !== state.pointerId) return;
		state.latestWidth = clampNavigationWidthRef.current(
			state.startWidth + clientX - state.startX,
		);
		setLocalNavigationWidth(state.latestWidth);
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
			if (windowEvent.type === 'pointercancel') {
				if (dragStateRef.current?.pointerId === windowEvent.pointerId) {
					cancelNavigationResize();
				}
			} else {
				completeNavigationResize(windowEvent.pointerId);
			}
		};
		const handleWindowBlur = () => cancelNavigationResize();
		const removeListeners = () => {
			ownerWindow?.removeEventListener('pointermove', handleWindowPointerMove);
			ownerWindow?.removeEventListener('pointerup', handleWindowPointerEnd);
			ownerWindow?.removeEventListener('pointercancel', handleWindowPointerEnd);
			ownerWindow?.removeEventListener('blur', handleWindowBlur);
		};
		dragStateRef.current = {
			pointerId: event.pointerId,
			separator: event.currentTarget,
			root,
			startWidth: renderedNavigationWidth,
			startX: event.clientX,
			latestWidth: renderedNavigationWidth,
			removeListeners,
		};
		ownerWindow?.addEventListener('pointermove', handleWindowPointerMove);
		ownerWindow?.addEventListener('pointerup', handleWindowPointerEnd);
		ownerWindow?.addEventListener('pointercancel', handleWindowPointerEnd);
		ownerWindow?.addEventListener('blur', handleWindowBlur);
		setLocalNavigationWidth(renderedNavigationWidth);
		applyNavigationWidth(renderedNavigationWidth);
	}

	function handleSeparatorPointerEnd(event: ReactPointerEvent<HTMLHRElement>) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		completeNavigationResize(event.pointerId);
	}

	function handleSeparatorPointerCancel(
		event: ReactPointerEvent<HTMLHRElement>,
	) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		cancelNavigationResize();
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
		if (typeof window === 'undefined') return;
		const media = window.matchMedia(NARROW_LAYOUT_MEDIA_QUERY);
		const update = () => {
			setIsNarrowLayout(media.matches);
		};
		update();
		media.addEventListener('change', update);
		return () => {
			media.removeEventListener('change', update);
		};
	}, []);

	useEffect(() => {
		if (!isDrawerOpen) return;
		const navigationElement = navigationRef.current;
		const ownerDocument = navigationElement?.ownerDocument;
		if (navigationElement == null || ownerDocument === undefined) return;
		const previouslyFocused = ownerDocument.activeElement;
		restoreFocusRef.current =
			previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
		const ownerWindow = ownerDocument.defaultView;
		const focusFrame = ownerWindow?.requestAnimationFrame(() => {
			const focusable = getVisibleFocusableElements(navigationElement);
			(focusable[0] ?? navigationElement).focus();
		});
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onNavigationDismissRef.current?.();
				return;
			}
			if (event.key !== 'Tab') return;
			const focusable = getVisibleFocusableElements(navigationElement);
			if (focusable.length === 0) {
				event.preventDefault();
				navigationElement.focus();
				return;
			}
			const first = focusable[0]!;
			const last = focusable[focusable.length - 1]!;
			if (event.shiftKey && ownerDocument.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && ownerDocument.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		ownerWindow?.addEventListener('keydown', onKeyDown);
		return () => {
			if (focusFrame !== undefined) {
				ownerWindow?.cancelAnimationFrame(focusFrame);
			}
			ownerWindow?.removeEventListener('keydown', onKeyDown);
			const target = restoreFocusRef.current;
			restoreFocusRef.current = null;
			ownerWindow?.requestAnimationFrame(() => {
				if (
					target?.isConnected === true &&
					target.offsetParent !== null &&
					target.closest('[aria-hidden="true"], [inert]') === null
				) {
					target.focus();
				}
			});
		};
	}, [isDrawerOpen]);

	useEffect(() => {
		if (
			dragStateRef.current !== null ||
			localNavigationWidth === null ||
			Math.abs(localNavigationWidth - resolvedNavigationWidth) > 0.5
		) {
			return;
		}
		// The controlled/uncontrolled authority has caught up with a completed
		// interaction, so future canonical updates can render normally.
		setLocalNavigationWidth(null);
	}, [localNavigationWidth, resolvedNavigationWidth]);

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
			data-narrow-layout={isNarrowLayout ? 'true' : 'false'}
			data-navigation-drawer={isDrawerOpen ? 'true' : 'false'}
			style={
				{
					'--workspace-navigation-width': `${renderedNavigationWidth}px`,
				} as CSSProperties
			}
		>
			<aside
				ref={navigationRef}
				id={navigationId}
				className="workspace-split-layout__navigation"
				aria-label="Workspace navigation"
				data-shared-ui="workspace-navigation"
				tabIndex={isDrawerOpen ? -1 : undefined}
			>
				{navigation}
			</aside>
			{isNavigationVisible ? (
				<button
					type="button"
					className="workspace-split-layout__scrim"
					aria-label="Dismiss workspace navigation"
					tabIndex={-1}
					onClick={() => onNavigationDismissRef.current?.()}
				/>
			) : null}
			<hr
				className="workspace-split-layout__separator"
				tabIndex={0}
				aria-label="Resize workspace navigation"
				aria-controls={navigationId}
				aria-orientation="vertical"
				aria-valuemin={minimumNavigationWidth}
				aria-valuemax={resolvedMaximumNavigationWidth}
				aria-valuenow={renderedNavigationWidth}
				aria-valuetext={`${renderedNavigationWidth} pixels`}
				onKeyDown={handleSeparatorKeyDown}
				onPointerDown={handleSeparatorPointerDown}
				onPointerUp={handleSeparatorPointerEnd}
				onPointerCancel={handleSeparatorPointerCancel}
				onLostPointerCapture={cancelNavigationResize}
			/>
			<section
				className="workspace-split-layout__content"
				aria-label="Workspace content"
				data-shared-ui="workspace-content"
				inert={isDrawerOpen ? true : undefined}
			>
				{content}
			</section>
		</div>
	);
}
