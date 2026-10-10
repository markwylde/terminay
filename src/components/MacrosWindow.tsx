import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { normalizeMacros } from '../macroSettings'
import { syncInputsWithSteps, unusedInputNames } from '../macroScript'
import { useMacroSettings, type MacroLibrary, type MacroSettingsClient } from '../hooks/useMacroSettings'
import { moveMacroInLibrary, nextCategoryName, validCategoryName } from '../shared/macroLibraryGroups'
import { SharedMacroLibraryPane } from '../shared/SharedMacroLibraryPane'
import { SharedMacroRouteBody } from '../shared/SharedMacroRouteBody'
import type { MacroDefinition, MacroFieldDefinition, MacroFieldValue, MacroStep } from '../types/macros'
import { MacroInputsTable, serializeMacroFieldOptions } from './macros/MacroInputsTable'
import { MacroPreview } from './macros/MacroPreview'
import { MacroScriptEditor } from './macros/MacroScriptEditor'
import '../settings.css'

type Draft = { macros: MacroDefinition[]; categories: string[] }

const NEW_CATEGORY = '\u0000new'

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

function draftFrom(library: Pick<MacroLibrary, 'macros' | 'categories'>): Draft {
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

export function MacrosWindow({
  macroSettingsClient,
}: Readonly<{ macroSettingsClient: MacroSettingsClient }>) {
  const { library, isLoading, error: loadError } = useMacroSettings(macroSettingsClient)
  /** The saved state the draft was made from; a save is conditional on its revision. */
  const [base, setBase] = useState<MacroLibrary>(library)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(library))
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState(false)
  const [confirming, setConfirming] = useState<'delete' | 'reset' | null>(null)
  const [isNamingCategory, setIsNamingCategory] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [previewValues, setPreviewValues] = useState<Record<string, Record<string, MacroFieldValue>>>({})
  /** Inputs detection created and the user has not edited, by macro id. Never persisted. */
  const autoFieldIds = useRef(new Map<string, ReadonlySet<string>>())
  const titleInput = useRef<HTMLInputElement | null>(null)
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
  useEffect(() => {
    const known = latest.current
    if (known.client !== macroSettingsClient || library.revision >= known.library.revision) {
      latest.current = { client: macroSettingsClient, library }
    }
    if (!isDirtyRef.current) adopt(latest.current.library)
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

  const selectMacro = (macroId: string) => {
    setSelectedMacroId(macroId)
    setConfirming(null)
    setIsNamingCategory(false)
    setIsMenuOpen(false)
  }

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
    selectMacro(macro.id)
  }

  // Focus moves as the new macro is drawn, not a frame later: a later move
  // would take the caret from wherever the user had already gone on to type.
  useLayoutEffect(() => {
    if (selectedMacroId === null || focusTitleFor.current !== selectedMacroId) return
    focusTitleFor.current = null
    titleInput.current?.focus()
    titleInput.current?.select()
  }, [selectedMacroId])

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
    selectMacro(duplicated.id)
  }

  const deleteSelectedMacro = () => {
    if (selectedMacro === null) return
    const index = draft.macros.findIndex((macro) => macro.id === selectedMacro.id)
    const remaining = draft.macros.filter((macro) => macro.id !== selectedMacro.id)
    setSavedNotice(false)
    setDraft((current) => ({ ...current, macros: current.macros.filter((macro) => macro.id !== selectedMacro.id) }))
    setSelectedMacroId((remaining[index] ?? remaining[index - 1])?.id ?? null)
    setConfirming(null)
    setIsMenuOpen(false)
  }

  const setCategories = (update: (draft: Draft) => Draft) => {
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

  const commitNewCategory = (proposed: string) => {
    setIsNamingCategory(false)
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

  const saveMacros = useCallback(async () => {
    if (isSaving || !isDirtyRef.current || !isReady) return
    setIsSaving(true)
    setErrorText(null)
    try {
      const macros = normalizeMacros(prepareMacrosForSave(draft.macros))
      const saved = await macroSettingsClient.saveMacroLibrary({ macros, categories: draft.categories }, base.revision)
      latest.current = { client: macroSettingsClient, library: saved }
      adopt(saved)
      setSavedNotice(true)
    } catch (error) {
      setErrorText(describeSaveError(error))
    } finally {
      setIsSaving(false)
    }
  }, [adopt, base.revision, draft, isReady, isSaving, macroSettingsClient])

  const discardChanges = () => {
    setErrorText(null)
    setSavedNotice(false)
    setConfirming(null)
    // The newest known state may be ahead of the one these edits started from.
    adopt(latest.current.library)
  }

  const resetMacros = async () => {
    setIsSaving(true)
    setErrorText(null)
    setConfirming(null)
    setIsMenuOpen(false)
    try {
      const reset = await macroSettingsClient.resetMacros()
      latest.current = { client: macroSettingsClient, library: reset }
      adopt(reset)
    } catch (error) {
      setErrorText(describeSaveError(error))
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveMacros()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveMacros])

  const canManageCategories = base.supportsCategories
  const selectedCategory = selectedMacro !== null && draft.categories.includes(selectedMacro.category) ? selectedMacro.category : ''
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

  return (
    <SharedMacroRouteBody
      sidebar={
        <SharedMacroLibraryPane
          activeMacroId={selectedMacroId}
          canManageCategories={canManageCategories}
          categories={draft.categories}
          filter={filter}
          isLoading={!isReady}
          macros={draft.macros.map((macro) => ({
            id: macro.id,
            title: macro.title,
            category: macro.category,
            isUnsaved: unsavedMacroIds.has(macro.id),
            searchText: `${macro.description}\n${macro.steps.map((step) => (step.type === 'type' ? step.content : '')).join('\n')}`,
          }))}
          onCreate={addMacro}
          onCreateCategory={createCategory}
          onFilterChange={setFilter}
          onMoveMacro={(macroId, target) =>
            setCategories((current) => ({ ...current, macros: moveMacroInLibrary(current.macros, macroId, target, current.categories) }))
          }
          onRemoveCategory={removeCategory}
          onRenameCategory={renameCategory}
          onReorderCategories={(categories) => setCategories((current) => ({ ...current, categories: [...categories] }))}
          onReorder={(orderedIds) => {
            const byId = new Map(draft.macros.map((macro) => [macro.id, macro]))
            const reordered = orderedIds.map((id) => byId.get(id)).filter((macro): macro is MacroDefinition => macro !== undefined)
            if (reordered.length === draft.macros.length) setCategories((current) => ({ ...current, macros: reordered }))
          }}
          onSelect={selectMacro}
        />
      }
      aside={
        selectedMacro === null ? null : (
          <MacroPreview
            macro={selectedMacro}
            values={previewValues[selectedMacro.id] ?? {}}
            onValueChange={(name, value) =>
              setPreviewValues((current) => ({ ...current, [selectedMacro.id]: { ...current[selectedMacro.id], [name]: value } }))
            }
          />
        )
      }
      footer={
        <div className="macro-save-bar" data-dirty={isDirty}>
          <span className={`macro-save-state${isDirty ? ' macro-save-state--dirty' : ''}`} role="status" aria-live="polite">
            {saveState}
          </span>
          {errorText ? <span className="macro-save-error" role="alert">{errorText}</span> : null}
          <span className="settings-inline-actions">
            <button type="button" className="settings-secondary-button" onClick={discardChanges} disabled={!isDirty || isSaving}>
              Discard
            </button>
            <button type="button" className="settings-primary-button" onClick={() => void saveMacros()} disabled={!isDirty || isSaving} aria-keyshortcuts="Meta+S Control+S">
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>
      }
    >
      {loadError ? <div className="settings-error-banner" role="alert">Macros could not be loaded. {loadError.message}</div> : null}

      {selectedMacro === null ? (
        <div className="settings-empty-hero">
          <h2>{draft.macros.length === 0 ? 'No macros yet' : 'Select a macro to edit'}</h2>
          <p>{draft.macros.length === 0 ? 'Create one from the library on the left.' : 'Choose one from the library, or create a new one.'}</p>
        </div>
      ) : (
        <>
          <div className="settings-hero">
            <div className="settings-hero-main">
              <input
                ref={titleInput}
                className="settings-hero-title-input"
                type="text"
                aria-label="Macro name"
                value={selectedMacro.title}
                onChange={(event) => updateMacro(selectedMacro.id, (macro) => ({ ...macro, title: event.target.value }))}
                placeholder="Macro name"
              />
              <input
                className="settings-hero-desc-input"
                type="text"
                aria-label="Description"
                value={selectedMacro.description}
                onChange={(event) => updateMacro(selectedMacro.id, (macro) => ({ ...macro, description: event.target.value }))}
                placeholder="Describe what this macro does…"
              />
              {canManageCategories ? (
                <div className="macro-category-row">
                  <label htmlFor="macro-category">Category</label>
                  {isNamingCategory ? (
                    <input
                      autoFocus
                      id="macro-category"
                      className="settings-input-text"
                      placeholder="Category name"
                      maxLength={64}
                      onBlur={(event) => commitNewCategory(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitNewCategory(event.currentTarget.value)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          setIsNamingCategory(false)
                        }
                      }}
                    />
                  ) : (
                    <select
                      id="macro-category"
                      className="settings-select"
                      value={selectedCategory}
                      onChange={(event) => {
                        const value = event.target.value
                        if (value === NEW_CATEGORY) {
                          setIsNamingCategory(true)
                          return
                        }
                        updateMacro(selectedMacro.id, (macro) => ({ ...macro, category: value }))
                      }}
                    >
                      {draft.categories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                      <option value="">No category</option>
                      <option value={NEW_CATEGORY}>New category…</option>
                    </select>
                  )}
                </div>
              ) : null}
            </div>
            <div className="settings-hero-actions">
              <button type="button" className="settings-secondary-button" onClick={duplicateSelectedMacro}>
                Duplicate
              </button>
              <button
                type="button"
                className="settings-danger-button"
                onClick={() => (confirming === 'delete' ? deleteSelectedMacro() : setConfirming('delete'))}
                onBlur={() => setConfirming((current) => (current === 'delete' ? null : current))}
              >
                {confirming === 'delete' ? 'Click again to delete' : 'Delete'}
              </button>
              <div className="macro-overflow">
                <button
                  type="button"
                  className="settings-secondary-button"
                  aria-label="More macro actions"
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  onClick={() => {
                    setIsMenuOpen((open) => !open)
                    setConfirming(null)
                  }}
                >
                  ⋯
                </button>
                {isMenuOpen ? (
                  <div className="macro-overflow-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="settings-danger-button settings-danger-button--quiet"
                      onClick={() => (confirming === 'reset' ? void resetMacros() : setConfirming('reset'))}
                    >
                      {confirming === 'reset' ? 'Click again to replace every macro' : 'Reset all macros to the starter set'}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <section className="settings-section">
            <div className="settings-section-title-row">
              <h3 className="settings-section-title">Text to type</h3>
              <span className="settings-status">Sent to the active terminal, top to bottom</span>
            </div>
            <MacroScriptEditor
              key={selectedMacro.id}
              steps={selectedMacro.steps}
              onChange={(steps) => updateSteps(selectedMacro.id, steps)}
            />
          </section>

          <section className="settings-section">
            <div className="settings-section-title-row">
              <h3 className="settings-section-title">Inputs</h3>
              <span className="settings-status">Asked each time the macro runs</span>
            </div>
            <MacroInputsTable
              fields={selectedMacro.fields}
              unusedNames={unusedNames}
              onUpdate={updateField}
              onRemove={(fieldId) =>
                updateMacro(selectedMacro.id, (macro) => ({ ...macro, fields: macro.fields.filter((field) => field.id !== fieldId) }))
              }
            />
          </section>
        </>
      )}
    </SharedMacroRouteBody>
  )
}
