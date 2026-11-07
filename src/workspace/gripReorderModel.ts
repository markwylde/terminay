/**
 * The arithmetic behind a grip-dragged list.
 *
 * Kept apart from the hook so it can be tested without a DOM: where a dragged
 * item would land, how far each other item steps aside to open its place, and
 * what order a commit asks for.
 */

/** Below this distance a press on a grip is not a drag. */
export const GRIP_DRAG_THRESHOLD_PX = 4;

/** How close to an edge the pointer must be held for the list to scroll. */
export const GRIP_AUTOSCROLL_EDGE_PX = 32;

/** The span an item takes along the list's axis. */
export type GripItemSpan = Readonly<{ start: number; size: number }>;

/**
 * Where the dragged item would land: the index of the first item whose middle
 * the dragged item's middle has not passed, counting the dragged item out.
 */
export function gripTargetIndex(
	spans: readonly GripItemSpan[],
	from: number,
	offset: number,
): number {
	const dragged = spans[from];
	if (dragged === undefined) return from;
	const middle = dragged.start + offset + dragged.size / 2;
	let target = 0;
	for (let index = 0; index < spans.length; index += 1) {
		if (index === from) continue;
		const span = spans[index];
		if (span === undefined) continue;
		if (middle > span.start + span.size / 2) target += 1;
	}
	return target;
}

/** How far an item other than the dragged one steps to open the target slot. */
export function gripShiftFor(
	index: number,
	from: number,
	target: number,
	draggedSize: number,
): number {
	if (index === from) return 0;
	if (from < target && index > from && index <= target) return -draggedSize;
	if (from > target && index >= target && index < from) return draggedSize;
	return 0;
}

/** The list with the item at `from` moved to `to`. */
export function moveItem<T>(
	items: readonly T[],
	from: number,
	to: number,
): T[] {
	const next = [...items];
	if (from < 0 || from >= next.length) return next;
	const [item] = next.splice(from, 1);
	if (item === undefined) return [...items];
	const clamped = Math.max(0, Math.min(to, next.length));
	next.splice(clamped, 0, item);
	return next;
}

/** One keyboard step, or undefined at either end of the list. */
export function gripKeyTarget(
	key: string,
	index: number,
	count: number,
): number | undefined {
	if (key === 'ArrowUp' && index > 0) return index - 1;
	if (key === 'ArrowDown' && index < count - 1) return index + 1;
	return undefined;
}

/**
 * How far to scroll this frame while a drag is held near an edge: negative
 * near the top, positive near the bottom, zero elsewhere.
 */
export function gripAutoscrollStep(
	pointer: number,
	viewStart: number,
	viewEnd: number,
): number {
	if (pointer < viewStart + GRIP_AUTOSCROLL_EDGE_PX)
		return -Math.ceil((viewStart + GRIP_AUTOSCROLL_EDGE_PX - pointer) / 4);
	if (pointer > viewEnd - GRIP_AUTOSCROLL_EDGE_PX)
		return Math.ceil((pointer - (viewEnd - GRIP_AUTOSCROLL_EDGE_PX)) / 4);
	return 0;
}
