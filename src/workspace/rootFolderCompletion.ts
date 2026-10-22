import type { BrowseRootFoldersResult } from '@terminay/client-core';

/**
 * Completing a folder path typed into the root folder browser, the way a
 * shell completes `cd`. The parent folder the person has typed is listed
 * through the same server browse query the browser uses (ADR-0066), and its
 * directories are filtered by the last segment here, so completion adds
 * nothing to what the server answers. Everything below the completer is pure.
 */

/** A typed path as its parent folder and the start of a name inside it.
 * `null` when there is no parent to list. */
export function splitTypedFolderPath(
	typed: string,
): Readonly<{ parent: string; prefix: string }> | null {
	const index = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'));
	if (index === -1) return null;
	const head = typed.slice(0, index);
	// `/Us` lists `/`, and `C:\Us` lists `C:\`.
	const parent =
		head.length === 0 || /^[A-Za-z]:$/u.test(head) || head === '~'
			? typed.slice(0, index + 1)
			: head;
	return { parent, prefix: typed.slice(index + 1) };
}

/** The typed path up to and including its last separator. */
function typedHead(typed: string, prefix: string): string {
	return typed.slice(0, typed.length - prefix.length);
}

/** The separator the person is typing with. */
export function typedSeparator(typed: string): '/' | '\\' {
	return typed.lastIndexOf('\\') > typed.lastIndexOf('/') ? '\\' : '/';
}

const hidden = (name: string) => name.startsWith('.');

/** The listed folder names starting with `segment`, ignoring case, in the
 * order the server listed them. Hidden folders appear only once the segment
 * itself starts with `.`. */
export function visibleFolders(
	entries: BrowseRootFoldersResult['entries'],
	segment: string,
): readonly string[] {
	const start = segment.toLowerCase();
	const showHidden = hidden(segment);
	const names: string[] = [];
	for (const { name } of entries) {
		if (!showHidden && hidden(name)) continue;
		if (name.toLowerCase().startsWith(start)) names.push(name);
	}
	return names;
}

/** The longest start every name shares, ignoring case, in the first name's
 * case. */
export function longestCommonPrefix(names: readonly string[]): string {
	let prefix = names[0] ?? '';
	for (const name of names) {
		let length = 0;
		while (
			length < prefix.length &&
			length < name.length &&
			prefix[length].toLowerCase() === name[length].toLowerCase()
		)
			length += 1;
		prefix = prefix.slice(0, length);
	}
	return prefix;
}

/** Repeated Tab walking the matches when completing adds nothing more. */
export type FolderCycle = Readonly<{
	head: string;
	names: readonly string[];
	index: number;
	/** What was typed before the first Tab, for Esc. */
	original: string;
}>;

/** What the path field holds and is doing. */
export type FolderFieldState = Readonly<{
	value: string;
	/** The listed folder the arrows are on, or -1. */
	highlight: number;
	cycle: FolderCycle | null;
}>;

export function folderFieldState(value: string): FolderFieldState {
	return { value, highlight: -1, cycle: null };
}

/** The folders the browser lists for the field: the cycle's while Tab is
 * cycling, otherwise the typed parent's that match the typed segment. */
export function shownFolders(
	state: FolderFieldState,
	listing: BrowseRootFoldersResult | undefined,
): readonly string[] {
	if (state.cycle !== null) return state.cycle.names;
	const split = splitTypedFolderPath(state.value);
	if (split === null || listing === undefined) return [];
	return visibleFolders(listing.entries, split.prefix);
}

/** The listed folder now highlighted, by the arrows or by a Tab cycle. */
export function activeFolder(state: FolderFieldState): number {
	return state.cycle !== null ? state.cycle.index : state.highlight;
}

export type FolderStep =
	| Readonly<{ kind: 'state'; state: FolderFieldState }>
	| Readonly<{ kind: 'message'; message: string }>
	/** The typed parent is not listed yet; ask again once it is. */
	| Readonly<{ kind: 'pending' }>;

const step = (state: FolderFieldState): FolderStep => ({
	kind: 'state',
	state,
});

