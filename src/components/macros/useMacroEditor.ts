import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeMacros } from '../../macroSettings'
import { syncInputsWithSteps, unusedInputNames } from '../../macroScript'
import { useMacroSettings, type MacroLibrary, type MacroSettingsClient } from '../../hooks/useMacroSettings'
import { moveMacroInLibrary, nextCategoryName, validCategoryName } from '../../shared/macroLibraryGroups'
import type { MacroDefinition, MacroFieldDefinition, MacroFieldValue, MacroStep } from '../../types/macros'
import { serializeMacroFieldOptions } from './MacroInputsTable'

export type MacroDraft = { macros: MacroDefinition[]; categories: string[] }

function createEmptyMacro(nextIndex: number, category: string): MacroDefinition {
  return {
    id: `macro-${Date.now()}`,
    title: `Macro ${nextIndex}`,
    description: '',
    category,
    submitMode: 'type-only',
    template: '',
    steps: [],
    fields: [],
  }
}

function draftFrom(library: Pick<MacroLibrary, 'macros' | 'categories'>): MacroDraft {
  return { macros: normalizeMacros(library.macros), categories: [...library.categories] }
}

function parseSelectOptions(text: string, fieldLabel: string) {
  const lines = text
    .split('\n')
    .map((line, index) => ({ index: index + 1, text: line.trim() }))
    .filter((line) => line.text.length > 0)

  if (lines.length === 0) {
    throw new Error(`"${fieldLabel}" needs at least one choice.`)
  }

  const seenValues = new Set<string>()
  return lines.map((line) => {
    const parts = line.text.split('|')
    if (parts.length > 2) {
      throw new Error(`"${fieldLabel}" choice line ${line.index} has too many "|" separators.`)
    }

    const label = parts[0]?.trim() ?? ''
    const value = parts.length === 2 ? parts[1]?.trim() ?? '' : label

    if (!label || !value) {
      throw new Error(`"${fieldLabel}" choice line ${line.index} must be "label|value" or a single label.`)
    }

    if (seenValues.has(value)) {
      throw new Error(`"${fieldLabel}" has the choice value "${value}" more than once.`)
    }

    seenValues.add(value)
    return { label, value }
  })
}

/** Turn the editor's draft into what is stored: choices parsed, transient editor text dropped. */
function prepareMacrosForSave(macros: MacroDefinition[]): MacroDefinition[] {
  return macros.map((macro) => ({
    ...macro,
    fields: macro.fields.map((field) => {
      const { optionsText, ...persistedField } = field
      if (field.type !== 'select') return persistedField

      const options = parseSelectOptions(optionsText ?? serializeMacroFieldOptions(field), `${macro.title}: ${field.label || field.name}`)
      const defaultValue = String(field.defaultValue ?? '')
      return {
        ...persistedField,
        defaultValue: options.some((option) => option.value === defaultValue) ? defaultValue : options[0]?.value ?? '',
        options,
      }
    }),
  }))
}

function describeSaveError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/stale|conflict/i.test(message)) {
    return 'These macros changed on the server after you started editing. Discard your changes to load the current ones.'
  }
  return message
}

/**
 * The macro library being edited, held as one pending change set.
 *
 * It lives as long as the Settings surface that calls it, not as long as the
 * Macros category is in view, so moving to another category and back keeps
 * every unsaved edit.
 */
