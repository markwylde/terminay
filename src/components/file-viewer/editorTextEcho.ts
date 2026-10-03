/**
 * Tells text an editor produced apart from text that arrived from outside it.
 *
 * The Monaco editor reports every edit to its panel, and the panel hands the
 * same text back as a prop. That echo arrives a render later, so while someone
 * is typing it describes text the editor has already moved past. Writing it
 * back replaces the newer text with the older one, which moves the cursor and
 * dismisses the suggestion list. Only text the editor did not produce itself,
 * such as a reload from disk, belongs in the editor.
 */
export type EditorTextEchoes = Readonly<{
	/** Records text the editor reported to its owner. */
	emitted: (text: string) => void;
	/**
	 * True when `text` is the editor's own, coming back from its owner. Renders
	 * are batched, so one echo also settles every edit reported before it.
	 */
	acknowledge: (text: string) => boolean;
	/** Forgets every edit still waiting for its echo. */
	reset: () => void;
}>;

export function createEditorTextEchoes(): EditorTextEchoes {
	let awaiting: string[] = [];
	return Object.freeze({
		emitted(text: string) {
			awaiting.push(text);
		},
		acknowledge(text: string) {
			const index = awaiting.lastIndexOf(text);
			if (index < 0) return false;
			awaiting = awaiting.slice(index + 1);
			return true;
		},
		reset() {
			awaiting = [];
		},
	});
}
