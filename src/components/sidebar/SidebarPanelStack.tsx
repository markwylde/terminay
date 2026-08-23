import {
	type CSSProperties,
	type JSX,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useResizeObserver } from '../../hooks/useResizeObserver';
import { SidebarPane, type SidebarPaneProps } from './SidebarPane';
import {
	normalizeSidebarPanelLayout,
	resizeSidebarPanelBoundary,
	type SidebarPanelLayout,
	type SidebarPanelSeparator,
	sidebarPanelCommitHeights,
} from './sidebarPanelLayout';
import './sidebar.css';

const DEFAULT_TITLE_HEIGHT = 30;
const KEYBOARD_RESIZE_STEP = 16;
const EPSILON = 0.01;

export type SidebarPanelStackItem = Omit<
	SidebarPaneProps,
	'headerRef' | 'paneDomId' | 'paneId' | 'reorder' | 'style'
> & {
	height: number;
	id: string;
};

export type SidebarPanelStackProps = {
	items: readonly SidebarPanelStackItem[];
	/** Called once only after a completed pointer or keyboard resize. */
	onHeightsCommit?: (
		heights: Readonly<Record<string, number>>,
	) => void | Promise<void>;
	onReorder: (orderedIds: string[]) => void;
};

type ResizeSession = {
	pointerId: number;
	separator: HTMLButtonElement;
	boundaryIndex: number;
	startY: number;
	startLayout: SidebarPanelLayout;
	latestLayout: SidebarPanelLayout;
	removeListeners: () => void;
};

type SettlingResize = {
	readonly heights: Readonly<Record<string, number>>;
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
	if (targetIndex < 0) return [...orderedIds];
	withoutSource.splice(
		targetIndex + (position === 'after' ? 1 : 0),
		0,
		sourceId,
	);
	return withoutSource;
}

function controlledHeightsMatch(
	items: readonly SidebarPanelStackItem[],
	heights: Readonly<Record<string, number>>,
): boolean {
	return Object.entries(heights).every(([id, height]) => {
		const item = items.find((candidate) => candidate.id === id);
		return item !== undefined && Math.abs(item.height - height) <= EPSILON;
	});
}

