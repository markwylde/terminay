import {
	createLongPressSession,
	LONG_PRESS_MOVE_THRESHOLD_PX,
	type LongPressPointerLike,
} from '../hooks/useLongPress.ts';

// A touch must be held this long, without moving, before it may drag an
// Explorer entry. Moving sooner leaves the gesture to the browser to scroll.
export const FILE_EXPLORER_TOUCH_DRAG_HOLD_MS = 1000;

export type FileExplorerTouchPress = {
	armedPointerId: () => number | null;
	consumeClick: () => boolean;
	dispose: () => void;
	pointerCancel: (event: Pick<LongPressPointerLike, 'pointerId'>) => void;
	pointerDown: (event: LongPressPointerLike) => void;
	pointerMove: (
		event: Pick<LongPressPointerLike, 'clientX' | 'clientY' | 'pointerId'>,
	) => void;
	/** Returns true when the released touch had been armed by a hold. */
	pointerUp: (event: Pick<LongPressPointerLike, 'pointerId'>) => boolean;
	suppressContextMenu: () => boolean;
};

export function createFileExplorerTouchPress({
	clearTimeout,
	onArm,
	setTimeout,
}: {
	clearTimeout?: (id: ReturnType<typeof globalThis.setTimeout>) => void;
	onArm: (pointerId: number) => void;
	setTimeout?: (
		handler: () => void,
		delay: number,
	) => ReturnType<typeof globalThis.setTimeout>;
}): FileExplorerTouchPress {
	let pressedPointerId: number | null = null;
	let armedPointerId: number | null = null;

	const session = createLongPressSession({
		...(clearTimeout ? { clearTimeout } : {}),
		...(setTimeout ? { setTimeout } : {}),
		delayMs: FILE_EXPLORER_TOUCH_DRAG_HOLD_MS,
		moveThresholdPx: LONG_PRESS_MOVE_THRESHOLD_PX,
		onLongPress: () => {
			if (pressedPointerId === null) return;
			armedPointerId = pressedPointerId;
			onArm(pressedPointerId);
		},
	});

	const endPress = (pointerId: number) => {
		if (pointerId !== pressedPointerId) return false;
		const wasArmed = armedPointerId === pointerId;
		pressedPointerId = null;
		armedPointerId = null;
		return wasArmed;
	};

	const dispose = () => {
		pressedPointerId = null;
		armedPointerId = null;
		session.dispose();
	};

	return {
		armedPointerId: () => armedPointerId,
		consumeClick: () => session.consumeClick(),
		dispose,
		pointerCancel(event) {
			session.pointerCancel(event);
			endPress(event.pointerId);
		},
		pointerDown(event) {
			if (event.pointerType !== 'touch' || event.button !== 0) {
				// A mouse or pen press must not inherit a finished touch's
				// click or context-menu suppression.
				dispose();
				return;
			}
			pressedPointerId = event.pointerId;
			armedPointerId = null;
			session.pointerDown(event);
		},
		pointerMove(event) {
			if (event.pointerId !== pressedPointerId) return;
			session.pointerMove(event);
		},
		pointerUp(event) {
			session.pointerUp(event);
			return endPress(event.pointerId);
		},
		suppressContextMenu: () => session.suppressContextMenu(),
	};
}
