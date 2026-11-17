/**
 * The Bots rail's width in one row, as React state.
 */

import {
	type CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { useRememberedColumnWidth } from '../useRememberedColumnWidth';
import {
	BOTS_NARROW_WINDOW_QUERY,
	botsRailResizable,
	botsRailWidthBounds,
	drawnBotsRailWidth,
} from './botsRailWidth';

/**
 * Whether the window the row is drawn in is narrow enough for the CSS to stack
 * or hide the rail. The row's own window is asked, not this script's, so a
 * row in a popped-out window follows that window.
 */
function useNarrowWindow(view: Window | null): boolean {
	const [narrow, setNarrow] = useState(false);
	useEffect(() => {
		const query = view?.matchMedia?.(BOTS_NARROW_WINDOW_QUERY);
		if (query === undefined) {
			setNarrow(false);
			return;
		}
		const follow = () => setNarrow(query.matches);
		follow();
		query.addEventListener('change', follow);
		return () => query.removeEventListener('change', follow);
	}, [view]);
	return narrow;
}

/**
 * The rail's width in one row: the device's chosen width, a live drag over it,
 * and the row's width that bounds how it is drawn. Put `rowRef` on the element
 * that holds the main column and the rail side by side.
 */
export function useBotsRailWidth() {
	const [chosen, commit] = useRememberedColumnWidth('botsRail');
	const [preview, setPreview] = useState<number | null>(null);
	const [rowWidth, setRowWidth] = useState<number>();
	const [view, setView] = useState<Window | null>(null);
	const narrowWindow = useNarrowWindow(view);
	const observer = useRef<ResizeObserver | null>(null);
	const rowRef = useCallback((row: HTMLElement | null) => {
		observer.current?.disconnect();
		observer.current = null;
		if (row === null) return;
		const rowView = row.ownerDocument.defaultView;
		setView(rowView);
		setRowWidth(row.clientWidth || undefined);
		const View = rowView?.ResizeObserver;
		if (View === undefined) return;
		observer.current = new View(() =>
			setRowWidth(row.clientWidth || undefined),
		);
		observer.current.observe(row);
	}, []);
	return {
		rowRef,
		drawn: drawnBotsRailWidth(preview ?? chosen, rowWidth),
		bounds: botsRailWidthBounds(rowWidth),
		resizable: botsRailResizable(rowWidth, narrowWindow),
		setPreview,
		commit,
	};
}

export type BotsRailWidth = ReturnType<typeof useBotsRailWidth>;

/** The row's style that draws the rail at its width. */
export function botsRailStyle(rail: BotsRailWidth): CSSProperties {
	return { '--bots-rail-width': `${rail.drawn}px` } as CSSProperties;
}
