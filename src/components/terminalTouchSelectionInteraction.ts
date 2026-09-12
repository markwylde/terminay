/**
 * Touch text selection and touch link activation over the xterm surface.
 *
 * xterm owns touch on its screen element: its gesture manager calls
 * preventDefault on the touchstart it consumes, so a touch device never
 * receives the compatibility mouse events a browser would otherwise
 * synthesise. That is what makes panning work — a drag reaches xterm as a
 * gesture and becomes wheel mouse reports, a viewport scroll, or cursor keys
 * depending on what the foreground program asked for — and it is also why a
 * tap can neither follow a link nor start a selection.
 *
 * Both gestures here are additive. They are armed only by a touch that today
 * does nothing: a tap that lands on a link, and a stationary hold that passes
 * one second. A touch that travels beyond the movement threshold is a pan and
 * is left entirely alone, so xterm's panning behaviour is untouched.
 */

export const TOUCH_SELECTION_HOLD_MS = 1000;

export type TouchSelectionPoint = Readonly<{
	clientX: number;
	clientY: number;
	pointerId: number;
}>;

export type TerminalTouchSelectionSession = Readonly<{
	dispose: () => void;
	/** True once the hold has been recognised, for this gesture only. */
	isSelecting: () => boolean;
	pointerCancel: (point: Pick<TouchSelectionPoint, 'pointerId'>) => void;
	pointerDown: (point: TouchSelectionPoint) => void;
	pointerMove: (point: TouchSelectionPoint) => void;
	pointerUp: (point: TouchSelectionPoint) => void;
}>;

/**
 * Single-pointer hold-to-select state machine. Arms on down, disarms on travel
 * past the movement threshold — that gesture is a pan and belongs to xterm —
 * and promotes to selection when the finger is still for the hold duration.
 */
export function createTerminalTouchSelectionSession({
	clearTimeout: clearTimer = clearTimeout,
	holdMs = TOUCH_SELECTION_HOLD_MS,
	isEnabled,
	moveThresholdPx,
	onSelectionEnd,
	onSelectionMove,
	onSelectionStart,
	setTimeout: startTimer = setTimeout,
}: {
	clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
	holdMs?: number;
	isEnabled: () => boolean;
	moveThresholdPx: number;
	onSelectionEnd: (point: TouchSelectionPoint) => void;
	onSelectionMove: (point: TouchSelectionPoint) => void;
	onSelectionStart: (point: TouchSelectionPoint) => void;
	setTimeout?: (
		handler: () => void,
		delay: number,
	) => ReturnType<typeof setTimeout>;
}): TerminalTouchSelectionSession {
	let pointerId: number | null = null;
	let selecting = false;
	let start: TouchSelectionPoint | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearTimerOnly = () => {
		if (timer === null) return;
		clearTimer(timer);
		timer = null;
	};

	const reset = () => {
		clearTimerOnly();
		pointerId = null;
		selecting = false;
		start = null;
	};

	return {
		pointerDown(point) {
			// A second finger landing mid-selection is a stray touch, not a new
			// gesture; the drag in progress keeps the pointer it started with.
			if (selecting && point.pointerId !== pointerId) return;
			reset();
			if (!isEnabled()) return;
			pointerId = point.pointerId;
			start = point;
			timer = startTimer(() => {
				timer = null;
				if (start === null) return;
				selecting = true;
				onSelectionStart(start);
			}, holdMs);
		},
		pointerMove(point) {
			if (point.pointerId !== pointerId) return;
			if (selecting) {
				onSelectionMove(point);
				return;
			}
			if (start === null || timer === null) return;
			const travelled = Math.hypot(
				point.clientX - start.clientX,
				point.clientY - start.clientY,
			);
			if (travelled < moveThresholdPx) return;
			// The finger is panning. Release the gesture back to xterm untouched.
			reset();
		},
		pointerUp(point) {
			if (point.pointerId !== pointerId) return;
			const wasSelecting = selecting;
			reset();
			if (wasSelecting) onSelectionEnd(point);
		},
		pointerCancel(point) {
			if (point.pointerId !== pointerId) return;
			reset();
		},
		isSelecting() {
			return selecting;
		},
		dispose() {
			reset();
		},
	};
}

type SelectionCapableTerminal = {
	_core?: {
		_selectionService?: {
			enable?: () => void;
			disable?: () => void;
		};
	};
	modes?: { mouseTrackingMode?: string };
};

export type MouseEventTarget = {
	dispatchEvent: (event: Event) => boolean;
	ownerDocument?: Document | null;
};

export type TerminalTouchSelectionDriver = Readonly<{
	begin: (point: TouchSelectionPoint) => void;
	end: (point: TouchSelectionPoint) => void;
	extend: (point: TouchSelectionPoint) => void;
}>;