export function useMacroEditor(macroSettingsClient: MacroSettingsClient, active: boolean) {
  const { library, isLoading, error: loadError } = useMacroSettings(macroSettingsClient)
  /** The saved state the draft was made from; a save is conditional on its revision. */
  const [base, setBase] = useState<MacroLibrary>(library)
  const [draft, setDraft] = useState<MacroDraft>(() => draftFrom(library))
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<string, Record<string, MacroFieldValue>>>({})
  /** Inputs detection created and the user has not edited, by macro id. Never persisted. */
  const autoFieldIds = useRef(new Map<string, ReadonlySet<string>>())
  /** Set when a macro was just created, so its name is ready to be typed over. */
  const focusTitleFor = useRef<string | null>(null)

  const savedDraft = useMemo(() => draftFrom(base), [base])
  const savedById = useMemo(
    () => new Map(savedDraft.macros.map((macro) => [macro.id, JSON.stringify(macro)])),
    [savedDraft],
  )
  const unsavedMacroIds = useMemo(
    () => new Set(draft.macros.filter((macro) => savedById.get(macro.id) !== JSON.stringify(macro)).map((macro) => macro.id)),
    [draft.macros, savedById],
  )
  const removedCount = savedDraft.macros.filter((saved) => !draft.macros.some((macro) => macro.id === saved.id)).length
  const unsavedCount = unsavedMacroIds.size + removedCount
  const orderChanged = savedDraft.macros.map((macro) => macro.id).join('\n') !== draft.macros.map((macro) => macro.id).join('\n')
  const categoriesChanged = JSON.stringify(savedDraft.categories) !== JSON.stringify(draft.categories)
  const isDirty = unsavedCount > 0 || orderChanged || categoriesChanged
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const draftRef = useRef(draft)
  draftRef.current = draft

  const adopt = useCallback((next: MacroLibrary) => {
    autoFieldIds.current.clear()
    setBase(next)
    const nextDraft = draftFrom(next)
    setDraft(nextDraft)
    setSelectedMacroId((current) =>
      current !== null && nextDraft.macros.some((macro) => macro.id === current) ? current : nextDraft.macros[0]?.id ?? null,
    )
  }, [])

  /** The newest state known for this server: what it last sent, or what a save here returned. */
  const latest = useRef({ client: macroSettingsClient, library })

  // The server's state arrived or changed. Unsaved edits are kept: the next
  // save is then refused as stale, and Discard picks up the server's state.
  // Another server's macros never inherit these edits: Settings confirms
  // before the selector moves, so a new client starts from its own state.
  useEffect(() => {
    const known = latest.current
    const serverChanged = known.client !== macroSettingsClient
    if (serverChanged || library.revision >= known.library.revision) {
      latest.current = { client: macroSettingsClient, library }
    }
    if (serverChanged || !isDirtyRef.current) adopt(latest.current.library)
  }, [library, macroSettingsClient, adopt])

  const selectedMacro = useMemo(
    () => draft.macros.find((macro) => macro.id === selectedMacroId) ?? null,
    [draft.macros, selectedMacroId],
  )
  const unusedNames = useMemo(
    () => (selectedMacro ? unusedInputNames(selectedMacro.fields, selectedMacro.steps) : new Set<string>()),
    [selectedMacro],
  )

  const updateMacro = useCallback((macroId: string, update: (macro: MacroDefinition) => MacroDefinition) => {
    setSavedNotice(false)
    setDraft((current) => ({ ...current, macros: current.macros.map((macro) => (macro.id === macroId ? update(macro) : macro)) }))
  }, [])

  const updateSteps = useCallback(
    (macroId: string, steps: MacroStep[]) => {
      // Detection mints ids and records which inputs it created, so it runs
      // once here, outside the state updater, which React may call twice.
      const macro = draftRef.current.macros.find((candidate) => candidate.id === macroId)
      if (macro === undefined) return
      const synced = syncInputsWithSteps(macro.fields, autoFieldIds.current.get(macroId) ?? new Set(), steps)
      autoFieldIds.current.set(macroId, synced.autoFieldIds)
      updateMacro(macroId, (current) => ({ ...current, steps, fields: synced.fields }))
    },
    [updateMacro],
  )

  const updateField = (fieldId: string, update: (field: MacroFieldDefinition) => MacroFieldDefinition) => {
    if (selectedMacro === null) return
    // An input the user has touched is theirs: detection no longer removes it.
    const auto = new Set(autoFieldIds.current.get(selectedMacro.id) ?? [])
    auto.delete(fieldId)
    autoFieldIds.current.set(selectedMacro.id, auto)
    updateMacro(selectedMacro.id, (macro) => ({
      ...macro,
      fields: macro.fields.map((field) => (field.id === fieldId ? update(field) : field)),
    }))
  }

  // Until the server's macros have arrived there is nothing to build on: a
  // macro created now would be saved over a library that was never read.
  const isReady = !isLoading && loadError === null

  const addMacro = (category: string) => {
    if (!isReady) return
    const macro = createEmptyMacro(draft.macros.length + 1, draft.categories.includes(category) ? category : '')
    setSavedNotice(false)
    setDraft((current) => ({ ...current, macros: [...current.macros, macro] }))
    setFilter('')
    focusTitleFor.current = macro.id
    setSelectedMacroId(macro.id)
  }

  const duplicateSelectedMacro = () => {
    if (selectedMacro === null) return
    const stamp = Date.now()
    const duplicated: MacroDefinition = {
      ...selectedMacro,
      id: `macro-${stamp}`,
      title: `${selectedMacro.title} copy`,
      steps: selectedMacro.steps.map((step, index) => ({ ...step, id: `step-${stamp}-${index + 1}` })),
      fields: selectedMacro.fields.map((field, index) => ({
        ...field,
        id: `macro-field-${stamp}-${index + 1}`,
        options: field.options.map((option) => ({ ...option })),
      })),
    }
    setSavedNotice(false)
    setDraft((current) => {
      const macros = [...current.macros]
      macros.splice(macros.findIndex((macro) => macro.id === selectedMacro.id) + 1, 0, duplicated)
      return { ...current, macros }
    })
    setSelectedMacroId(duplicated.id)
  }

  const deleteSelectedMacro = () => {
    if (selectedMacro === null) return
    const index = draft.macros.findIndex((macro) => macro.id === selectedMacro.id)
    const remaining = draft.macros.filter((macro) => macro.id !== selectedMacro.id)
    setSavedNotice(false)
    setDraft((current) => ({ ...current, macros: current.macros.filter((macro) => macro.id !== selectedMacro.id) }))
    setSelectedMacroId((remaining[index] ?? remaining[index - 1])?.id ?? null)
  }

  const setCategories = (update: (draft: MacroDraft) => MacroDraft) => {
    setSavedNotice(false)
    setDraft(update)
  }

  const createCategory = (): string => {
    const name = nextCategoryName(draft.categories)
    setCategories((current) => ({ ...current, categories: [...current.categories, name] }))
    return name
  }

  const renameCategory = (category: string, proposed: string): boolean => {
    const name = validCategoryName(proposed, draft.categories, category)
    if (name === null) return false
    if (name === category) return true
    setCategories((current) => ({
      categories: current.categories.map((existing) => (existing === category ? name : existing)),
      macros: current.macros.map((macro) => (macro.category === category ? { ...macro, category: name } : macro)),
    }))
    return true
  }

  const removeCategory = (category: string) => {
    setCategories((current) => ({
      categories: current.categories.filter((existing) => existing !== category),
      macros: current.macros.map((macro) => (macro.category === category ? { ...macro, category: '' } : macro)),
    }))
  }

  /** Assigns the selected macro to a category, creating it if it is new. */
  const assignNewCategory = (proposed: string) => {
    if (selectedMacro === null) return
    const trimmed = proposed.trim().replace(/\s+/g, ' ')
    if (trimmed.length === 0) return
    const existing = draft.categories.find((name) => name.toLowerCase() === trimmed.toLowerCase())
    const name = existing ?? validCategoryName(trimmed, draft.categories)
    if (name === null) return
    setCategories((current) => ({
      categories: existing === undefined ? [...current.categories, name] : current.categories,
      macros: current.macros.map((macro) => (macro.id === selectedMacro.id ? { ...macro, category: name } : macro)),
    }))
  }

  const moveMacro = (macroId: string, target: Parameters<typeof moveMacroInLibrary>[2]) =>
    setCategories((current) => ({ ...current, macros: moveMacroInLibrary(current.macros, macroId, target, current.categories) }))

  const reorderMacros = (orderedIds: readonly string[]) => {
    const byId = new Map(draft.macros.map((macro) => [macro.id, macro]))
    const reordered = orderedIds.map((id) => byId.get(id)).filter((macro): macro is MacroDefinition => macro !== undefined)
    if (reordered.length === draft.macros.length) setCategories((current) => ({ ...current, macros: reordered }))
  }

  const reorderCategories = (categories: readonly string[]) =>
    setCategories((current) => ({ ...current, categories: [...categories] }))

  /** Resolves true when the pending change set was stored, or there was none. */
  const save = useCallback(async (): Promise<boolean> => {
    if (!isDirtyRef.current) return true
    if (isSaving || !isReady) return false
    setIsSaving(true)
    setErrorText(null)
    try {
      const macros = normalizeMacros(prepareMacrosForSave(draft.macros))
      const saved = await macroSettingsClient.saveMacroLibrary({ macros, categories: draft.categories }, base.revision)
      latest.current = { client: macroSettingsClient, library: saved }
      adopt(saved)
      setSavedNotice(true)
      return true
    } catch (error) {
      setErrorText(describeSaveError(error))
      return false
    } finally {
      setIsSaving(false)
    }
  }, [adopt, base.revision, draft, isReady, isSaving, macroSettingsClient])

  const discard = useCallback(() => {
    setErrorText(null)
    setSavedNotice(false)
    // The newest known state may be ahead of the one these edits started from.
    adopt(latest.current.library)
  }, [adopt])

  const reset = async () => {
    setIsSaving(true)
    setErrorText(null)
    try {
      const restored = await macroSettingsClient.resetMacros()
      latest.current = { client: macroSettingsClient, library: restored }
      adopt(restored)
    } catch (error) {
      setErrorText(describeSaveError(error))
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, save])

  const saveState = isSaving
    ? 'Saving…'
    : unsavedCount > 0
      ? `Unsaved changes in ${unsavedCount} ${unsavedCount === 1 ? 'macro' : 'macros'}`
      : orderChanged
        ? 'Unsaved change to macro order'
        : categoriesChanged
          ? 'Unsaved category changes'
          : savedNotice
            ? 'Saved'
            : 'All changes saved'

  return {
    base,
    draft,
    loadError,
    isReady,
    isSaving,
    isDirty,
    errorText,
    saveState,
    unsavedMacroIds,
    filter,
    setFilter,
    selectedMacro,
    selectedMacroId,
    selectMacro: setSelectedMacroId,
    unusedNames,
    previewValues,
    setPreviewValues,
    focusTitleFor,
    updateMacro,
    updateSteps,
    updateField,
    addMacro,
    duplicateSelectedMacro,
    deleteSelectedMacro,
    createCategory,
    renameCategory,
    removeCategory,
    assignNewCategory,
    moveMacro,
    reorderMacros,
    reorderCategories,
    save,
    discard,
    reset,
  }
}

export type MacroEditor = ReturnType<typeof useMacroEditor>
