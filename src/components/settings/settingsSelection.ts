/** The selected item of each collection category, kept while Settings is open. */
export type CollectionSelection = Readonly<Record<string, string | undefined>>;

/** Records the item chosen in a category; the other categories keep theirs. */
export function rememberSelection(
	selection: CollectionSelection,
	categoryId: string,
	itemId: string | undefined,
): CollectionSelection {
	if (selection[categoryId] === itemId) return selection;
	return { ...selection, [categoryId]: itemId };
}
