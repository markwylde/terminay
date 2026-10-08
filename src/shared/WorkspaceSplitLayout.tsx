import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
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
const minimumFoldersWidth = 160;
const defaultFoldersWidth = 232;
/** The folders column is a list of names beside the panels, never the main
 * surface, so it may take at most half of the layout. */
const maximumFoldersWidthRatio = 0.5;

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

type TrackResizeOptions = {
	rootRef: RefObject<HTMLDivElement | null>;
	/** The custom property on the layout root that sizes this track. */
	cssVariable: string;
	/** 1 when the track sits on the leading side, so it grows as its separator
	 * moves toward the trailing edge; -1 for a track on the trailing side. */
	direction: 1 | -1;
	controlledWidth: number | undefined;
	defaultWidth: number;
	minimumWidth: number;
	maximumWidth: number;
	/** Called once for a completed width change; never for a pointer preview. */
	onCommit: (width: number) => void;
};

/**
 * One resizable track of the layout and the separator that sizes it.
 *
 * A pointer drag previews through the track's CSS variable only, and reaches
 * the owner once, when it completes. The navigation and the folders column are
 * two instances of this, so neither can drift from the other's gesture rules.
 */
function useTrackResize({
	rootRef,
	cssVariable,
	direction,
	controlledWidth,
	defaultWidth,
	minimumWidth,
	maximumWidth,
	onCommit,
}: TrackResizeOptions) {
	const [uncontrolledWidth, setUncontrolledWidth] = useState(defaultWidth);
	// A local width is the presentation authority while a resize is active and
	// until a completed controlled update has reached this component. React may
	// render for an unrelated workspace snapshot during that interval; rendering
	// the canonical prop in that pass would visibly fight the pointer.
	const [localWidth, setLocalWidth] = useState<number | null>(null);
	const dragStateRef = useRef<{
		pointerId: number;
		separator: HTMLElement;
		root: HTMLElement;
		startWidth: number;
		startX: number;
		latestWidth: number;
		removeListeners: () => void;
	} | null>(null);
	const clampWidth = (width: number) =>
		Math.min(maximumWidth, Math.max(minimumWidth, width));
	const resolvedWidth = clampWidth(controlledWidth ?? uncontrolledWidth);
	const canonicalWidthRef = useRef(resolvedWidth);
	const clampWidthRef = useRef(clampWidth);
	canonicalWidthRef.current = resolvedWidth;
	clampWidthRef.current = clampWidth;
	const renderedWidth =
		dragStateRef.current?.latestWidth ?? localWidth ?? resolvedWidth;

	function applyWidth(width: number) {
		rootRef.current?.style.setProperty(
			cssVariable,
			`${clampWidthRef.current(width)}px`,
		);
	}

	function commitWidth(width: number) {
		const nextWidth = clampWidth(width);
		if (controlledWidth === undefined) setUncontrolledWidth(nextWidth);
		setLocalWidth(nextWidth);
		applyWidth(nextWidth);
		// Live pointer movement intentionally updates only the inline
		// presentation variable; canonical owners receive one value here.
		onCommit(nextWidth);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLHRElement>) {
		switch (event.key) {
			// The arrow moves the separator, so which way grows the track
			// depends on the side the track is on.
			case 'ArrowLeft':
				event.preventDefault();
				commitWidth(renderedWidth - direction * navigationResizeStep);
				break;
			case 'ArrowRight':
				event.preventDefault();
				commitWidth(renderedWidth + direction * navigationResizeStep);
				break;
			case 'Home':
				event.preventDefault();
				commitWidth(minimumWidth);
				break;
			case 'End':
				event.preventDefault();
				commitWidth(maximumWidth);
				break;
		}
	}

	function stopResize() {
		const state = dragStateRef.current;
		if (state === null) return;
		dragStateRef.current = null;
		state.removeListeners();
		if (state.separator.hasPointerCapture(state.pointerId)) {
			state.separator.releasePointerCapture(state.pointerId);
		}
		commitWidth(state.latestWidth);
	}

	function cancelResize() {
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
		setLocalWidth(null);
		applyWidth(canonicalWidthRef.current);
	}

	function previewResize(pointerId: number, clientX: number) {
		const state = dragStateRef.current;
		if (state === null || pointerId !== state.pointerId) return;
		state.latestWidth = clampWidthRef.current(
			state.startWidth + direction * (clientX - state.startX),
		);
		setLocalWidth(state.latestWidth);
		state.root.style.setProperty(cssVariable, `${state.latestWidth}px`);
	}

	function completeResize(pointerId: number) {
		const state = dragStateRef.current;
		if (state === null || pointerId !== state.pointerId) return;
		stopResize();
	}

	function handlePointerDown(event: ReactPointerEvent<HTMLHRElement>) {
		if (event.button !== 0) return;
		const root = rootRef.current;
		if (root === null) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		const ownerWindow = event.currentTarget.ownerDocument.defaultView;
		const handleWindowPointerMove = (windowEvent: PointerEvent) => {
			windowEvent.preventDefault();
			previewResize(windowEvent.pointerId, windowEvent.clientX);
		};
		const handleWindowPointerEnd = (windowEvent: PointerEvent) => {
			windowEvent.preventDefault();
			if (windowEvent.type === 'pointercancel') {
				if (dragStateRef.current?.pointerId === windowEvent.pointerId) {
					cancelResize();
				}
			} else {
				completeResize(windowEvent.pointerId);
			}
		};
		const handleWindowBlur = () => cancelResize();
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
			startWidth: renderedWidth,
			startX: event.clientX,
			latestWidth: renderedWidth,
			removeListeners,
		};
		// Losing pointer capture does not end the gesture. The handle is 6px wide
		// and travels with the preview, so a quick pointer leaves it and Chromium
		// fires lostpointercapture while the button is still held; cancelling there
		// is the snap-back. The window listeners keep the drag, and pointer-up
		// still commits it.
		ownerWindow?.addEventListener('pointermove', handleWindowPointerMove);
		ownerWindow?.addEventListener('pointerup', handleWindowPointerEnd);
		ownerWindow?.addEventListener('pointercancel', handleWindowPointerEnd);
		ownerWindow?.addEventListener('blur', handleWindowBlur);
		setLocalWidth(renderedWidth);
		applyWidth(renderedWidth);
	}

	function handlePointerUp(event: ReactPointerEvent<HTMLHRElement>) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		completeResize(event.pointerId);
	}

	function handlePointerCancel(event: ReactPointerEvent<HTMLHRElement>) {
		if (dragStateRef.current?.pointerId !== event.pointerId) return;
		event.preventDefault();
		cancelResize();
	}

	useEffect(() => {
		if (
			dragStateRef.current !== null ||
			localWidth === null ||
			Math.abs(localWidth - resolvedWidth) > 0.5
		) {
			return;
		}
		// The controlled/uncontrolled authority has caught up with a completed
		// interaction, so future canonical updates can render normally.
		setLocalWidth(null);
	}, [localWidth, resolvedWidth]);

	useEffect(() => {
		return () => {
			const state = dragStateRef.current;
			if (state === null) return;
			state.removeListeners();
			dragStateRef.current = null;
		};
	}, []);

	return {
		renderedWidth,
		separatorProps: {
			tabIndex: 0,
			'aria-orientation': 'vertical' as const,
			'aria-valuemin': minimumWidth,
			'aria-valuemax': maximumWidth,
			'aria-valuenow': renderedWidth,
			'aria-valuetext': `${renderedWidth} pixels`,
			onKeyDown: handleKeyDown,
			onPointerDown: handlePointerDown,
			onPointerUp: handlePointerUp,
			onPointerCancel: handlePointerCancel,
		},
	};
}

