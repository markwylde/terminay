import { useCallback, useEffect, useState } from 'react';
import {
	COLUMN_WIDTHS_STORAGE_KEY,
	parseColumnWidths,
	type ResizableColumn,
	recallColumnWidth,
	rememberColumnWidth,
} from './localViewState';

/**
 * One column's width on this device, and the commit that changes it.
 *
 * Every project in the window reads the same value, so committing a resize in
 * one resizes the column in all of them. Another window on this device that
 * resizes the column is followed through the `storage` event, which only ever
 * reads: following never writes back.
 */
export function useRememberedColumnWidth(
	column: ResizableColumn,
): readonly [number, (width: number) => void] {
	const [width, setWidth] = useState(() => recallColumnWidth(column));

	useEffect(() => {
		const follow = (event: StorageEvent) => {
			if (event.key !== COLUMN_WIDTHS_STORAGE_KEY) return;
			const next = parseColumnWidths(event.newValue)[column];
			if (next !== undefined) setWidth(next);
		};
		globalThis.addEventListener?.('storage', follow);
		return () => globalThis.removeEventListener?.('storage', follow);
	}, [column]);

	const commit = useCallback(
		(next: number) => {
			setWidth(Math.round(next));
			rememberColumnWidth(column, next);
		},
		[column],
	);

	return [width, commit] as const;
}