function mouseEventInit(
	point: TouchSelectionPoint,
	detail: number,
): MouseEventInit {
	return {
		bubbles: true,
		button: 0,
		buttons: 1,
		cancelable: true,
		clientX: point.clientX,
		clientY: point.clientY,
		detail,
		view: globalThis.window,
	};
}

/**
 * Drives xterm's own selection from a touch gesture by synthesising the mouse
 * events it already understands. Reusing xterm's selection service — rather
 * than computing a selection alongside it — keeps one notion of what is
 * selected, so the existing copy paths, the selection overlay, and drag
 * autoscroll all keep working unchanged.
 */
export function createTerminalTouchSelectionDriver({
	screenElement,
	terminal,
}: {
	screenElement: MouseEventTarget;
	terminal: unknown;
}): TerminalTouchSelectionDriver {
	let restoreSelectionService: (() => void) | null = null;

	const selectionService = () =>
		(terminal as SelectionCapableTerminal)._core?._selectionService;

	const documentTarget = (): MouseEventTarget | null =>
		screenElement.ownerDocument ?? null;

	return {
		begin(point) {
			// A program in mouse tracking mode has xterm's selection disabled so its
			// own drags reach the program. The hold is an explicit request for the
			// selection instead, so lend it back for the length of the gesture.
			const service = selectionService();
			if (
				(terminal as SelectionCapableTerminal).modes?.mouseTrackingMode !==
					'none' &&
				service?.enable !== undefined &&
				service.disable !== undefined
			) {
				service.enable();
				restoreSelectionService = () => service.disable?.();
			}
			// detail 2 selects the word under the finger, so the hold confirms
			// itself visibly at the moment it is recognised.
			screenElement.dispatchEvent(
				new MouseEvent('mousedown', mouseEventInit(point, 2)),
			);
		},
		extend(point) {
			documentTarget()?.dispatchEvent(
				new MouseEvent('mousemove', mouseEventInit(point, 0)),
			);
		},
		end(point) {
			documentTarget()?.dispatchEvent(
				new MouseEvent('mouseup', { ...mouseEventInit(point, 0), buttons: 0 }),
			);
			restoreSelectionService?.();
			restoreSelectionService = null;
		},
	};
}

/**
 * A tap that may be on a link. xterm resolves links from mouse movement and
 * activates them on mouse up, and touch delivers neither, so replay that pair
 * at the tap position. Resolution is asynchronous, so the release is deferred
 * by one frame; when the tap was not on a link both events are inert.
 *
 * A program in mouse tracking mode owns its own clicks — a synthesised release
 * would reach it as a button report it never saw pressed — so taps are left
 * alone there.
 */
export function activateTerminalLinkAtTouch({
	afterFrame = (run) =>
		typeof requestAnimationFrame === 'function'
			? void requestAnimationFrame(() => run())
			: void setTimeout(run, 16),
	point,
	screenElement,
	terminal,
}: {
	afterFrame?: (run: () => void) => void;
	point: TouchSelectionPoint;
	screenElement: MouseEventTarget;
	terminal: unknown;
}): void {
	if (
		(terminal as SelectionCapableTerminal).modes?.mouseTrackingMode !== 'none'
	) {
		return;
	}

	screenElement.dispatchEvent(
		new MouseEvent('mousemove', {
			...mouseEventInit(point, 0),
			buttons: 0,
		}),
	);
	afterFrame(() => {
		screenElement.dispatchEvent(
			new MouseEvent('mouseup', { ...mouseEventInit(point, 1), buttons: 0 }),
		);
	});
}

/**
 * Where to float the copy affordance for a finished touch selection. Touch has
 * no right click, so a selection with no way to copy it would be pointless.
 * The pill sits above the release point, clamped inside the panel so it cannot
 * be pushed off an edge.
 */
export function touchSelectionCopyAnchor({
	height,
	offsetY = 52,
	pillHeight = 36,
	pillWidth = 84,
	point,
	width,
}: {
	height: number;
	offsetY?: number;
	pillHeight?: number;
	pillWidth?: number;
	point: Readonly<{ x: number; y: number }>;
	width: number;
}): Readonly<{ x: number; y: number }> {
	const clamp = (value: number, max: number) =>
		Math.max(0, Math.min(value, Math.max(0, max)));
	const preferredY = point.y - offsetY;
	return {
		x: clamp(point.x - pillWidth / 2, width - pillWidth),
		y: clamp(
			preferredY < 0 ? point.y + offsetY - pillHeight : preferredY,
			height - pillHeight,
		),
	};
}