export interface WorkspaceSplitLayoutProps {
	/** Host-owned navigational controls, such as a sidebar or workspace selector. */
	readonly navigation: ReactNode;
	/** Host-owned active workspace content, such as Dockview or a selected panel. */
	readonly content: ReactNode;
	/** Keep the content mounted while a host temporarily hides its navigation. */
	readonly isNavigationVisible?: boolean;
	/**
	 * Which side of the content the navigation sits on at or above the narrow
	 * breakpoint. A project's sidebar is trailing, with its folders leading;
	 * a host with one column of navigation keeps it leading. Below the
	 * breakpoint the navigation is the same drawer either way.
	 */
	readonly navigationSide?: 'leading' | 'trailing';
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
	/**
	 * A second, leading column beside the content, with its own separator on
	 * the edge that faces the content. It is laid out for a trailing
	 * navigation, and is not rendered below the narrow breakpoint, where a
	 * host reaches the same things another way.
	 */
	readonly folders?: ReactNode;
	readonly isFoldersVisible?: boolean;
	readonly foldersWidth?: number;
	/** Called once for a completed width change; never for a pointer preview. */
	readonly onFoldersWidthCommit?: (width: number) => void;
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
	navigationSide = 'leading',
	navigationWidth: controlledNavigationWidth,
	maximumNavigationWidth: controlledMaximumNavigationWidth,
	onNavigationWidthChange,
	onNavigationWidthCommit,
	onNavigationDismiss,
	folders,
	isFoldersVisible = true,
	foldersWidth: controlledFoldersWidth,
	onFoldersWidthCommit,
}: WorkspaceSplitLayoutProps) {
	const navigationId = useId();
	const foldersId = useId();
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
	const showsFolders =
		folders !== undefined &&
		folders !== null &&
		isFoldersVisible &&
		!isNarrowLayout;
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
	const navigationTrack = useTrackResize({
		rootRef,
		cssVariable: '--workspace-navigation-width',
		direction: navigationSide === 'trailing' ? -1 : 1,
		controlledWidth: controlledNavigationWidth,
		defaultWidth: defaultNavigationWidth,
		minimumWidth: minimumNavigationWidth,
		maximumWidth: resolvedMaximumNavigationWidth,
		onCommit: (width) => {
			// `onNavigationWidthChange` is retained as the legacy committed-value
			// callback.
			onNavigationWidthChange?.(width);
			onNavigationWidthCommit?.(width);
		},
	});
	const foldersTrack = useTrackResize({
		rootRef,
		cssVariable: '--workspace-folders-width',
		direction: 1,
		controlledWidth: controlledFoldersWidth,
		defaultWidth: defaultFoldersWidth,
		minimumWidth: minimumFoldersWidth,
		maximumWidth: Math.max(
			minimumFoldersWidth,
			Math.min(
				maximumPersistedNavigationWidth,
				Math.floor(
					(rootWidth ?? defaultFoldersWidth * 2) * maximumFoldersWidthRatio,
				),
			),
		),
		onCommit: (width) => onFoldersWidthCommit?.(width),
	});

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

	return (
		<div
			ref={rootRef}
			className={['workspace-split-layout', className]
				.filter((value): value is string => Boolean(value))
				.join(' ')}
			data-shared-ui="workspace-split-layout"
			data-navigation-visible={isNavigationVisible ? 'true' : 'false'}
			data-navigation-side={navigationSide}
			data-folders-visible={showsFolders ? 'true' : 'false'}
			data-narrow-layout={isNarrowLayout ? 'true' : 'false'}
			data-navigation-drawer={isDrawerOpen ? 'true' : 'false'}
			style={
				{
					'--workspace-navigation-width': `${navigationTrack.renderedWidth}px`,
					...(showsFolders
						? { '--workspace-folders-width': `${foldersTrack.renderedWidth}px` }
						: {}),
				} as CSSProperties
			}
		>
			{showsFolders ? (
				<>
					<aside
						id={foldersId}
						className="workspace-split-layout__folders"
						aria-label="Workspace folders"
						data-shared-ui="workspace-folders"
					>
						{folders}
					</aside>
					{/* Its own class, not the navigation separator's: a host that
					    looks for "the" separator means the sidebar's. */}
					<hr
						className="workspace-split-layout__folders-separator"
						aria-label="Resize workspace folders"
						aria-controls={foldersId}
						{...foldersTrack.separatorProps}
					/>
				</>
			) : null}
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
				aria-label="Resize workspace navigation"
				aria-controls={navigationId}
				{...navigationTrack.separatorProps}
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
