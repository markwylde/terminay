import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { type SettingsCategoryParts, SettingsListColumn } from '../../shared/SharedSettingsRouteBody'
import { SharedMacroLibraryPane } from '../../shared/SharedMacroLibraryPane'
import { MacroInputsTable } from '../macros/MacroInputsTable'
import { MacroPreview } from '../macros/MacroPreview'
import { MacroScriptEditor } from '../macros/MacroScriptEditor'
import type { MacroEditor } from '../macros/useMacroEditor'

const NEW_CATEGORY = '\u0000new'

/**
 * The Macros category of Settings: the library in the list column and the
 * selected macro's script, inputs and preview in the detail.
 *
 * The pending change set lives in the editor the caller owns, so this view can
 * come and go with the category without losing edits.
 */
export function MacrosCategory({
  editor,
  render,
}: Readonly<{ editor: MacroEditor; render: (parts: SettingsCategoryParts) => ReactNode }>) {
  const {
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
    unusedNames,
    previewValues,
    setPreviewValues,
    focusTitleFor,
    updateMacro,
    updateSteps,
    updateField,
  } = editor
  const [confirming, setConfirming] = useState<'delete' | 'reset' | null>(null)
  const [isNamingCategory, setIsNamingCategory] = useState(false)
  const titleInput = useRef<HTMLInputElement | null>(null)

  const selectMacro = (macroId: string) => {
    editor.selectMacro(macroId)
    setConfirming(null)
    setIsNamingCategory(false)
  }

  // Focus moves as the new macro is drawn, not a frame later: a later move
  // would take the caret from wherever the user had already gone on to type.
  useLayoutEffect(() => {
    if (selectedMacroId === null || focusTitleFor.current !== selectedMacroId) return
    focusTitleFor.current = null
    titleInput.current?.focus()
    titleInput.current?.select()
  }, [focusTitleFor, selectedMacroId])

  const canManageCategories = base.supportsCategories
  const selectedCategory = selectedMacro !== null && draft.categories.includes(selectedMacro.category) ? selectedMacro.category : ''

  const list = (
    <SettingsListColumn
      title="Macros"
      action={
        <button
          type="button"
          className="settings-list-add-button"
          onClick={() => editor.addMacro('')}
          disabled={!isReady}
        >
          New macro
        </button>
      }
    >
      <SharedMacroLibraryPane
        embedded
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
        onCreate={editor.addMacro}
        onCreateCategory={editor.createCategory}
        onFilterChange={setFilter}
        onMoveMacro={editor.moveMacro}
        onRemoveCategory={editor.removeCategory}
        onRenameCategory={editor.renameCategory}
        onReorderCategories={editor.reorderCategories}
        onReorder={editor.reorderMacros}
        onSelect={selectMacro}
      />
    </SettingsListColumn>
  )

  const detailActions = (
    <div className="macro-save-bar" data-dirty={isDirty}>
      <span className={`macro-save-state${isDirty ? ' macro-save-state--dirty' : ''}`} role="status" aria-live="polite">
        {saveState}
      </span>
      <button type="button" className="settings-secondary-button" onClick={editor.discard} disabled={!isDirty || isSaving}>
        Discard
      </button>
      <button
        type="button"
        className="settings-primary-button"
        onClick={() => void editor.save()}
        disabled={!isDirty || isSaving}
        aria-keyshortcuts="Meta+S Control+S"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )

  const detail = (
    <>
      {loadError ? <div className="settings-error-banner" role="alert">Macros could not be loaded. {loadError.message}</div> : null}
      {errorText ? <div className="settings-error-banner macro-save-error" role="alert">{errorText}</div> : null}

      {selectedMacro === null ? (
        <div className="settings-empty-hero">
          <h2>{draft.macros.length === 0 ? 'No macros yet' : 'Select a macro to edit'}</h2>
          <p>{draft.macros.length === 0 ? 'Create one with New macro.' : 'Choose one from the list, or create a new one.'}</p>
        </div>
      ) : (
        <>
          <section className="settings-section">
            <div className="settings-group">
              <label className="settings-row settings-row--field">
                <span className="settings-row-label">Name</span>
                <input
                  ref={titleInput}
                  className="settings-input-text"
                  type="text"
                  aria-label="Macro name"
                  value={selectedMacro.title}
                  onChange={(event) => updateMacro(selectedMacro.id, (macro) => ({ ...macro, title: event.target.value }))}
                  placeholder="Macro name"
                />
              </label>
              <label className="settings-row settings-row--field">
                <span className="settings-row-label">Description</span>
                <input
                  className="settings-input-text"
                  type="text"
                  aria-label="Description"
                  value={selectedMacro.description}
                  onChange={(event) => updateMacro(selectedMacro.id, (macro) => ({ ...macro, description: event.target.value }))}
                  placeholder="Describe what this macro does…"
                />
              </label>
              {canManageCategories ? (
                <div className="settings-row settings-row--field macro-category-row">
                  <label className="settings-row-label" htmlFor="macro-category">Category</label>
                  {isNamingCategory ? (
                    <input
                      autoFocus
                      id="macro-category"
                      className="settings-input-text"
                      placeholder="Category name"
                      maxLength={64}
                      onBlur={(event) => {
                        setIsNamingCategory(false)
                        editor.assignNewCategory(event.currentTarget.value)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          setIsNamingCategory(false)
                          editor.assignNewCategory(event.currentTarget.value)
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
          </section>

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

          <section className="settings-section macro-preview-section" aria-label="Macro preview">
            <MacroPreview
              macro={selectedMacro}
              values={previewValues[selectedMacro.id] ?? {}}
              onValueChange={(name, value) =>
                setPreviewValues((current) => ({ ...current, [selectedMacro.id]: { ...current[selectedMacro.id], [name]: value } }))
              }
            />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Manage</h3>
            <div className="settings-inline-actions">
              <button type="button" className="settings-secondary-button" onClick={editor.duplicateSelectedMacro}>
                Duplicate
              </button>
              <button
                type="button"
                className="settings-danger-button"
                onClick={() => {
                  if (confirming === 'delete') {
                    editor.deleteSelectedMacro()
                    setConfirming(null)
                  } else {
                    setConfirming('delete')
                  }
                }}
                onBlur={() => setConfirming((current) => (current === 'delete' ? null : current))}
              >
                {confirming === 'delete' ? 'Click again to delete' : 'Delete'}
              </button>
              <button
                type="button"
                className="settings-danger-button settings-danger-button--quiet"
                onClick={() => {
                  if (confirming === 'reset') {
                    setConfirming(null)
                    void editor.reset()
                  } else {
                    setConfirming('reset')
                  }
                }}
                onBlur={() => setConfirming((current) => (current === 'reset' ? null : current))}
              >
                {confirming === 'reset' ? 'Click again to replace every macro' : 'Reset all macros to the starter set'}
              </button>
            </div>
          </section>
        </>
      )}
    </>
  )

  return render({
    list,
    detail,
    detailTitle: selectedMacro?.title || 'Macros',
    detailActions,
  })
}
