/** Compact project bars match the existing 640px mobile chrome breakpoint. */
export const PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH = 640;

/** Matches `.project-tab` min-width when a tab has not been measured yet. */
export const PROJECT_TAB_OVERFLOW_ESTIMATED_WIDTH = 160;

/** Local-matching switcher pill when it has not been measured yet. */
export const PROJECT_TAB_OVERFLOW_SWITCHER_ESTIMATED_WIDTH = 120;

/** How far the overflow switcher overlaps the last visible tab. */
export const PROJECT_TAB_OVERFLOW_FADE_WIDTH = 96;

export type ProjectTabOverflowItem = {
	id: string;
	width: number;
};

export type ProjectTabOverflowInput = {
	activeId: string | null;
	availableWidth: number;
	compact: boolean;
	items: readonly ProjectTabOverflowItem[];
	/** How far the switcher pill overlaps the strip; the next tab peeks under it. */
	overlapWidth?: number;
};

export type ProjectTabOverflowResult = {
	hiddenIds: string[];
	layout: 'compact' | 'tabs';
	visibleIds: string[];
};

export function isProjectTabBarCompact(tabBarWidth: number): boolean {
	return (
		tabBarWidth > 0 && tabBarWidth <= PROJECT_TAB_OVERFLOW_COMPACT_MAX_WIDTH
	);
}

/** Width left for visible project tabs after sidebar, + control, and Local. */
export function projectTabStripAvailableWidth(
	tabBarWidth: number,
	reservedWidth: number,
): number {
	if (tabBarWidth <= 0) return 0;
	return Math.max(0, tabBarWidth - Math.max(0, reservedWidth));
}

function hideFromEnd(
	items: readonly ProjectTabOverflowItem[],
	activeId: string | null,
	availableWidth: number,
): Set<string> {
	const hidden = new Set<string>();
	let used = items.reduce((sum, item) => sum + item.width, 0);
	const hide = (item: ProjectTabOverflowItem) => {
		if (hidden.has(item.id)) return false;
		if (item.id === activeId && hidden.size < items.length - 1) return false;
		if (items.length - hidden.size <= 1) return false;
		hidden.add(item.id);
		used -= item.width;
		return true;
	};

	for (
		let index = items.length - 1;
		index >= 0 && used > availableWidth + 0.5;
		index -= 1
	) {
		const item = items[index];
		if (item) hide(item);
	}
	for (
		let index = 0;
		index < items.length && used > availableWidth + 0.5;
		index += 1
	) {
		const item = items[index];
		if (item) hide(item);
	}
	return hidden;
}

/** Keep the next overflowed tab in the strip so it continues behind the pill. */
function peekNextHiddenTab(
	items: readonly ProjectTabOverflowItem[],
	hidden: Set<string>,
): void {
	if (hidden.size <= 1) return;
	for (const item of items) {
		if (hidden.has(item.id)) {
			hidden.delete(item.id);
			return;
		}
	}
}

export function fitProjectTabOverflow(
	input: ProjectTabOverflowInput,
): ProjectTabOverflowResult {
	const ids = input.items.map((item) => item.id);
	if (input.items.length === 0) {
		return {
			hiddenIds: [],
			layout: input.compact ? 'compact' : 'tabs',
			visibleIds: [],
		};
	}
	if (input.compact) {
		return { hiddenIds: ids, layout: 'compact', visibleIds: [] };
	}

	const total = input.items.reduce((sum, item) => sum + item.width, 0);
	if (total <= input.availableWidth + 0.5) {
		return { hiddenIds: [], layout: 'tabs', visibleIds: ids };
	}

	const overlap =
		input.overlapWidth ?? PROJECT_TAB_OVERFLOW_FADE_WIDTH;
	const hidden = hideFromEnd(
		input.items,
		input.activeId,
		Math.max(0, input.availableWidth - overlap),
	);
	peekNextHiddenTab(input.items, hidden);
	return {
		hiddenIds: ids.filter((id) => hidden.has(id)),
		layout: 'tabs',
		visibleIds: ids.filter((id) => !hidden.has(id)),
	};
}

export function sameIdList(
	left: readonly string[],
	right: readonly string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((id, index) => id === right[index])
	);
}

export function mergeVisibleProjectReorder<T extends { id: string }>(
	items: readonly T[],
	visibleOrder: readonly T[],
	hiddenIds: readonly string[],
): T[] {
	const hidden = new Set(hiddenIds);
	const queue = visibleOrder.filter((item) => !hidden.has(item.id));
	return items.map((item) => {
		if (hidden.has(item.id)) return item;
		return queue.shift() ?? item;
	});
}

export function mergeVisibleProjectReorderByIds<T extends { id: string }>(
	items: readonly T[],
	visibleIds: readonly string[],
	hiddenIds: readonly string[],
): T[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	return mergeVisibleProjectReorder(
		items,
		visibleIds.flatMap((id) => {
			const item = byId.get(id);
			return item === undefined ? [] : [item];
		}),
		hiddenIds,
	);
}

/** Place `draggedId` among visible tabs by comparing the pointer to each other
 * tab's center. Overflowed tabs are not in `visibleIds` and stay put. */
export function insertVisibleIdByClientX(
	visibleIds: readonly string[],
	centers: ReadonlyArray<{ id: string; center: number }>,
	draggedId: string,
	clientX: number,
): string[] {
	if (!visibleIds.includes(draggedId)) return [...visibleIds];
	const rest = visibleIds.filter((id) => id !== draggedId);
	const centerById = new Map(centers.map((entry) => [entry.id, entry.center]));
	let insertAt = rest.length;
	for (let index = 0; index < rest.length; index += 1) {
		const id = rest[index];
		if (id === undefined) continue;
		const center = centerById.get(id);
		if (center !== undefined && clientX < center) {
			insertAt = index;
			break;
		}
	}
	const next = rest.slice();
	next.splice(insertAt, 0, draggedId);
	return next;
}

export function moveItemByDrop<T extends { id: string }>(
	items: readonly T[],
	sourceId: string,
	targetId: string,
	position: 'before' | 'after',
): T[] {
	if (sourceId === targetId) return [...items];
	const from = items.findIndex((item) => item.id === sourceId);
	if (from < 0) return [...items];
	const next = items.slice();
	const [moved] = next.splice(from, 1);
	if (moved === undefined) return [...items];
	const insertion = next.findIndex((item) => item.id === targetId);
	if (insertion < 0) return [...items];
	next.splice(insertion + (position === 'after' ? 1 : 0), 0, moved);
	return next;
}
