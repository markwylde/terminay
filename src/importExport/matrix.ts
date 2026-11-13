/**
 * The sync matrix: one row per item key, one column per attached server (or
 * imported bundle), each cell stating how that column's copy compares with
 * the source column's.
 */

import type { ColumnSnapshot } from './kinds.ts';
import {
	fingerprint,
	ITEM_KINDS,
	itemKey,
	type ItemKind,
	type ServerItem,
} from './model.ts';

export type MatrixColumn = Readonly<{
	id: string;
	label: string;
	/** A bundle column is a source only. */
	readOnly: boolean;
	/** Ready to read and write; otherwise `phase` says why not. */
	ready: boolean;
	phase?: string;
	/** A remembered server that is not attached; it can be attached. */
	attachable?: boolean;
	snapshot?: ColumnSnapshot;
}>;

export type CellState =
	| 'same'
	| 'differs'
	| 'missing'
	| 'present'
	| 'duplicate'
	| 'unsupported'
	| 'denied'
	| 'notReady';

export type MatrixCell = Readonly<{
	state: CellState;
	items: readonly ServerItem[];
}>;

export type MatrixRow = Readonly<{
	key: string;
	kind: ItemKind;
	name: string;
	cells: Readonly<Record<string, MatrixCell>>;
	/** The single source item, when the row can be copied from the source. */
	sourceItem?: ServerItem;
}>;

export const CELL_STATE_TEXT: Readonly<Record<CellState, { glyph: string; word: string }>> =
	Object.freeze({
		same: { glyph: '●', word: 'same' },
		differs: { glyph: '◐', word: 'differs' },
		missing: { glyph: '○', word: 'missing' },
		present: { glyph: '●', word: 'present' },
		duplicate: { glyph: '◆', word: 'duplicate name' },
		unsupported: { glyph: '–', word: 'not supported' },
		denied: { glyph: '⊘', word: 'not permitted' },
		notReady: { glyph: '…', word: 'not ready' },
	});

/** A column's items of one kind, by key; undefined when it cannot serve them. */
function itemsByKey(
	column: MatrixColumn,
	kind: ItemKind,
): Readonly<{ state: CellState | 'ok'; byKey: Map<string, ServerItem[]> }> {
	const byKey = new Map<string, ServerItem[]>();
	if (!column.ready || column.snapshot === undefined) return { state: 'notReady', byKey };
	const snapshot = column.snapshot[kind];
	if (snapshot.state !== 'ok')
		return {
			state:
				snapshot.state === 'unsupported'
					? 'unsupported'
					: snapshot.state === 'denied'
						? 'denied'
						: 'notReady',
			byKey,
		};
	for (const item of snapshot.items) {
		const key = itemKey(item.portable.kind, item.portable.name);
		const list = byKey.get(key) ?? [];
		list.push(item);
		byKey.set(key, list);
	}
	return { state: 'ok', byKey };
}

export function buildMatrix(
	columns: readonly MatrixColumn[],
	sourceId: string | undefined,
): MatrixRow[] {
	const rows: MatrixRow[] = [];
	for (const kind of ITEM_KINDS) {
		const perColumn = new Map(columns.map((column) => [column.id, itemsByKey(column, kind)]));
		const keys = new Map<string, string>();
		// Names come from the source first, then the other columns in order.
		const ordered = [
			...columns.filter((column) => column.id === sourceId),
			...columns.filter((column) => column.id !== sourceId),
		];
		for (const column of ordered) {
			for (const [key, items] of perColumn.get(column.id)!.byKey) {
				if (!keys.has(key)) keys.set(key, items[0].portable.name.trim());
			}
		}
		const sortedKeys = [...keys.keys()].sort((a, b) =>
			keys.get(a)!.localeCompare(keys.get(b)!, 'en', { sensitivity: 'base' }),
		);
		for (const key of sortedKeys) {
			const source = sourceId === undefined ? undefined : perColumn.get(sourceId);
			const sourceItems = source?.state === 'ok' ? (source.byKey.get(key) ?? []) : [];
			const sourceItem = sourceItems.length === 1 ? sourceItems[0] : undefined;
			const sourceFingerprint = sourceItem ? fingerprint(sourceItem.portable) : undefined;
			const cells: Record<string, MatrixCell> = {};
			for (const column of columns) {
				const data = perColumn.get(column.id)!;
				if (data.state !== 'ok') {
					cells[column.id] = { state: data.state, items: [] };
					continue;
				}
				const items = data.byKey.get(key) ?? [];
				let state: CellState;
				if (items.length > 1) state = 'duplicate';
				else if (items.length === 0) state = 'missing';
				else if (column.id === sourceId || sourceFingerprint === undefined) state = 'present';
				else state = fingerprint(items[0].portable) === sourceFingerprint ? 'same' : 'differs';
				cells[column.id] = { state, items };
			}
			rows.push({
				key,
				kind,
				name: keys.get(key)!,
				cells,
				...(sourceItem && !sourceItem.dangling ? { sourceItem } : {}),
			});
		}
	}
	return rows;
}

