/** The sidebar groups of Settings, in the order they are drawn. */
export const SETTINGS_CATEGORY_GROUPS = Object.freeze([
	{
		id: 'general',
		label: 'General',
		categoryIds: ['appearance', 'theme', 'keyboard', 'accessibility', 'files', 'ai'],
	},
	{
		id: 'terminal',
		label: 'Terminal',
		categoryIds: ['shell', 'cursor', 'interaction', 'scrolling'],
	},
	{ id: 'connections', label: 'Connections', categoryIds: ['remote'] },
	{ id: 'automation', label: 'Automation', categoryIds: ['macros', 'recording'] },
	{ id: 'extensions', label: 'Extensions', categoryIds: ['extensions'] },
	{ id: 'system', label: 'System', categoryIds: ['updates', 'diagnostics'] },
] as const);

export type GroupableCategory = Readonly<{ id: string; label: string }>;

export type GroupedCategory<C extends GroupableCategory> = C &
	Readonly<{ count?: number }>;

export type SettingsCategoryGroup<C extends GroupableCategory> = Readonly<{
	id: string;
	label: string;
	categories: readonly GroupedCategory<C>[];
}>;

/**
 * Places the available categories under their sidebar groups.
 *
 * A category that is not passed in is unavailable and left out; a group with
 * nothing left in it is left out too. A category with a count is a collection
 * and carries its number of items. A category no group names goes last, under
 * System, so a new one is never silently hidden.
 */
export function groupSettingsCategories<C extends GroupableCategory>(
	categories: readonly C[],
	counts: Readonly<Record<string, number | undefined>> = {},
): SettingsCategoryGroup<C>[] {
	const byId = new Map(categories.map((category) => [category.id, category]));
	const placed = new Set<string>();
	const withCount = (category: C): GroupedCategory<C> => {
		const count = counts[category.id];
		return count === undefined ? category : { ...category, count };
	};
	const groups = SETTINGS_CATEGORY_GROUPS.map((group) => {
		const members: GroupedCategory<C>[] = [];
		for (const id of group.categoryIds) {
			const category = byId.get(id);
			if (category === undefined) continue;
			placed.add(id);
			members.push(withCount(category));
		}
		return { id: group.id, label: group.label, categories: members };
	});
	const unplaced = categories.filter((category) => !placed.has(category.id));
	if (unplaced.length > 0) {
		const system = groups.find((group) => group.id === 'system');
		system?.categories.push(...unplaced.map(withCount));
	}
	return groups.filter((group) => group.categories.length > 0);
}
