/**
 * Reordering a list by its grips, with a pointer or with the arrow keys.
 *
 * Pointer events rather than HTML drag and drop, as the project menu's grips
 * use: they work on touch and inside title-bar drag regions. The dragged item
 * follows the pointer along the list's axis only, the others step aside to open
 * its place, and nothing changes order until release, when the caller commits
 * the move through the server. Escape or a lost pointer puts everything back.
 */

import type {
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
	RefObject,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	GRIP_DRAG_THRESHOLD_PX,
	type GripItemSpan,
	gripAutoscrollStep,
	gripKeyTarget,
	gripShiftFor,
	gripTargetIndex,
} from './gripReorderModel.ts';

type Drag = Readonly<{
	from: number;
	offset: number;
	pointerId: number;
	spans: readonly GripItemSpan[];
	started: boolean;
	startPointer: number;
	startScroll: number;
	target: number;
}>;

/**
 * Whether a grip drag is under way anywhere. A drag is the topmost layer while
 * it lasts, so a surface that closes on Escape leaves that key to the drag.
 */
export const gripDragState = { active: false };

export type GripReorderOptions = Readonly<{
	/** The element whose children carry `data-grip-item`, in list order. */
	listRef: RefObject<HTMLElement | null>;
	/** The element that scrolls while a drag is held near an edge. */
	scrollRef?: RefObject<HTMLElement | null>;
	onCommit: (from: number, to: number) => void;
	/** Said once a keyboard move lands, for a polite live region. */
	onAnnounce?: (message: string) => void;
	/** Names an item for the announcement. */
	describe?: (index: number) => string;
}>;

export function useGripReorder({
	describe,
	listRef,
	onAnnounce,
	onCommit,
	scrollRef,
}: GripReorderOptions) {
	const [drag, setDrag] = useState<Drag | null>(null);
	const dragRef = useRef<Drag | null>(null);
	const pointerRef = useRef(0);
	const frameRef = useRef<number | null>(null);
	const commitRef = useRef(onCommit);
	commitRef.current = onCommit;

	// The click a released drag ends in is not a press of what was dragged.
	const swallowClickRef = useRef(false);
	const update = useCallback((next: Drag | null) => {
		dragRef.current = next;
		gripDragState.active = next?.started === true;
		setDrag(next);
	}, []);

	const stopFrame = () => {
		if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
	};

	const measure = (): GripItemSpan[] => {
		const list = listRef.current;
		if (list === null) return [];
		return Array.from(
			list.querySelectorAll<HTMLElement>(':scope > [data-grip-item]'),
		).map((element) => {
			const rect = element.getBoundingClientRect();
			return { start: rect.top, size: rect.height };
		});
	};

	const move = useCallback(
		(pointer: number) => {
			const current = dragRef.current;
			if (current === null) return;
			const scroll = scrollRef?.current?.scrollTop ?? 0;
			const offset =
				pointer - current.startPointer + (scroll - current.startScroll);
			const started =
				current.started || Math.abs(offset) >= GRIP_DRAG_THRESHOLD_PX;
			if (!started) return;
			update({
				...current,
				offset,
				started,
				target: gripTargetIndex(current.spans, current.from, offset),
			});
		},
		[scrollRef, update],
	);

	const tick = useCallback(() => {
		frameRef.current = null;
		const current = dragRef.current;
		const scroller = scrollRef?.current;
		if (current === null || !current.started || scroller == null) return;
		const rect = scroller.getBoundingClientRect();
		const step = gripAutoscrollStep(pointerRef.current, rect.top, rect.bottom);
		if (step === 0) return;
		scroller.scrollTop += step;
		move(pointerRef.current);
		frameRef.current = requestAnimationFrame(tick);
	}, [move, scrollRef]);

	const end = useCallback(
		(commit: boolean) => {
			stopFrame();
			const current = dragRef.current;
			update(null);
			if (current?.started === true) swallowClickRef.current = true;
			if (!commit || current === null || !current.started) return;
			if (current.target !== current.from)
				commitRef.current(current.from, current.target);
		},
		[update],
	);

	// Bound once per drag; the handlers read the latest drag from the ref.
	const dragPointerId = drag?.pointerId;
	useEffect(() => {
		if (dragPointerId === undefined) return;
		const pointerId = dragPointerId;
		const onMove = (event: PointerEvent) => {
			if (event.pointerId !== pointerId) return;
			pointerRef.current = event.clientY;
			move(event.clientY);
			if (frameRef.current === null)
				frameRef.current = requestAnimationFrame(tick);
		};
		const onUp = (event: PointerEvent) => {
			if (event.pointerId === pointerId) end(true);
		};
		const onCancel = (event: PointerEvent) => {
			if (event.pointerId === pointerId) end(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			// The drag is the topmost layer while it lasts.
			event.preventDefault();
			event.stopPropagation();
			end(false);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onCancel);
		window.addEventListener('keydown', onKey, { capture: true });
		return () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onCancel);
			window.removeEventListener('keydown', onKey, { capture: true });
		};
	}, [dragPointerId, end, move, tick]);

	useEffect(() => stopFrame, []);

	const gripProps = (index: number, count: number) => ({
		onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			pointerRef.current = event.clientY;
			update({
				from: index,
				offset: 0,
				pointerId: event.pointerId,
				spans: measure(),
				started: false,
				startPointer: event.clientY,
				startScroll: scrollRef?.current?.scrollTop ?? 0,
				target: index,
			});
		},
		onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
			const to = gripKeyTarget(event.key, index, count);
			if (to === undefined) return;
			event.preventDefault();
			event.stopPropagation();
			commitRef.current(index, to);
			onAnnounce?.(
				`${describe?.(index) ?? 'Item'} moved to position ${to + 1} of ${count}`,
			);
		},
	});

	/** The transform an item takes while a drag is under way. */
	const itemStyle = (index: number): CSSProperties | undefined => {
		if (drag === null || !drag.started) return undefined;
		if (index === drag.from)
			return {
				transform: `translateY(${drag.offset}px)`,
				zIndex: 2,
				position: 'relative',
			};
		const shift = gripShiftFor(
			index,
			drag.from,
			drag.target,
			drag.spans[drag.from]?.size ?? 0,
		);
		return shift === 0 ? undefined : { transform: `translateY(${shift}px)` };
	};

	/** True once, for the click that follows a drag's release. */
	const consumeDragClick = () => {
		if (!swallowClickRef.current) return false;
		swallowClickRef.current = false;
		return true;
	};

	return {
		consumeDragClick,
		draggingIndex: drag?.started === true ? drag.from : undefined,
		gripProps,
		itemStyle,
	};
}
