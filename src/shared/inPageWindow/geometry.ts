/**
 * Where an in-page window sits inside the viewport.
 *
 * Pure geometry, so the rules can be tested without a browser. A window being
 * moved may hang off the sides and bottom as far as its title bar stays
 * reachable; a window being opened, restored, or squeezed by a shrinking
 * viewport is brought fully inside.
 */

import { PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH } from '../../workspace/projectTabOverflow.ts';

export interface WindowRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface WindowSize {
	readonly width: number;
	readonly height: number;
}

/** Which edges of a window a resize moves: -1 the left or top, 1 the right or bottom. */
export interface ResizeEdges {
	readonly x: -1 | 0 | 1;
	readonly y: -1 | 0 | 1;
}

export interface ResizeLimits {
	readonly minWidth: number;
	readonly minHeight: number;
	/** The furthest the right and bottom edges may be dragged. Unbounded when absent. */
	readonly maxRight?: number;
	readonly maxBottom?: number;
}

export const TITLE_BAR_HEIGHT = 36;
export const TITLE_BAR_HEIGHT_COMPACT = 44;
/** How much of a moved window's title bar stays inside the viewport. */
export const TITLE_KEEP = 160;
export const MIN_WINDOW_SIZE: WindowSize = { width: 480, height: 320 };

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Compact is the workspace chrome's own breakpoint, so a window and the bar agree. */
export function isCompactViewport(viewport: WindowSize): boolean {
	return (
		viewport.width > 0 &&
		viewport.width <= PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH
	);
}

/** The minimum a window can be in this viewport: never more than the viewport itself. */
function minimumIn(viewport: WindowSize, min: WindowSize): WindowSize {
	return {
		width: Math.min(min.width, viewport.width),
		height: Math.min(min.height, viewport.height),
	};
}

/** A window of the given size, centred, and no larger than the viewport. */
export function defaultRect(size: WindowSize, viewport: WindowSize): WindowRect {
	const width = Math.min(size.width, viewport.width);
	const height = Math.min(size.height, viewport.height);
	return {
		x: Math.round((viewport.width - width) / 2),
		y: Math.round((viewport.height - height) / 2),
		width,
		height,
	};
}

/**
 * The rectangle brought fully inside the viewport: moved first, and made
 * smaller only when it does not fit at its size.
 */
export function clampToViewport(
	rect: WindowRect,
	viewport: WindowSize,
	min: WindowSize = MIN_WINDOW_SIZE,
): WindowRect {
	const least = minimumIn(viewport, min);
	const width = clamp(rect.width, least.width, viewport.width);
	const height = clamp(rect.height, least.height, viewport.height);
	return {
		x: clamp(rect.x, 0, viewport.width - width),
		y: clamp(rect.y, 0, viewport.height - height),
		width,
		height,
	};
}

/** Where a window may be moved to: its title bar stays reachable. */
export function keepReachable(rect: WindowRect, viewport: WindowSize): WindowRect {
	const keep = Math.min(TITLE_KEEP, rect.width);
	return {
		...rect,
		x: clamp(rect.x, keep - rect.width, viewport.width - keep),
		y: clamp(rect.y, 0, viewport.height - TITLE_BAR_HEIGHT),
	};
}

/** The rectangle a title bar drag produces. */
export function rectAfterMove(
	start: WindowRect,
	deltaX: number,
	deltaY: number,
	viewport: WindowSize,
): WindowRect {
	return keepReachable(
		{ ...start, x: start.x + deltaX, y: start.y + deltaY },
		viewport,
	);
}

/**
 * The rectangle a resize produces. The edge that is not being dragged stays
 * where it is, the window never gets smaller than its minimum, and its left
 * and top edges never pass the origin.
 */
export function rectAfterResize(
	start: WindowRect,
	edges: ResizeEdges,
	deltaX: number,
	deltaY: number,
	limits: ResizeLimits,
): WindowRect {
	const right = start.x + start.width;
	const bottom = start.y + start.height;
	let { x, y, width, height } = start;
	if (edges.x === 1) {
		const maxRight = Math.max(right, limits.maxRight ?? Number.POSITIVE_INFINITY);
		width = clamp(start.width + deltaX, limits.minWidth, maxRight - start.x);
	}
	if (edges.x === -1) {
		width = clamp(start.width - deltaX, limits.minWidth, right);
		x = right - width;
	}
	if (edges.y === 1) {
		const maxBottom = Math.max(
			bottom,
			limits.maxBottom ?? Number.POSITIVE_INFINITY,
		);
		height = clamp(start.height + deltaY, limits.minHeight, maxBottom - start.y);
	}
	if (edges.y === -1) {
		height = clamp(start.height - deltaY, limits.minHeight, bottom);
		y = bottom - height;
	}
	return { x, y, width, height };
}

/** A resize of an in-page window: bounded by the viewport and the window minimum. */
export function rectAfterViewportResize(
	start: WindowRect,
	edges: ResizeEdges,
	deltaX: number,
	deltaY: number,
	viewport: WindowSize,
	min: WindowSize = MIN_WINDOW_SIZE,
): WindowRect {
	const least = minimumIn(viewport, min);
	return rectAfterResize(start, edges, deltaX, deltaY, {
		minWidth: least.width,
		minHeight: least.height,
		maxRight: viewport.width,
		maxBottom: viewport.height,
	});
}

/** A remembered rectangle made usable in the viewport it is being opened in. */
export function fitRemembered(
	rect: WindowRect,
	viewport: WindowSize,
	min: WindowSize = MIN_WINDOW_SIZE,
): WindowRect {
	return clampToViewport(rect, viewport, min);
}

/**
 * The rectangle to draw for a window the user placed in one viewport and that
 * is now shown in another. The user's rectangle is left alone on an axis where
 * the viewport has not shrunk, so widening the browser again gives it back.
 */
export function rectForViewport(
	rect: WindowRect,
	placedIn: WindowSize,
	viewport: WindowSize,
	min: WindowSize = MIN_WINDOW_SIZE,
): WindowRect {
	const reachable = keepReachable(rect, viewport);
	const inside = clampToViewport(rect, viewport, min);
	const narrower = viewport.width < placedIn.width;
	const shorter = viewport.height < placedIn.height;
	return {
		x: narrower ? inside.x : reachable.x,
		width: narrower ? inside.width : reachable.width,
		y: shorter ? inside.y : reachable.y,
		height: shorter ? inside.height : reachable.height,
	};
}
