/**
 * The pure part of a compact section page: status tab counts and the tokens
 * for applied View options. Kept apart from the components so both are
 * testable without a renderer.
 */

export type CompactTab<K extends string = string> = Readonly<{
	id: K;
	label: string;
	count?: number;
	/** The tab's rows need the user; a count above zero is marked. */
	attention?: boolean;
}>;

/**
 * Builds the tabs for a list. `rows` is the list with every filter applied
 * except the tab itself; each tab's `test` says whether a row belongs to it,
 * and a tab without one is All.
 */
export function countTabs<K extends string, Row>(
	rows: readonly Row[],
	tabs: readonly Readonly<{
		id: K;
		label: string;
		attention?: boolean;
		test?: (row: Row) => boolean;
	}>[],
): CompactTab<K>[] {
	return tabs.map(({ id, label, attention, test }) => ({
		id,
		label,
		attention,
		count: test === undefined ? rows.length : rows.filter(test).length,
	}));
}

/** The rows a tab shows, from the same list `countTabs` counted. */
export function rowsForTab<K extends string, Row>(
	rows: readonly Row[],
	tabs: readonly Readonly<{ id: K; test?: (row: Row) => boolean }>[],
	selected: K,
): Row[] {
	const test = tabs.find((tab) => tab.id === selected)?.test;
	return test === undefined ? [...rows] : rows.filter(test);
}

export type AppliedOption = Readonly<{
	id: string;
	label: string;
	reset: () => void;
}>;

/**
 * The applied-options row: one token per option that hides rows, and a Clear
 * that resets them all. Undefined when nothing is applied, so the page draws
 * no row and View options carries no marker.
 */
export function appliedOptions(options: readonly (AppliedOption | false | null | undefined)[]):
	| Readonly<{ tokens: AppliedOption[]; clear: () => void }>
	| undefined {
	const tokens = options.filter((option): option is AppliedOption => Boolean(option));
	if (tokens.length === 0) return undefined;
	return {
		tokens,
		clear: () => {
			for (const token of tokens) token.reset();
		},
	};
}

/** The View options control's accessible name. */
export function viewOptionsLabel(isApplied: boolean): string {
	return isApplied ? 'View options, filters applied' : 'View options';
}
