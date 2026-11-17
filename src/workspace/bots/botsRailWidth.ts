/**
 * The width of the rail on the right of the Bots section and of a bot tab's
 * Chat mode. One width is chosen on the device for both; each row draws it
 * within the room it has.
 */

export const BOTS_RAIL_MIN_WIDTH = 240;
export const BOTS_RAIL_MAX_WIDTH = 560;
/** The narrowest the column beside the rail is drawn while there is room. */
export const BOTS_MAIN_MIN_WIDTH = 420;
export const BOTS_RAIL_RESIZE_STEP = 16;
/** At this window width or less the CSS stacks the overview rail and hides Chat's. */
export const BOTS_NARROW_WINDOW_QUERY = '(max-width: 860px)';

/**
 * The widths the rail can be drawn at in a row this wide. The column beside it
 * keeps its minimum first; the rail never goes below its own. An unmeasured
 * row (`undefined`) bounds the rail by its own limits only.
 */
export function botsRailWidthBounds(rowWidth: number | undefined): {
	min: number;
	max: number;
} {
	const room =
		rowWidth === undefined
			? BOTS_RAIL_MAX_WIDTH
			: rowWidth - BOTS_MAIN_MIN_WIDTH;
	return {
		min: BOTS_RAIL_MIN_WIDTH,
		max: Math.max(
			BOTS_RAIL_MIN_WIDTH,
			Math.min(BOTS_RAIL_MAX_WIDTH, Math.floor(room)),
		),
	};
}

/** The chosen width as drawn in a row this wide, in whole pixels. */
export function drawnBotsRailWidth(
	chosen: number,
	rowWidth: number | undefined,
): number {
	const { min, max } = botsRailWidthBounds(rowWidth);
	return Math.min(max, Math.max(min, Math.round(chosen)));
}

/**
 * Whether the rail offers a separator: not in a narrow window, where it is
 * stacked or hidden, and not in a row with no room to give it more than its
 * minimum.
 */
export function botsRailResizable(
	rowWidth: number | undefined,
	narrowWindow: boolean,
): boolean {
	if (narrowWindow) return false;
	const { min, max } = botsRailWidthBounds(rowWidth);
	return max > min;
}