export function SidebarPanelStack({
	items,
	onHeightsCommit,
	onReorder,
}: SidebarPanelStackProps): JSX.Element {
	const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
	const [titleHeights, setTitleHeights] = useState<
		Readonly<Record<string, number>>
	>({});
	const [previewLayout, setPreviewLayout] = useState<SidebarPanelLayout | null>(
		null,
	);
	const [settlingResize, setSettlingResize] = useState<SettlingResize | null>(
		null,
	);
	const [draggedId, setDraggedId] = useState<string | null>(null);
	const [dropTarget, setDropTarget] = useState<{
		id: string;
		position: 'before' | 'after';
	} | null>(null);
	const stackId = useId();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const itemsRef = useRef(items);
	const onReorderRef = useRef(onReorder);
	const onHeightsCommitRef = useRef(onHeightsCommit);
	const titleObserversRef = useRef(new Map<string, ResizeObserver>());
	const titleRefCallbacksRef = useRef(
		new Map<string, (element: HTMLDivElement | null) => void>(),
	);
	const resizeSessionRef = useRef<ResizeSession | null>(null);
	const settlingResizeRef = useRef<SettlingResize | null>(null);
	const reorderSessionRef = useRef<{
		active: boolean;
		pointerId: number;
		sourceId: string;
		startY: number;
		targetId?: string;
		targetPosition?: 'before' | 'after';
	} | null>(null);

	itemsRef.current = items;
	onReorderRef.current = onReorder;
	onHeightsCommitRef.current = onHeightsCommit;
	const { height: containerHeight } = useResizeObserver(rootElement);
	const canonicalLayout = useMemo(
		() =>
			normalizeSidebarPanelLayout(
				items.map((item) => ({
					id: item.id,
					titleHeight: titleHeights[item.id] ?? DEFAULT_TITLE_HEIGHT,
					collapsed: item.collapsed,
					preferredHeight: item.height,
				})),
				containerHeight,
			),
		[containerHeight, items, titleHeights],
	);
	const renderedLayout = previewLayout ?? canonicalLayout;
	const renderedLayoutRef = useRef(renderedLayout);
	renderedLayoutRef.current = renderedLayout;

	const clearSettlingResize = useCallback(() => {
		settlingResizeRef.current = null;
		setSettlingResize(null);
		setPreviewLayout(null);
	}, []);

	useEffect(() => {
		const settling = settlingResizeRef.current;
		if (settling === null || !controlledHeightsMatch(items, settling.heights)) {
			return;
		}
		clearSettlingResize();
	}, [clearSettlingResize, items, settlingResize]);

	const setRoot = useCallback((element: HTMLDivElement | null) => {
		rootRef.current = element;
		setRootElement(element);
	}, []);

	const measureTitle = useCallback((id: string, element: HTMLDivElement) => {
		const nextHeight = element.getBoundingClientRect().height;
		if (!Number.isFinite(nextHeight) || nextHeight <= 0) return;
		setTitleHeights((current) => {
			const previousHeight = current[id];
			if (
				previousHeight !== undefined &&
				Math.abs(previousHeight - nextHeight) <= EPSILON
			) {
				return current;
			}
			return { ...current, [id]: nextHeight };
		});
	}, []);

	const getTitleRef = useCallback(
		(id: string) => {
			const existing = titleRefCallbacksRef.current.get(id);
			if (existing) return existing;
			const callback = (element: HTMLDivElement | null) => {
				const previousObserver = titleObserversRef.current.get(id);
				previousObserver?.disconnect();
				titleObserversRef.current.delete(id);
				if (element === null) return;
				measureTitle(id, element);
				if (typeof ResizeObserver === 'undefined') return;
				const observer = new ResizeObserver(() => measureTitle(id, element));
				observer.observe(element);
				titleObserversRef.current.set(id, observer);
			};
			titleRefCallbacksRef.current.set(id, callback);
			return callback;
		},
		[measureTitle],
	);

	const resetReorder = useCallback(() => {
		reorderSessionRef.current = null;
		document.body.classList.remove('sidebar-panel-reordering');
		setDraggedId(null);
		setDropTarget(null);
	}, []);

	const commitResizeLayout = useCallback(
		(startLayout: SidebarPanelLayout, latestLayout: SidebarPanelLayout) => {
			const heights = sidebarPanelCommitHeights(startLayout, latestLayout);
			if (Object.keys(heights).length === 0) {
				setPreviewLayout(null);
				return;
			}

			// Retain the exact rendered geometry until the parent has installed the
			// complete preference vector. Dropping the preview first would expose a
			// stale canonical layout between pointer-up and reconciliation.
			const settling: SettlingResize = { heights };
			settlingResizeRef.current = settling;
			setSettlingResize(settling);
			setPreviewLayout(latestLayout);

			let result: void | Promise<void>;
			try {
				result = onHeightsCommitRef.current?.(heights);
			} catch {
				clearSettlingResize();
				return;
			}
			if (result === undefined) {
				// A synchronous consumer may already have queued a matching update in
				// this turn. Keep the preview until items catch up so we do not flash
				// the pre-drag canonical layout. Uncontrolled callers without a
				// matching update retain the committed geometry, which is the
				// pointer's result.
				if (controlledHeightsMatch(itemsRef.current, settling.heights)) {
					clearSettlingResize();
				}
				return;
			}
			void Promise.resolve(result).then(
				() => {
					if (settlingResizeRef.current !== settling) return;
					// Successful authority work normally triggers the matching-items
					// effect. Do not drop the preview merely because the promise
					// resolved first: that is the snap-back the user sees when IPC is
					// still in flight.
					if (controlledHeightsMatch(itemsRef.current, settling.heights)) {
						clearSettlingResize();
					}
				},
				() => {
					if (settlingResizeRef.current === settling) {
						clearSettlingResize();
					}
				},
			);
		},
		[clearSettlingResize],
	);

	const finishResize = useCallback(
		(outcome: 'commit' | 'cancel') => {
			const session = resizeSessionRef.current;
			if (session === null) return;
			resizeSessionRef.current = null;
			session.removeListeners();
			document.body.classList.remove('sidebar-panel-resizing');
			if (session.separator.hasPointerCapture(session.pointerId)) {
				session.separator.releasePointerCapture(session.pointerId);
			}
			if (outcome === 'cancel') {
				setPreviewLayout(
					settlingResizeRef.current === null ? null : session.startLayout,
				);
				return;
			}
			commitResizeLayout(session.startLayout, session.latestLayout);
		},
		[commitResizeLayout],
	);

	const previewResize = useCallback((pointerId: number, clientY: number) => {
		const session = resizeSessionRef.current;
		if (session === null || session.pointerId !== pointerId) return;
		const result = resizeSidebarPanelBoundary(
			session.startLayout,
			session.boundaryIndex,
			clientY - session.startY,
		);
		session.latestLayout = result.layout;
		setPreviewLayout(result.layout);
	}, []);

	const beginResize = useCallback(
		(
			event: ReactPointerEvent<HTMLButtonElement>,
			separator: SidebarPanelSeparator,
		) => {
			if (
				event.button !== 0 ||
				!event.isPrimary ||
				separator.state === 'disabled'
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const ownerWindow = event.currentTarget.ownerDocument.defaultView;
			const ownerDocument = event.currentTarget.ownerDocument;
			const pointerId = event.pointerId;
			const cancel = () => finishResize('cancel');
			const onWindowPointerMove = (windowEvent: PointerEvent) => {
				if (windowEvent.pointerId !== pointerId) return;
				windowEvent.preventDefault();
				previewResize(pointerId, windowEvent.clientY);
			};
			const onWindowPointerUp = (windowEvent: PointerEvent) => {
				if (windowEvent.pointerId !== pointerId) return;
				windowEvent.preventDefault();
				previewResize(pointerId, windowEvent.clientY);
				finishResize('commit');
			};
			const onWindowPointerCancel = (windowEvent: PointerEvent) => {
				if (windowEvent.pointerId === pointerId) cancel();
			};
			const onVisibilityChange = () => {
				if (ownerDocument.visibilityState === 'hidden') cancel();
			};
			const removeListeners = () => {
				ownerWindow?.removeEventListener('pointermove', onWindowPointerMove);
				ownerWindow?.removeEventListener('pointerup', onWindowPointerUp);
				ownerWindow?.removeEventListener(
					'pointercancel',
					onWindowPointerCancel,
				);
				ownerWindow?.removeEventListener('blur', cancel);
				ownerDocument.removeEventListener(
					'visibilitychange',
					onVisibilityChange,
				);
			};
			resizeSessionRef.current = {
				pointerId,
				separator: event.currentTarget,
				boundaryIndex: separator.boundaryIndex,
				startY: event.clientY,
				startLayout: renderedLayoutRef.current,
				latestLayout: renderedLayoutRef.current,
				removeListeners,
			};
			event.currentTarget.focus({ preventScroll: true });
			event.currentTarget.setPointerCapture(pointerId);
			// Do not cancel on lostpointercapture. The handle moves with the
			// preview, so a fast drag often leaves it out from under the cursor.
			// Chromium then fires lostpointercapture before pointerup; treating
			// that as cancel is the snap-back. Window pointerup still commits.
			document.body.classList.add('sidebar-panel-resizing');
			ownerWindow?.addEventListener('pointermove', onWindowPointerMove, {
				passive: false,
			});
			ownerWindow?.addEventListener('pointerup', onWindowPointerUp, {
				passive: false,
			});
			ownerWindow?.addEventListener('pointercancel', onWindowPointerCancel);
			ownerWindow?.addEventListener('blur', cancel);
			ownerDocument.addEventListener('visibilitychange', onVisibilityChange);
		},
		[finishResize, previewResize],
	);

	const handleSeparatorKeyDown = useCallback(
		(
			event: KeyboardEvent<HTMLButtonElement>,
			separator: SidebarPanelSeparator,
		) => {
			let delta: number | null = null;
			switch (event.key) {
				case 'ArrowUp':
					delta = -KEYBOARD_RESIZE_STEP;
					break;
				case 'ArrowDown':
					delta = KEYBOARD_RESIZE_STEP;
					break;
				case 'Home':
					delta = separator.minimum - separator.offset;
					break;
				case 'End':
					delta = separator.maximum - separator.offset;
					break;
				default:
					return;
			}
			event.preventDefault();
			const startLayout = renderedLayoutRef.current;
			const result = resizeSidebarPanelBoundary(
				startLayout,
				separator.boundaryIndex,
				delta,
			);
			if (result.changedIds.length === 0) return;
			commitResizeLayout(startLayout, result.layout);
		},
		[commitResizeLayout],
	);

	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			const drag = reorderSessionRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (!drag.active) {
				if (Math.abs(event.clientY - drag.startY) < 4) return;
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
			let nearest: { element: HTMLElement; distance: number } | undefined;
			for (const element of headers) {
				const rect = element.getBoundingClientRect();
				const distance =
					event.clientY < rect.top
						? rect.top - event.clientY
						: event.clientY > rect.bottom
							? event.clientY - rect.bottom
							: 0;
				if (!nearest || distance < nearest.distance)
					nearest = { element, distance };
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
			const drag = reorderSessionRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;
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
			resetReorder();
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
	}, [resetReorder]);

	useEffect(() => {
		return () => {
			for (const observer of titleObserversRef.current.values())
				observer.disconnect();
			titleObserversRef.current.clear();
			finishResize('cancel');
		};
	}, [finishResize]);

	const movePanel = useCallback(
		(id: string, direction: -1 | 1) => {
			const orderedIds = items.map((item) => item.id);
			const currentIndex = orderedIds.indexOf(id);
			const targetIndex = currentIndex + direction;
			if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length)
				return;
			onReorder(
				reorderSidebarPanelIds(
					orderedIds,
					id,
					orderedIds[targetIndex]!,
					direction < 0 ? 'before' : 'after',
				),
			);
		},
		[items, onReorder],
	);

	return (
		<div
			className="sidebar-panel-stack"
			data-sidebar-panel-stack
			data-sidebar-layout-feasible={renderedLayout.feasible ? 'true' : 'false'}
			data-sidebar-required-title-height={Math.ceil(
				renderedLayout.requiredTitleHeight,
			)}
			ref={setRoot}
		>
			{!renderedLayout.feasible ? (
				<div
					className="sidebar-panel-stack__minimum-height-notice"
					data-sidebar-minimum-height-notice
					role="status"
				>
					Increase the window height. The sidebar needs at least{' '}
					{Math.ceil(renderedLayout.requiredTitleHeight)} pixels to show every
					panel.
				</div>
			) : (
				<>
					{renderedLayout.allocations.map((allocation) => {
						const item = items.find(
							(candidate) => candidate.id === allocation.id,
						);
						if (!item) return null;
						return (
							<SidebarPane
								{...item}
								className={['sidebar-panel-stack__pane', item.className]
									.filter(Boolean)
									.join(' ')}
								headerRef={getTitleRef(item.id)}
								key={item.id}
								paneDomId={`${stackId}-pane-${item.id}`}
								paneId={item.id}
								reorder={{
									dragging: draggedId === item.id,
									dropPosition:
										dropTarget?.id === item.id ? dropTarget.position : null,
									panelId: item.id,
									onPointerDown: (event) => {
										if (event.button !== 0 || !event.isPrimary) return;
										event.preventDefault();
										reorderSessionRef.current = {
											active: false,
											pointerId: event.pointerId,
											sourceId: item.id,
											startY: event.clientY,
										};
										setDropTarget(null);
									},
									onMove: (direction) => movePanel(item.id, direction),
								}}
								style={{
									flex: `0 0 ${allocation.totalHeight}px`,
									height: `${allocation.totalHeight}px`,
								}}
							/>
						);
					})}
					{renderedLayout.separators.map((separator) => {
						const following = items[separator.boundaryIndex];
						const preceding = items[separator.boundaryIndex - 1];
						if (!following || !preceding) return null;
						const disabled =
							separator.state === 'disabled' || !renderedLayout.feasible;
						return (
							// biome-ignore lint/a11y/useSemanticElements: draggable resize control uses separator semantics.
							<button
								aria-controls={`${stackId}-pane-${following.id}`}
								aria-disabled={disabled}
								aria-label={`Resize ${preceding.title} and ${following.title}`}
								aria-orientation="horizontal"
								aria-valuemax={Math.round(separator.maximum)}
								aria-valuemin={Math.round(separator.minimum)}
								aria-valuenow={Math.round(separator.offset)}
								aria-valuetext={`${Math.round(separator.offset)} pixels from the top of the sidebar`}
								className={[
									'sidebar-panel-stack__resize-handle',
									`sidebar-panel-stack__resize-handle--${separator.state}`,
									disabled
										? 'sidebar-panel-stack__resize-handle--disabled'
										: '',
								]
									.filter(Boolean)
									.join(' ')}
								data-sidebar-resize-handle={following.id}
								data-sidebar-resize-state={separator.state}
								disabled={disabled}
								key={following.id}
								role="separator"
								style={{ top: `${separator.offset}px` } as CSSProperties}
								tabIndex={disabled ? -1 : 0}
								onKeyDown={(event) => handleSeparatorKeyDown(event, separator)}
								onPointerCancel={(event) => {
									if (resizeSessionRef.current?.pointerId === event.pointerId) {
										finishResize('cancel');
									}
								}}
								onPointerDown={(event) => beginResize(event, separator)}
								onPointerMove={(event) => {
									if (resizeSessionRef.current?.pointerId !== event.pointerId)
										return;
									event.preventDefault();
									previewResize(event.pointerId, event.clientY);
								}}
								onPointerUp={(event) => {
									if (resizeSessionRef.current?.pointerId !== event.pointerId)
										return;
									event.preventDefault();
									previewResize(event.pointerId, event.clientY);
									finishResize('commit');
								}}
							/>
						);
					})}
				</>
			)}
		</div>
	);
}
