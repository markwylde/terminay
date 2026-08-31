import type {
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
} from 'react';
import { useEffect, useRef } from 'react';

export const LONG_PRESS_DELAY_MS = 500;
export const LONG_PRESS_MOVE_THRESHOLD_PX = 8;

export type LongPressPointerLike = {
	button: number;
	clientX: number;
	clientY: number;
	pointerId: number;
	pointerType: string;
};

export type LongPressSession = {
	consumeClick: () => boolean;
	dispose: () => void;
	pointerCancel: (event: Pick<LongPressPointerLike, 'pointerId'>) => void;
	pointerDown: (event: LongPressPointerLike) => void;
	pointerMove: (
		event: Pick<LongPressPointerLike, 'clientX' | 'clientY' | 'pointerId'>,
	) => void;
	pointerUp: (event: Pick<LongPressPointerLike, 'pointerId'>) => void;
	suppressContextMenu: () => boolean;
};

export function createLongPressSession({
	clearTimeout: clearTimer = clearTimeout,
	delayMs = LONG_PRESS_DELAY_MS,
	moveThresholdPx = LONG_PRESS_MOVE_THRESHOLD_PX,
	onLongPress,
	setTimeout: startTimer = setTimeout,
}: {
	clearTimeout?: (id: ReturnType<typeof setTimeout>) => void;
	delayMs?: number;
	moveThresholdPx?: number;
	onLongPress: () => void;
	setTimeout?: (
		handler: () => void,
		delay: number,
	) => ReturnType<typeof setTimeout>;
}): LongPressSession {
	let fired = false;
	let pointerId: number | null = null;
	let pointerType = '';
	let startX = 0;
	let startY = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const clearTimerOnly = () => {
		if (timer === null) return;
		clearTimer(timer);
		timer = null;
	};

	const resetHold = () => {
		clearTimerOnly();
		pointerId = null;
	};

	return {
		pointerDown(event) {
			if (event.button !== 0) return;
			resetHold();
			fired = false;
			pointerId = event.pointerId;
			pointerType = event.pointerType;
			startX = event.clientX;
			startY = event.clientY;
			timer = startTimer(() => {
				timer = null;
				fired = true;
				onLongPress();
			}, delayMs);
		},
		pointerMove(event) {
			if (event.pointerId !== pointerId || timer === null) return;
			const distance = Math.hypot(
				event.clientX - startX,
				event.clientY - startY,
			);
			if (distance < moveThresholdPx) return;
			resetHold();
		},
		pointerUp(event) {
			if (event.pointerId !== pointerId) return;
			clearTimerOnly();
			pointerId = null;
		},
		pointerCancel(event) {
			if (event.pointerId !== pointerId) return;
			fired = false;
			resetHold();
		},
		consumeClick() {
			if (!fired) return false;
			fired = false;
			pointerType = '';
			return true;
		},
		suppressContextMenu() {
			return pointerType === 'touch' && (pointerId !== null || fired);
		},
		dispose() {
			fired = false;
			pointerType = '';
			resetHold();
		},
	};
}

export function useLongPress(
	onLongPress: () => void,
	options?: { delayMs?: number; disabled?: boolean },
) {
	const onLongPressRef = useRef(onLongPress);
	onLongPressRef.current = onLongPress;
	const sessionRef = useRef<LongPressSession | null>(null);
	if (sessionRef.current === null) {
		sessionRef.current = createLongPressSession({
			...(options?.delayMs === undefined ? {} : { delayMs: options.delayMs }),
			onLongPress: () => onLongPressRef.current(),
		});
	}
	const disabled = options?.disabled === true;
	const unbindWindowRef = useRef<(() => void) | null>(null);
	const unbindWindow = () => {
		unbindWindowRef.current?.();
		unbindWindowRef.current = null;
	};

	useEffect(
		() => () => {
			unbindWindow();
			sessionRef.current?.dispose();
		},
		[],
	);

	const onPointerDown = (event: ReactPointerEvent<Element>) => {
		if (disabled) return;
		sessionRef.current?.pointerDown(event);
		const pointerId = event.pointerId;
		const onMove = (next: PointerEvent) => {
			sessionRef.current?.pointerMove(next);
		};
		const onEnd = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			sessionRef.current?.pointerUp(next);
			unbindWindow();
		};
		const onCancel = (next: PointerEvent) => {
			if (next.pointerId !== pointerId) return;
			sessionRef.current?.pointerCancel(next);
			unbindWindow();
		};
		unbindWindow();
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onEnd);
		window.addEventListener('pointercancel', onCancel);
		unbindWindowRef.current = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onEnd);
			window.removeEventListener('pointercancel', onCancel);
		};
	};
	const onPointerMove = (event: ReactPointerEvent<Element>) => {
		sessionRef.current?.pointerMove(event);
	};
	const onPointerUp = (event: ReactPointerEvent<Element>) => {
		sessionRef.current?.pointerUp(event);
	};
	const onPointerCancel = (event: ReactPointerEvent<Element>) => {
		sessionRef.current?.pointerCancel(event);
	};
	const onContextMenu = (event: ReactMouseEvent<Element>) => {
		if (!sessionRef.current?.suppressContextMenu()) return;
		event.preventDefault();
		event.stopPropagation();
	};
	const bindClick = <
		T extends { preventDefault: () => void; stopPropagation: () => void },
	>(
		onClick?: (event: T) => void,
	) => {
		return (event: T) => {
			if (sessionRef.current?.consumeClick()) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}
			onClick?.(event);
		};
	};

	return {
		bindClick,
		onContextMenu,
		onPointerCancel,
		onPointerDown,
		onPointerMove,
		onPointerUp,
	};
}
