import type { BrowseRootFoldersResult } from '@terminay/client-core';
import { childFolderPath } from './projectStart.ts';

/**
 * Completing a folder path typed into the root folder browser. The parent
 * folder the person has typed is listed through the same server browse query
 * the browser uses, and its directories are filtered by the last segment here,
 * so completion adds nothing to what the server answers.
 */

/** The most suggestions shown at once. */
export const MAX_FOLDER_SUGGESTIONS = 8;

export type FolderSuggestion = Readonly<{ name: string; path: string }>;

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

/** The directories of the listed parent whose names start with `prefix`,
 * ignoring case, in the order the server listed them. */
export function folderSuggestions(
	folder: BrowseRootFoldersResult,
	prefix: string,
	limit = MAX_FOLDER_SUGGESTIONS,
): readonly FolderSuggestion[] {
	const start = prefix.toLowerCase();
	const suggestions: FolderSuggestion[] = [];
	for (const entry of folder.entries) {
		if (!entry.name.toLowerCase().startsWith(start)) continue;
		suggestions.push({
			name: entry.name,
			path: childFolderPath(folder.path, entry.name),
		});
		if (suggestions.length === limit) break;
	}
	return suggestions;
}

/** Where a key moves the highlighted suggestion, or `null` when the key is
 * not a move. `-1` is no highlight. */
export function suggestionHighlightMove(
	key: string,
	index: number,
	count: number,
): number | null {
	if (count === 0) return null;
	if (key === 'ArrowDown') return index + 1 >= count ? 0 : index + 1;
	if (key === 'ArrowUp') return index <= 0 ? count - 1 : index - 1;
	return null;
}

/**
 * Asks the server for the typed parent once the person pauses. Only the
 * newest request may land, and the last parent listed is kept, so typing
 * within one folder asks for nothing more.
 */
export class RootFolderCompleter {
	private request = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private listed: BrowseRootFoldersResult | undefined;
	private listedParent: string | undefined;

	private readonly browse: (path?: string) => Promise<BrowseRootFoldersResult>;
	private readonly onChange: (suggestions: readonly FolderSuggestion[]) => void;
	private readonly delayMs: number;

	constructor(
		browse: (path?: string) => Promise<BrowseRootFoldersResult>,
		onChange: (suggestions: readonly FolderSuggestion[]) => void,
		delayMs = 150,
	) {
		this.browse = browse;
		this.onChange = onChange;
		this.delayMs = delayMs;
	}

	/** Suggest for this typed path. */
	update(typed: string): void {
		const request = ++this.request;
		clearTimeout(this.timer);
		const split = splitTypedFolderPath(typed);
		if (split === null) {
			this.onChange([]);
			return;
		}
		if (this.listedParent === split.parent && this.listed !== undefined) {
			this.onChange(folderSuggestions(this.listed, split.prefix));
			return;
		}
		this.timer = setTimeout(() => {
			void this.list(request, split.parent, split.prefix);
		}, this.delayMs);
	}

	/** Show nothing until the next update. */
	clear(): void {
		this.request += 1;
		clearTimeout(this.timer);
		this.onChange([]);
	}

	dispose(): void {
		this.request += 1;
		clearTimeout(this.timer);
	}

	private async list(
		request: number,
		parent: string,
		prefix: string,
	): Promise<void> {
		try {
			const folder = await this.browse(parent);
			if (request !== this.request) return;
			this.listed = folder;
			this.listedParent = parent;
			this.onChange(folderSuggestions(folder, prefix));
		} catch {
			// A parent that is not a folder suggests nothing; Go says why.
			if (request === this.request) this.onChange([]);
		}
	}
}
