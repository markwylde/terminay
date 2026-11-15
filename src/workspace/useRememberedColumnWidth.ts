import { useCallback, useEffect, useState } from 'react';
import {
	COLUMN_WIDTHS_STORAGE_KEY,
	parseColumnWidths,
	type ResizableColumn,
	recallColumnWidth,
	rememberColumnWidth,
} from './localViewState';

/** Every reader of a column in this window, told when one of them commits. */
const readers = new Map<ResizableColumn, Set<(width: number) => void>>();

/**
 * One column's width on this device, and the commit that changes it.
 *
 * Every project in the window reads the same value, so committing a resize in
 * one resizes the column in all of them. Other readers of the column in this
 * window take the new width at once; another window on this device that
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
		let columnReaders = readers.get(column);
		if (columnReaders === undefined) {
			columnReaders = new Set();
			readers.set(column, columnReaders);
		}
		columnReaders.add(setWidth);
		globalThis.addEventListener?.('storage', follow);
		return () => {
			columnReaders.delete(setWidth);
			globalThis.removeEventListener?.('storage', follow);
		};
	}, [column]);

	const commit = useCallback(
		(next: number) => {
			rememberColumnWidth(column, next);
			const rounded = Math.round(next);
			for (const reader of readers.get(column) ?? []) reader(rounded);
		},
		[column],
	);

	return [width, commit] as const;
}
