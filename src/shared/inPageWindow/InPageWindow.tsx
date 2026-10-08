import { Maximize2, Minimize2, X } from 'lucide-react';
import {
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import {
	defaultRect,
	fitRemembered,
	isCompactViewport,
	type ResizeEdges,
	rectAfterMove,
	rectAfterViewportResize,
	rectForViewport,
	type WindowRect,
	type WindowSize,
} from './geometry.ts';
import {
	type InPageWindowId,
	readRememberedGeometry,
	writeRememberedGeometry,
} from './geometryStore.ts';
import { closeTopOnEscape, inPageWindowStack } from './windowStack.ts';
import './inPageWindow.css';

/** A resizable window is remembered by its id; a content-sized one only has a width. */
export type InPageWindowKind =
	| Readonly<{ resizable: true; id: InPageWindowId; defaultSize: WindowSize }>
	| Readonly<{ resizable: false; width: number }>;

export type InPageWindowProps = Readonly<{
	title: string;
	kind: InPageWindowKind;
	onClose: () => void;
	children: ReactNode;
	/** Names the window for styling and tests; never decides behaviour. */
	name?: string;
	className?: string;
	/** Drawn before the title. */
	icon?: ReactNode;
	/** While true the window cannot be closed: its work must finish first. */
	busy?: boolean;
}>;

/** A pointer must travel this far before a press on a title bar is a drag. */
const DRAG_THRESHOLD = 4;
/** The gap a window opening at its default keeps from the viewport edges. */
const DEFAULT_MARGIN = 24;

const RESIZE_HANDLES: readonly (readonly [string, ResizeEdges])[] = [
	['n', { x: 0, y: -1 }],
	['s', { x: 0, y: 1 }],
	['e', { x: 1, y: 0 }],
	['w', { x: -1, y: 0 }],
	['ne', { x: 1, y: -1 }],
	['nw', { x: -1, y: -1 }],
	['se', { x: 1, y: 1 }],
	['sw', { x: -1, y: 1 }],
];

/** Where the user put a window, and the viewport it was put in. */
type Placement = Readonly<{ rect: WindowRect; viewport: WindowSize }>;

type Gesture = Readonly<{
	pointerId: number;
	startX: number;
	startY: number;
	rect: WindowRect;
	edges: ResizeEdges | null;
}>;

function readViewport(): WindowSize {
	return { width: window.innerWidth, height: window.innerHeight };
}

function initialPlacement(
	kind: InPageWindowKind,
	viewport: WindowSize,
): Placement | null {
	if (!kind.resizable) return null;
	const remembered = readRememberedGeometry(kind.id);
	const rect =
		remembered === null
			? defaultRect(
					{
						width: Math.min(
							kind.defaultSize.width,
							viewport.width - DEFAULT_MARGIN * 2,
						),
						height: Math.min(
							kind.defaultSize.height,
							viewport.height - DEFAULT_MARGIN * 2,
						),
					},
					viewport,
				)
			: fitRemembered(remembered, viewport);
	return { rect, viewport };
}

function useStackDepth(close: () => void): number {
	const closeRef = useRef(close);
	closeRef.current = close;
	const entry = useMemo(() => ({ close: () => closeRef.current() }), []);
	useLayoutEffect(() => inPageWindowStack.push(entry), [entry]);
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (inPageWindowStack.top() === entry) {
				closeTopOnEscape(inPageWindowStack, event);
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [entry]);
	return useSyncExternalStore(inPageWindowStack.subscribe, () =>
		Math.max(0, inPageWindowStack.depthOf(entry)),
	);
}

function focusableIn(root: HTMLElement): HTMLElement[] {
	return Array.from(
		root.querySelectorAll<HTMLElement>(
			'a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])',
		),
	).filter(
		(element) =>
			!element.hasAttribute('disabled') &&
			!element.hasAttribute('data-in-page-window-sentinel') &&
			element.getClientRects().length > 0,
	);
}

/**
 * The one frame every in-page window and dialog is drawn in: backdrop, title
 * bar, close and maximise, movement, resizing, and focus. It is modal; a
 * dialog opened from inside a window stacks above it.
 *
 * The frame is placed with `left` and `top`, never a transform, and the
 * blurred backdrop is its sibling: either would make the frame the containing
 * block of a fixed-position dialog nested inside it.
 */
export function InPageWindow({
	title,
	kind,
	onClose,
	children,
	name,
	className,
	icon,
	busy = false,
}: InPageWindowProps) {
	const titleId = useId();
	const frameRef = useRef<HTMLElement>(null);
	const layerRef = useRef<HTMLDivElement>(null);
	const gestureRef = useRef<Gesture | null>(null);
	const draggedRef = useRef(false);
	// Read while rendering, before anything inside the window can take focus.
	const [returnFocus] = useState(() => document.activeElement);
	const [viewport, setViewport] = useState(readViewport);
	const [placement, setPlacement] = useState(() =>
		initialPlacement(kind, readViewport()),
	);
	const [maximized, setMaximized] = useState(
		() => kind.resizable && readRememberedGeometry(kind.id)?.maximized === true,
	);
	const [contentSize, setContentSize] = useState<WindowSize | null>(null);
	const [gesturing, setGesturing] = useState(false);
	const close = useCallback(() => {
		if (!busy) onClose();
	}, [busy, onClose]);
	const depth = useStackDepth(close);
	const compact = isCompactViewport(viewport);
	const filled = compact || (kind.resizable && maximized);
	const resizableId = kind.resizable ? kind.id : null;

	useEffect(() => {
		const layer = layerRef.current;
		if (layer === null) return;
		const measure = () =>
			setViewport((current) =>
				current.width === layer.clientWidth &&
				current.height === layer.clientHeight
					? current
					: { width: layer.clientWidth, height: layer.clientHeight },
			);
		const observer = new ResizeObserver(measure);
		observer.observe(layer);
		measure();
		return () => observer.disconnect();
	}, []);

	// A content-sized window can grow after it opens; a moved one is kept
	// reachable at whatever size its content now has.
	useEffect(() => {
		const frame = frameRef.current;
		if (frame === null || kind.resizable) return;
		const observer = new ResizeObserver(() =>
			setContentSize({ width: frame.offsetWidth, height: frame.offsetHeight }),
		);
		observer.observe(frame);
		return () => observer.disconnect();
	}, [kind.resizable]);

	useEffect(() => {
		const frame = frameRef.current;
		if (frame !== null && !frame.contains(document.activeElement)) {
			frame.focus({ preventScroll: true });
		}
		return () => {
			if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
				returnFocus.focus({ preventScroll: true });
			}
		};
	}, [returnFocus]);

	const remember = useCallback(
		(next: Placement | null, nextMaximized: boolean) => {
			if (resizableId === null || next === null) return;
			writeRememberedGeometry(resizableId, {
				...next.rect,
				maximized: nextMaximized,
			});
		},
		[resizableId],
	);

	const toggleMaximized = useCallback(() => {
		if (resizableId === null) return;
		remember(placement, !maximized);
		setMaximized(!maximized);
	}, [maximized, placement, remember, resizableId]);

	const shown = useMemo<WindowRect | null>(() => {
		if (placement === null) return null;
		if (kind.resizable) {
			return rectForViewport(placement.rect, placement.viewport, viewport);
		}
		const size = contentSize ?? placement.rect;
		const rect = { ...placement.rect, ...size };
		return rectForViewport(rect, placement.viewport, viewport, size);
	}, [contentSize, kind.resizable, placement, viewport]);

	const applyRect = (rect: WindowRect, edges: ResizeEdges | null) => {
		const frame = frameRef.current;
		if (frame === null) return;
		frame.dataset.placed = 'true';
		frame.style.left = `${rect.x}px`;
		frame.style.top = `${rect.y}px`;
		if (edges !== null) {
			frame.style.width = `${rect.width}px`;
			frame.style.height = `${rect.height}px`;
		}
	};

	const rectDuring = (gesture: Gesture, event: ReactPointerEvent) => {
		const deltaX = event.clientX - gesture.startX;
		const deltaY = event.clientY - gesture.startY;
		return gesture.edges === null
			? rectAfterMove(gesture.rect, deltaX, deltaY, viewport)
			: rectAfterViewportResize(
					gesture.rect,
					gesture.edges,
					deltaX,
					deltaY,
					viewport,
				);
	};

	const beginGesture = (
		event: ReactPointerEvent<HTMLElement>,
		edges: ResizeEdges | null,
	) => {
		if (event.button !== 0 || filled) return;
		if (edges === null && (event.target as Element).closest('button') !== null) {
			return;
		}
		const frame = frameRef.current;
		if (frame === null) return;
		const bounds = frame.getBoundingClientRect();
		const layer = layerRef.current?.getBoundingClientRect();
		gestureRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			rect: {
				x: bounds.left - (layer?.left ?? 0),
				y: bounds.top - (layer?.top ?? 0),
				width: bounds.width,
				height: bounds.height,
			},
			edges,
		};
		draggedRef.current = edges !== null;
		event.currentTarget.setPointerCapture(event.pointerId);
		if (edges !== null) {
			event.preventDefault();
			setGesturing(true);
		}
	};

	const continueGesture = (event: ReactPointerEvent<HTMLElement>) => {
		const gesture = gestureRef.current;
		if (gesture === null || gesture.pointerId !== event.pointerId) return;
		if (!draggedRef.current) {
			const travelled = Math.hypot(
				event.clientX - gesture.startX,
				event.clientY - gesture.startY,
			);
			if (travelled < DRAG_THRESHOLD) return;
			draggedRef.current = true;
			// A centred content-sized window takes a position the moment it moves.
			if (placement === null) {
				setPlacement({ rect: gesture.rect, viewport });
			}
			setGesturing(true);
		}
		applyRect(rectDuring(gesture, event), gesture.edges);
	};

	const endGesture = (
		event: ReactPointerEvent<HTMLElement>,
		cancelled: boolean,
	) => {
		const gesture = gestureRef.current;
		if (gesture === null || gesture.pointerId !== event.pointerId) return;
		gestureRef.current = null;
		setGesturing(false);
		if (!draggedRef.current) return;
		const next: Placement = {
			rect: cancelled ? gesture.rect : rectDuring(gesture, event),
			viewport,
		};
		// A cancelled gesture puts back the rectangle it started from.
		applyRect(next.rect, gesture.edges);
		setPlacement(next);
		if (!cancelled) remember(next, false);
	};

	const redirectFocus = (toEnd: boolean) => {
		const frame = frameRef.current;
		if (frame === null) return;
		const focusable = focusableIn(frame);
		(toEnd ? focusable.at(-1) : focusable[0])?.focus();
	};

	const frameStyle: CSSProperties = filled
		? {}
		: shown === null
			? { width: kind.resizable ? undefined : kind.width }
			: kind.resizable
				? {
						left: shown.x,
						top: shown.y,
						width: shown.width,
						height: shown.height,
					}
				: {
						left: shown.x,
						top: shown.y,
						width: kind.width,
						maxHeight: viewport.height,
					};

	return (
		<div
			ref={layerRef}
			className="in-page-window-layer"
			data-gesturing={gesturing || undefined}
			data-in-page-window-depth={depth}
			style={{ zIndex: 10000 + depth }}
		>
			<div
				className="in-page-window-backdrop"
				role="presentation"
				onPointerDown={(event) => {
					if (event.button === 0) close();
				}}
			/>
			<section
				ref={frameRef}
				aria-labelledby={titleId}
				aria-modal="true"
				className={
					className === undefined
						? 'in-page-window'
						: `in-page-window ${className}`
				}
				data-compact={compact || undefined}
				data-connected-web-auxiliary-route={name}
				data-in-page-window={name ?? 'dialog'}
				data-maximized={(!compact && filled) || undefined}
				data-placed={shown !== null || undefined}
				data-resizable={kind.resizable || undefined}
				role="dialog"
				style={frameStyle}
				tabIndex={-1}
			>
				<span
					data-in-page-window-sentinel=""
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a focus guard that hands focus back into the window
					tabIndex={0}
					onFocus={() => redirectFocus(true)}
				/>
				<div className="in-page-window__chrome">
					<header
						className="in-page-window__titlebar"
						onDoubleClick={(event) => {
							if ((event.target as Element).closest('button') === null) {
								toggleMaximized();
							}
						}}
						onPointerCancel={(event) => endGesture(event, true)}
						onPointerDown={(event) => beginGesture(event, null)}
						onPointerMove={continueGesture}
						onPointerUp={(event) => endGesture(event, false)}
					>
						{icon === undefined ? null : (
							<span aria-hidden="true" className="in-page-window__icon">
								{icon}
							</span>
						)}
						<h2 className="in-page-window__title" id={titleId}>
							{title}
						</h2>
						<div className="in-page-window__controls">
							{kind.resizable && !compact ? (
								<button
									aria-label={maximized ? 'Restore' : 'Maximise'}
									aria-pressed={maximized}
									className="in-page-window__control"
									data-in-page-window-control="maximise"
									type="button"
									onClick={toggleMaximized}
								>
									{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
								</button>
							) : null}
							<button
								aria-label="Close"
								className="in-page-window__control"
								data-in-page-window-control="close"
								disabled={busy}
								type="button"
								onClick={close}
							>
								<X size={16} />
							</button>
						</div>
					</header>
					<div className="in-page-window__body">{children}</div>
				</div>
				{kind.resizable && !filled
					? RESIZE_HANDLES.map(([handle, edges]) => (
							<div
								key={handle}
								aria-hidden="true"
								className={`in-page-window__resize in-page-window__resize--${handle}`}
								data-in-page-window-resize={handle}
								onPointerCancel={(event) => endGesture(event, true)}
								onPointerDown={(event) => beginGesture(event, edges)}
								onPointerMove={continueGesture}
								onPointerUp={(event) => endGesture(event, false)}
							/>
						))
					: null}
				<span
					data-in-page-window-sentinel=""
					// biome-ignore lint/a11y/noNoninteractiveTabindex: a focus guard that hands focus back into the window
					tabIndex={0}
					onFocus={() => redirectFocus(false)}
				/>
			</section>
		</div>
	);
}
