/** One macro as the library lists it. `searchText` is whatever else the filter should match. */
export type MacroLibraryEntry = Readonly<{
  id: string
  title: string
  category: string
  searchText?: string
  isUnsaved?: boolean
}>

export type MacroLibraryGroup = Readonly<{
  /** The category name, or empty for macros that have none. */
  category: string
  macros: readonly MacroLibraryEntry[]
}>

/**
 * Macros grouped by category in category order, then those without one. With
 * a filter, only groups holding a match are listed; without one, an empty
 * category is still listed so it can be filled.
 */
export function groupMacroLibrary(
  macros: readonly MacroLibraryEntry[],
  categories: readonly string[],
  filter = '',
): MacroLibraryGroup[] {
  const query = filter.trim().toLowerCase()
  const known = new Set(categories)
  const matches = (macro: MacroLibraryEntry) =>
    query.length === 0 ||
    `${macro.title}\n${macro.category}\n${macro.searchText ?? ''}`.toLowerCase().includes(query)
  const groups: MacroLibraryGroup[] = []
  for (const category of categories) {
    const members = macros.filter((macro) => macro.category === category && matches(macro))
    if (members.length > 0 || query.length === 0) groups.push({ category, macros: members })
  }
  const uncategorised = macros.filter((macro) => !known.has(macro.category) && matches(macro))
  if (uncategorised.length > 0) groups.push({ category: '', macros: uncategorised })
  return groups
}

/**
 * Move a macro within the saved order. Dropped on a macro, it lands just
 * before that macro and joins its category; dropped on a category, it joins
 * that category at the end of the order.
 */
export function moveMacroInLibrary<Macro extends { id: string; category: string }>(
  macros: readonly Macro[],
  macroId: string,
  target: Readonly<{ beforeMacroId: string } | { category: string }>,
  categories: readonly string[],
): Macro[] {
  const moving = macros.find((macro) => macro.id === macroId)
  if (moving === undefined) return [...macros]
  const rest = macros.filter((macro) => macro.id !== macroId)
  if ('beforeMacroId' in target) {
    const anchor = rest.find((macro) => macro.id === target.beforeMacroId)
    if (anchor === undefined) return [...macros]
    const category = categories.includes(anchor.category) ? anchor.category : ''
    rest.splice(rest.indexOf(anchor), 0, { ...moving, category })
    return rest
  }
  return [...rest, { ...moving, category: target.category }]
}

/** The next free name of the form "New category", "New category 2", … */
export function nextCategoryName(categories: readonly string[]): string {
  const taken = new Set(categories.map((name) => name.toLowerCase()))
  let name = 'New category'
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix += 1) name = `New category ${suffix}`
  return name
}

/** A name a category may take: trimmed, 1 to 64 characters, and not already in use ignoring case. */
export function validCategoryName(name: string, categories: readonly string[], renaming?: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0 || trimmed.length > 64) return null
  const clash = categories.some(
    (existing) => existing.toLowerCase() === trimmed.toLowerCase() && existing !== renaming,
  )
  return clash ? null : trimmed
}

/**
 * Move a category to just before or just after another one. The order of
 * categories is the order the library and the Command Bar list them in.
 */
export function moveCategory(
  categories: readonly string[],
  category: string,
  target: string,
  position: 'before' | 'after',
): string[] {
  if (category === target || !categories.includes(category) || !categories.includes(target)) return [...categories]
  const rest = categories.filter((name) => name !== category)
  rest.splice(rest.indexOf(target) + (position === 'after' ? 1 : 0), 0, category)
  return rest
}

/** Move a category one place up or down. A move past either end changes nothing. */
export function stepCategory(categories: readonly string[], category: string, direction: -1 | 1): string[] {
  const from = categories.indexOf(category)
  const to = from + direction
  if (from === -1 || to < 0 || to >= categories.length) return [...categories]
  const next = [...categories]
  next.splice(from, 1)
  next.splice(to, 0, category)
  return next
}