export type MatrixFilter = Readonly<{
	kinds: ReadonlySet<ItemKind>;
	text: string;
	onlyDifferences: boolean;
}>;

/** True when every comparable column holds the same copy as the source. */
export function rowIsSameEverywhere(row: MatrixRow, sourceId: string | undefined): boolean {
	let compared = false;
	for (const [columnId, cell] of Object.entries(row.cells)) {
		if (columnId === sourceId) {
			if (cell.state !== 'present') return false;
			continue;
		}
		if (cell.state === 'notReady' || cell.state === 'unsupported' || cell.state === 'denied')
			continue;
		if (cell.state !== 'same') return false;
		compared = true;
	}
	return compared;
}

export function filterRows(
	rows: readonly MatrixRow[],
	filter: MatrixFilter,
	sourceId: string | undefined,
): MatrixRow[] {
	const needle = filter.text.trim().toLocaleLowerCase('en-US');
	return rows.filter(
		(row) =>
			(filter.kinds.size === 0 || filter.kinds.has(row.kind)) &&
			(needle === '' || row.name.toLocaleLowerCase('en-US').includes(needle)) &&
			(!filter.onlyDifferences || !rowIsSameEverywhere(row, sourceId)),
	);
}

export function kindCounts(rows: readonly MatrixRow[]): Record<ItemKind, number> {
	const counts = Object.fromEntries(ITEM_KINDS.map((kind) => [kind, 0])) as Record<
		ItemKind,
		number
	>;
	for (const row of rows) counts[row.kind] += 1;
	return counts;
}

/** Whether a column can be the source or a target for one row. */
export function cellIsUsable(cell: MatrixCell | undefined): boolean {
	return (
		cell !== undefined &&
		cell.state !== 'notReady' &&
		cell.state !== 'unsupported' &&
		cell.state !== 'denied'
	);
}

// ---------------------------------------------------------------------------
// Choosing the source.

export function defaultSourceId(
	columns: readonly MatrixColumn[],
	activeServerId: string | undefined,
	primaryId: string | undefined,
): string | undefined {
	const usable = columns.filter((column) => column.ready && !column.readOnly);
	return (
		usable.find((column) => column.id === activeServerId)?.id ??
		usable.find((column) => column.id === primaryId)?.id ??
		usable[0]?.id
	);
}

/** Rows that stay selected after the matrix changes: only those still copyable. */
export function retainSelection(
	selected: ReadonlySet<string>,
	rows: readonly MatrixRow[],
): Set<string> {
	const copyable = new Set(rows.filter((row) => row.sourceItem).map((row) => row.key));
	return new Set([...selected].filter((key) => copyable.has(key)));
}

/** A review stays valid only while its source and targets stay ready. */
export function reviewStillValid(
	columns: readonly MatrixColumn[],
	sourceId: string,
	targetIds: readonly string[],
): boolean {
	const ready = new Set(columns.filter((column) => column.ready).map((column) => column.id));
	return ready.has(sourceId) && targetIds.every((id) => ready.has(id));
}
