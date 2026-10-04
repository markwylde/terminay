/**
 * Where a terminal's app windows sit inside its pane.
 *
 * Pure geometry, so the rules can be tested without a browser: an open window
 * floats at the bottom-left at its content height, capped at 60% of the pane; on
 * a narrow pane it is a sheet across the bottom; a minimised window is a tab on
 * the bottom edge, inside a rail that exists only while there is a tab.
 */

/** A pane narrower than this is treated as a phone. */
export const NARROW_PANE_WIDTH = 560;
export const WINDOW_MAX_WIDTH = 440;
export const WINDOW_MAX_HEIGHT_FRACTION = 0.6;
export const WINDOW_EDGE = 12;
export const WINDOW_HEADER_HEIGHT = 32;
export const WINDOW_HEADER_HEIGHT_NARROW = 40;
export const TAB_HEIGHT = 28;
export const TAB_HEIGHT_NARROW = 34;
export const TAB_GAP = 6;
export const TAB_MAX_WIDTH = 260;
const RAIL_PADDING = 5;
/** Content height assumed until a view reports its own. */
const DEFAULT_CONTENT_HEIGHT = 180;
const MIN_BODY_HEIGHT = 80;

export interface LayoutWindow {
	readonly id: string;
	readonly state: 'open' | 'minimised';
	/** The height the view last reported for its content. */
	readonly contentHeight?: number;
	/** Where the user dragged this tab along the edge, from the pane's left. */
	readonly tabOffset?: number;
	/** The tab's natural width for its title. */
	readonly tabWidth: number;
}

export interface WindowRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export type WindowPlacement = 'window' | 'sheet' | 'fullscreen' | 'tab' | 'hidden';

export interface PlacedWindow {
	readonly id: string;
	readonly placement: WindowPlacement;
	readonly rect: WindowRect;
	/** The view's body: its width, and its fixed height or the most it may be. */
	readonly bodyWidth: number;
	readonly bodyHeight?: number;
	readonly bodyMaxHeight?: number;
}

export interface WindowLayout {
	readonly narrow: boolean;
	/** Height the pane reserves under the terminal for tabs; 0 when none. */
	readonly railHeight: number;
	readonly windows: readonly PlacedWindow[];
}

export interface WindowLayoutInput {
	readonly paneWidth: number;
	readonly paneHeight: number;
	/** In creation order. */
	readonly windows: readonly LayoutWindow[];
	/** A window the user asked to fill the pane. */
	readonly fullscreenId?: string;
}

const clamp = (value: number, low: number, high: number): number =>
	Math.min(Math.max(value, low), Math.max(low, high));

/** Rail height for a pane with at least one minimised window. */
export function railHeightFor(narrow: boolean): number {
	return (narrow ? TAB_HEIGHT_NARROW : TAB_HEIGHT) + RAIL_PADDING;
}

export function layoutAppWindows(input: WindowLayoutInput): WindowLayout {
	const { paneWidth, paneHeight } = input;
	const narrow = paneWidth < NARROW_PANE_WIDTH;
	const header = narrow ? WINDOW_HEADER_HEIGHT_NARROW : WINDOW_HEADER_HEIGHT;
	const fullscreen = input.windows.find(
		(window) => window.id === input.fullscreenId && window.state === 'open',
	);
	const tabs = input.windows.filter((window) => window.state === 'minimised');
	// The rail takes its rows only while a tab exists, and never under a window
	// that fills the pane.
	const railHeight =
		tabs.length > 0 && fullscreen === undefined ? railHeightFor(narrow) : 0;
	const tabHeight = narrow ? TAB_HEIGHT_NARROW : TAB_HEIGHT;
	const maxBody = Math.max(
		MIN_BODY_HEIGHT,
		Math.floor(paneHeight * WINDOW_MAX_HEIGHT_FRACTION) - header,
	);

	let nextTabX = WINDOW_EDGE + 4;
	const windows = input.windows.map((window): PlacedWindow => {
		if (fullscreen !== undefined) {
			if (window.id !== fullscreen.id)
				return hidden(window.id, paneWidth, paneHeight);
			return {
				id: window.id,
				placement: 'fullscreen',
				rect: { x: 0, y: 0, width: paneWidth, height: paneHeight },
				bodyWidth: paneWidth,
				bodyHeight: Math.max(0, paneHeight - header),
			};
		}
		if (window.state === 'minimised') {
			const width = clamp(window.tabWidth, 48, Math.min(TAB_MAX_WIDTH, paneWidth - WINDOW_EDGE * 2));
			const natural = nextTabX;
			nextTabX += width + TAB_GAP;
			return {
				id: window.id,
				placement: 'tab',
				rect: {
					// A tab slides along the bottom edge and never leaves it.
					x: clamp(window.tabOffset ?? natural, WINDOW_EDGE, paneWidth - width - WINDOW_EDGE),
					y: paneHeight - tabHeight,
					width,
					height: tabHeight,
				},
				bodyWidth: width,
			};
		}
		const height =
			header + Math.min(window.contentHeight ?? DEFAULT_CONTENT_HEIGHT, maxBody);
		if (narrow)
			return {
				id: window.id,
				placement: 'sheet',
				rect: { x: 0, y: paneHeight - railHeight - height, width: paneWidth, height },
				bodyWidth: paneWidth,
				bodyMaxHeight: maxBody,
			};
		const width = Math.min(WINDOW_MAX_WIDTH, paneWidth - WINDOW_EDGE * 2);
		return {
			id: window.id,
			placement: 'window',
			rect: {
				x: WINDOW_EDGE,
				y: Math.max(WINDOW_EDGE, paneHeight - railHeight - WINDOW_EDGE - height),
				width,
				height,
			},
			bodyWidth: width,
			bodyMaxHeight: maxBody,
		};
	});
	return { narrow, railHeight, windows };
}

function hidden(id: string, paneWidth: number, paneHeight: number): PlacedWindow {
	// A hidden view keeps a realistic size so it can still measure its content.
	const width = Math.min(WINDOW_MAX_WIDTH, Math.max(0, paneWidth - WINDOW_EDGE * 2));
	return {
		id,
		placement: 'hidden',
		rect: { x: 0, y: 0, width, height: Math.floor(paneHeight * WINDOW_MAX_HEIGHT_FRACTION) },
		bodyWidth: width,
	};
}

/** The tab offset a drag produces: along the edge only, clamped to the pane. */
export function tabOffsetAfterDrag(
	startOffset: number,
	deltaX: number,
	tabWidth: number,
	paneWidth: number,
): number {
	return clamp(startOffset + deltaX, WINDOW_EDGE, paneWidth - tabWidth - WINDOW_EDGE);
}