/** What Tab, or Shift+Tab when `backwards`, does to the field. */
export function tabStep(
	state: FolderFieldState,
	listing: BrowseRootFoldersResult | undefined,
	backwards = false,
): FolderStep {
	const { cycle } = state;
	if (cycle !== null) {
		const count = cycle.names.length;
		const index = (cycle.index + (backwards ? -1 : 1) + count) % count;
		return step({
			value: `${cycle.head}${cycle.names[index]}${typedSeparator(cycle.head)}`,
			highlight: -1,
			cycle: { ...cycle, index },
		});
	}
	if (state.value === '~') return step(folderFieldState('~/'));
	const split = splitTypedFolderPath(state.value);
	if (split === null) {
		return { kind: 'message', message: 'Start the path with / or ~.' };
	}
	if (listing === undefined) return { kind: 'pending' };
	const head = typedHead(state.value, split.prefix);
	const separator = typedSeparator(head);
	const names = visibleFolders(listing.entries, split.prefix);
	const highlighted = names[state.highlight];
	if (highlighted !== undefined) {
		return step(folderFieldState(`${head}${highlighted}${separator}`));
	}
	if (names.length === 0) {
		return {
			kind: 'message',
			message:
				split.prefix.length > 0
					? `Nothing in ${listing.path} starts with “${split.prefix}”.`
					: `${listing.path} holds no folders.`,
		};
	}
	if (names.length === 1) {
		return step(folderFieldState(`${head}${names[0]}${separator}`));
	}
	const common = longestCommonPrefix(names);
	if (common.length > split.prefix.length) {
		return step(folderFieldState(`${head}${common}`));
	}
	const index = backwards ? names.length - 1 : 0;
	return step({
		value: `${head}${names[index]}${separator}`,
		highlight: -1,
		cycle: { head, names, index, original: state.value },
	});
}

/** The arrows move the highlight round the listed folders. */
export function moveHighlight(
	state: FolderFieldState,
	count: number,
	delta: 1 | -1,
): FolderFieldState {
	if (count === 0) return state;
	const from = state.highlight;
	const highlight =
		from < 0 ? (delta > 0 ? 0 : count - 1) : (from + delta + count) % count;
	return { ...state, highlight };
}

/** The text Tab would add after the caret, shown subdued. */
export function ghostText(
	state: FolderFieldState,
	listing: BrowseRootFoldersResult | undefined,
): string {
	if (state.cycle !== null) return '';
	const split = splitTypedFolderPath(state.value);
	if (split === null || listing === undefined) return '';
	const separator = typedSeparator(state.value);
	const names = visibleFolders(listing.entries, split.prefix);
	const typedLength = split.prefix.length;
	const highlighted = names[state.highlight];
	if (highlighted !== undefined) {
		return `${highlighted.slice(typedLength)}${separator}`;
	}
	if (typedLength === 0 || names.length === 0) return '';
	if (names.length === 1) return `${names[0].slice(typedLength)}${separator}`;
	return longestCommonPrefix(names).slice(typedLength);
}

/** The path → takes: the highlighted folder or the ghost text. `null` when
 * there is nothing to take. */
export function acceptStep(
	state: FolderFieldState,
	listing: BrowseRootFoldersResult | undefined,
): FolderFieldState | null {
	if (state.highlight >= 0) {
		const next = tabStep(state, listing);
		return next.kind === 'state' ? next.state : null;
	}
	const ghost = ghostText(state, listing);
	return ghost.length > 0 ? folderFieldState(`${state.value}${ghost}`) : null;
}

/**
 * The typed path Enter would choose: the highlighted folder, else the folder
 * the field names, else the only folder its segment matches. In a truncated
 * listing an unlisted name is taken as typed, for the server to check.
 */
export function openTarget(
	state: FolderFieldState,
	listing: BrowseRootFoldersResult | undefined,
): string | null {
	if (state.cycle !== null) return state.value;
	const split = splitTypedFolderPath(state.value);
	if (split === null || listing === undefined) return null;
	const head = typedHead(state.value, split.prefix);
	const names = visibleFolders(listing.entries, split.prefix);
	const highlighted = names[state.highlight];
	if (highlighted !== undefined) return `${head}${highlighted}`;
	if (split.prefix.length === 0) return state.value;
	const typed = split.prefix.toLowerCase();
	const exact = names.find((name) => name.toLowerCase() === typed);
	if (exact !== undefined) return `${head}${exact}`;
	if (names.length === 1) return `${head}${names[0]}`;
	if (names.length === 0 && listing.truncated) return state.value;
	return null;
}

/** The field without its last path segment. `parent` is where to go when no
 * separator is left to cut back to, such as from `~/`. */
export function deleteSegment(value: string, parent?: string): string {
	const trimmed = /^(?:[\\/]|[A-Za-z]:[\\/])$/u.test(value)
		? value
		: value.replace(/[\\/]$/u, '');
	const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (cut >= 0) return trimmed.slice(0, cut + 1);
	if (parent === undefined) return value;
	return `${parent}${parent.endsWith(typedSeparator(parent)) ? '' : typedSeparator(parent)}`;
}

/** The field moved to the parent of the folder it is in. */
export function parentValue(value: string, parent?: string): string {
	const split = splitTypedFolderPath(value);
	if (split === null || split.prefix.length === 0)
		return deleteSegment(value, parent);
	return deleteSegment(typedHead(value, split.prefix), parent);
}

