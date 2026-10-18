import { fromMarkdown, type Options } from 'mdast-util-from-markdown';

/**
 * Tells the Documentation editor's own reports of the document apart from the
 * user's edits, by what caused them rather than by when they arrive.
 *
 * MDXEditor reports the document whenever it re-exports it, and two of those
 * reports are not edits. Opening a document reports the form the editor
 * normalized it into. Changing views — rich text, source, diff — makes every
 * nested editor (an admonition's body, a JSX child) write itself back into the
 * document first, and the document is re-exported in a slightly different
 * spelling, such as an empty admonition gaining a blank line. MDXEditor makes
 * that report while the view change is being published, synchronously, so a
 * change of views is a scope with a beginning and an end, not a moment of time:
 * nothing the user does can land inside it, and everything they do after it is
 * theirs.
 *
 * A nested editor only writes its text back when it loses focus or when the
 * views change, so a report made by a change of views can carry words the user
 * typed into an admonition just before switching. That report is an edit, and
 * it is told apart from a respelling by comparing the documents it describes,
 * not the characters that spell them.
 */
export type DocumentationEditorChanges = Readonly<{
	/** The document as the editor last held it. */
	current: () => string;
	/** Records a document the editor was given rather than one it reported. */
	loaded: (markdown: string) => void;
	/** A change of views has begun; reports from here on are its own. */
	viewChangeStarted: () => void;
	/** The change of views is over; reports from here on are the user's. */
	viewChangeEnded: () => void;
	/**
	 * Takes in a report of the document and answers the edit to save, or
	 * undefined when the report is not one.
	 */
	reported: (next: string, initial: boolean) => string | undefined;
}>;

export function createDocumentationEditorChanges(
	initial: string,
	sameDocument: (left: string, right: string) => boolean,
): DocumentationEditorChanges {
	let current = initial;
	let changingViews = false;
	return Object.freeze({
		current: () => current,
		loaded(markdown: string) {
			current = markdown;
		},
		viewChangeStarted() {
			changingViews = true;
		},
		viewChangeEnded() {
			changingViews = false;
		},
		reported(next: string, initialReport: boolean) {
			if (next === current) return undefined;
			const previous = current;
			// Keep what the editor holds either way, so the document is not
			// re-imported over it and a later report of the same text is quiet.
			current = next;
			if (initialReport) return undefined;
			if (changingViews && isSameDocument(sameDocument, previous, next))
				return undefined;
			return next;
		},
	});
}

function isSameDocument(
	sameDocument: (left: string, right: string) => boolean,
	left: string,
	right: string,
): boolean {
	try {
		return sameDocument(left, right);
	} catch {
		// A document that cannot be compared is saved rather than dropped.
		return false;
	}
}

/**
 * True when two Markdown texts parse to the same document, whatever their
 * spelling. `options` carries the editor's syntax and mdast extensions, so
 * frontmatter, directives, and JSX are read as the editor reads them.
 */
export function sameMarkdownDocument(
	left: string,
	right: string,
	options: Options,
): boolean {
	return (
		documentShape(fromMarkdown(left, options)) ===
		documentShape(fromMarkdown(right, options))
	);
}

function documentShape(tree: unknown): string {
	return JSON.stringify(tree, (key, value: unknown) =>
		key === 'position' ? undefined : value,
	);
}