/** What the folder browser's path field does with a key. */
export type FolderFieldKey =
	| 'complete'
	| 'complete-back'
	| 'next'
	| 'previous'
	| 'accept'
	| 'open'
	| 'escape'
	| 'delete-segment'
	| 'parent';

export function folderFieldKey(
	event: Readonly<{
		key: string;
		shiftKey: boolean;
		altKey: boolean;
		ctrlKey: boolean;
		metaKey: boolean;
	}>,
	mac: boolean,
): FolderFieldKey | null {
	const { key } = event;
	if (key === 'Tab') return event.shiftKey ? 'complete-back' : 'complete';
	if (key === 'ArrowUp' && (mac ? event.metaKey : event.altKey))
		return 'parent';
	if (event.metaKey || event.altKey || event.ctrlKey) {
		if (key === 'Backspace' && (mac ? event.altKey : event.ctrlKey))
			return 'delete-segment';
		// ⌃W is the shell's word delete on macOS; elsewhere Ctrl+W is the
		// app's close shortcut, and Ctrl+Backspace deletes instead.
		if (key === 'w' && mac && event.ctrlKey && !event.metaKey && !event.altKey)
			return 'delete-segment';
		return null;
	}
	if (key === 'ArrowDown') return 'next';
	if (key === 'ArrowUp') return 'previous';
	if (key === 'ArrowRight' && !event.shiftKey) return 'accept';
	if (key === 'Enter') return 'open';
	if (key === 'Escape') return 'escape';
	return null;
}

/** How long typing pauses before the typed parent is listed. */
const LIST_DELAY_MS = 150;
/** How many listed parents are kept, so going back is immediate. */
const REMEMBERED_PARENTS = 16;

export type ParentListing =
	| Readonly<{ state: 'loading' }>
	| Readonly<{ state: 'ready'; folder: BrowseRootFoldersResult }>
	| Readonly<{ state: 'error'; message: string }>;

/**
 * Lists the parent of the typed path once the person pauses, or at once when
 * a key needs it. Only an answer for the parent typed now changes anything on
 * screen; an answer for a parent already left is kept for later. Answers are
 * remembered, so moving within or back to a listed folder asks for nothing,
 * and a parent already being listed is not asked for twice.
 */
export class RootFolderCompleter {
	private disposed = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private current: string | undefined;
	private readonly asking = new Set<string>();
	private readonly listed = new Map<string, ParentListing>();

	private readonly browse: (path?: string) => Promise<BrowseRootFoldersResult>;
	private readonly onChange: () => void;
	private readonly errorMessage: (error: unknown) => string;
	private readonly delayMs: number;

	constructor(
		browse: (path?: string) => Promise<BrowseRootFoldersResult>,
		onChange: () => void,
		errorMessage: (error: unknown) => string,
		delayMs = LIST_DELAY_MS,
	) {
		this.browse = browse;
		this.onChange = onChange;
		this.errorMessage = errorMessage;
		this.delayMs = delayMs;
	}

	/** The typed path's parent as listed so far; `undefined` when the path
	 * names no parent. */
	listingFor(typed: string): ParentListing | undefined {
		const split = splitTypedFolderPath(typed);
		if (split === null) return undefined;
		return this.listed.get(split.parent) ?? { state: 'loading' };
	}

	/** Remember a listing already in hand, such as the home folder. */
	remember(parent: string, folder: BrowseRootFoldersResult): void {
		this.store(parent, { state: 'ready', folder });
	}

	/** List the parent of this typed path after the pause. */
	update(typed: string): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		const parent = splitTypedFolderPath(typed)?.parent;
		this.current = parent;
		if (
			parent === undefined ||
			this.listed.has(parent) ||
			this.asking.has(parent)
		) {
			return;
		}
		this.timer = setTimeout(() => this.flush(), this.delayMs);
	}

	/** List the parent typed now without waiting for the pause. */
	flush(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		const parent = this.current;
		if (
			parent === undefined ||
			this.listed.has(parent) ||
			this.asking.has(parent)
		) {
			return;
		}
		this.asking.add(parent);
		this.browse(parent).then(
			(folder) => this.land(parent, { state: 'ready', folder }),
			(error) =>
				this.land(parent, {
					state: 'error',
					message: this.errorMessage(error),
				}),
		);
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.timer);
	}

	private land(parent: string, listing: ParentListing): void {
		this.asking.delete(parent);
		if (this.disposed) return;
		this.store(parent, listing);
		if (parent === this.current) this.onChange();
	}

	private store(parent: string, listing: ParentListing): void {
		this.listed.delete(parent);
		this.listed.set(parent, listing);
		while (this.listed.size > REMEMBERED_PARENTS) {
			const oldest = this.listed.keys().next().value;
			if (oldest === undefined) break;
			this.listed.delete(oldest);
		}
	}
}
