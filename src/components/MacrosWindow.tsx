import { useEffect, useMemo, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import {
  defaultMacros,
  extractTemplatePlaceholders,
  mergeMacroFieldsWithTemplate,
  normalizeMacros,
  renderMacroTemplate,
} from '../macroSettings'
import { useMacroSettings } from '../hooks/useMacroSettings'
import type { MacroDefinition, MacroFieldDefinition, MacroFieldValue } from '../types/macros'
import '../settings.css'

function createEmptyMacro(nextIndex: number): MacroDefinition {
  return {
    id: `macro-${Date.now()}`,
    title: `Macro ${nextIndex}`,
    description: '',
    template: '',
    submitMode: 'type-only',
    fields: [],
  }
}

function createEmptyField(nextIndex: number): MacroFieldDefinition {
  return {
    id: `macro-field-${Date.now()}-${nextIndex}`,
    name: `Field ${nextIndex}`,
    label: `Field ${nextIndex}`,
    type: 'text',
    required: true,
    description: '',
    placeholder: '',
    defaultValue: '',
    options: [],
  }
}

function serializeOptions(field: MacroFieldDefinition): string {
  return field.options.map((option) => `${option.label}|${option.value}`).join('\n')
}

function parseOptions(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawLabel, rawValue] = line.split('|').map((part) => part.trim())
      return {
        label: rawLabel || rawValue || 'Option',
        value: rawValue || rawLabel || 'option',
      }
    })
}

function coerceDefaultValue(field: MacroFieldDefinition, value: string): MacroFieldValue {
  switch (field.type) {
    case 'number':
      return value.trim().length > 0 ? Number(value) : 0
    case 'checkbox':
      return value === 'true'
    default:
      return value
  }
}

function MacroItem({ macro, isActive, onClick }: { macro: MacroDefinition, isActive: boolean, onClick: () => void }) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={macro}
      className={`macro-nav-item${isActive ? ' macro-nav-item--active' : ''}`}
      dragListener={false}
      dragControls={controls}
    >
      <div className="macro-nav-item-inner">
        <div className="macro-nav-item-drag-handle" onPointerDown={(e) => controls.start(e)}>
          ⋮⋮
        </div>
        <button
          type="button"
          className="macro-nav-item-button"
          onClick={onClick}
        >
          {macro.title}
        </button>
      </div>
    </Reorder.Item>
  )
}

function FieldItem({ 
  field, 
  onUpdateField, 
  onRemoveField 
}: { 
  field: MacroFieldDefinition, 
  onUpdateField: (updater: (field: MacroFieldDefinition) => MacroFieldDefinition) => void,
  onRemoveField: () => void
}) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      style={{
        background: 'var(--settings-bg)',
        borderBottom: '1px solid var(--settings-border)',
        padding: '12px 16px',
        listStyle: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, width: '100%' }}>
        <div className="settings-field-drag-handle" style={{ padding: 0, marginTop: 4 }} onPointerDown={(e) => controls.start(e)}>
          ⋮⋮
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              className="settings-input-text"
              type="text"
              value={field.name}
              style={{ flex: 1 }}
              onChange={(event) => onUpdateField((current) => ({ ...current, name: event.target.value }))}
              placeholder="Variable Name"
            />
            <input
              className="settings-input-text"
              type="text"
              value={field.label}
              style={{ flex: 1 }}
              onChange={(event) => onUpdateField((current) => ({ ...current, label: event.target.value }))}
              placeholder="Display Label"
            />
            <select
              className="settings-select"
              style={{ width: 120, height: 26, padding: '0 8px' }}
              value={field.type}
              onChange={(event) =>
                onUpdateField((current) => ({
                  ...current,
                  type: event.target.value as MacroFieldDefinition['type'],
                }))
              }
            >
              <option value="text">Text</option>
              <option value="textarea">Textarea</option>
              <option value="select">Select</option>
              <option value="number">Number</option>
              <option value="checkbox">Checkbox</option>
              <option value="emoji">Emoji</option>
            </select>
            <input
              className="settings-input-text"
              type="text"
              style={{ width: 120 }}
              value={String(field.defaultValue)}
              onChange={(event) =>
                onUpdateField((current) => ({
                  ...current,
                  defaultValue: coerceDefaultValue(current, event.target.value),
                }))
              }
              placeholder="Default"
            />
            <button
              type="button"
              className="settings-danger-button settings-danger-button--quiet"
              onClick={onRemoveField}
            >
              Remove
            </button>
          </div>

          {field.type === 'select' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
               <span style={{ fontSize: 12, color: 'var(--settings-text-muted)', whiteSpace: 'nowrap' }}>Options (label|value)</span>
               <textarea
                className="settings-textarea settings-textarea--small"
                style={{ flex: 1, minHeight: 40 }}
                placeholder="Option 1|val1&#10;Option 2|val2"
                rows={1}
                value={serializeOptions(field)}
                onChange={(event) =>
                  onUpdateField((current) => ({
                    ...current,
                    options: parseOptions(event.target.value),
                  }))
                }
              />
            </div>
          )}
        </div>
      </div>
    </Reorder.Item>
  )
}

export function MacrosWindow() {
  const { macros: persistedMacros, isLoading } = useMacroSettings()
  const [draftMacros, setDraftMacros] = useState<MacroDefinition[]>(defaultMacros)
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  useEffect(() => {
    const normalized = normalizeMacros(persistedMacros)
    setDraftMacros(normalized)
    setSelectedMacroId((current) => {
      if (normalized.length === 0) {
        return null
      }

      if (current && normalized.some((macro) => macro.id === current)) {
        return current
      }

      return normalized[0]?.id ?? null
    })
  }, [persistedMacros])

  const selectedMacro = useMemo(
    () => draftMacros.find((macro) => macro.id === selectedMacroId) ?? null,
    [draftMacros, selectedMacroId],
  )

  const selectedMacroPreview = useMemo(() => {
    if (!selectedMacro) {
      return ''
    }

    const values = Object.fromEntries(
      mergeMacroFieldsWithTemplate(selectedMacro).map((field) => [field.name, field.defaultValue]),
    )

    return renderMacroTemplate(selectedMacro.template, values)
  }, [selectedMacro])

  const selectedPlaceholders = useMemo(
    () => (selectedMacro ? extractTemplatePlaceholders(selectedMacro.template) : []),
    [selectedMacro],
  )

  const updateSelectedMacro = (updater: (macro: MacroDefinition) => MacroDefinition) => {
    if (!selectedMacroId) {
      return
    }

    setDraftMacros((current) => current.map((macro) => (macro.id === selectedMacroId ? updater(macro) : macro)))
  }

  const updateSelectedField = (fieldId: string, updater: (field: MacroFieldDefinition) => MacroFieldDefinition) => {
    updateSelectedMacro((macro) => ({
      ...macro,
      fields: macro.fields.map((field) => (field.id === fieldId ? updater(field) : field)),
    }))
  }

  const addMacro = () => {
    const nextMacro = createEmptyMacro(draftMacros.length + 1)
    setDraftMacros((current) => [...current, nextMacro])
    setSelectedMacroId(nextMacro.id)
  }

  const duplicateSelectedMacro = () => {
    if (!selectedMacro) {
      return
    }

    const duplicated: MacroDefinition = {
      ...selectedMacro,
      id: `macro-${Date.now()}`,
      title: `${selectedMacro.title} Copy`,
      fields: selectedMacro.fields.map((field, index) => ({
        ...field,
        id: `macro-field-${Date.now()}-${index + 1}`,
        options: field.options.map((option) => ({ ...option })),
      })),
    }

    setDraftMacros((current) => [...current, duplicated])
    setSelectedMacroId(duplicated.id)
  }

  const deleteSelectedMacro = () => {
    if (!selectedMacro) {
      return
    }

    if (!confirm(`Delete "${selectedMacro.title}"?`)) {
      return
    }

    const nextMacros = draftMacros.filter((macro) => macro.id !== selectedMacro.id)
    setDraftMacros(nextMacros)
    setSelectedMacroId(nextMacros[0]?.id ?? null)
  }

  const addField = () => {
    if (!selectedMacro) {
      return
    }

    const nextField = createEmptyField(selectedMacro.fields.length + 1)
    updateSelectedMacro((macro) => ({
      ...macro,
      fields: [...macro.fields, nextField],
    }))
  }

  const syncFieldsFromTemplate = () => {
    if (!selectedMacro) {
      return
    }

    updateSelectedMacro((macro) => ({
      ...macro,
      fields: mergeMacroFieldsWithTemplate(macro),
    }))
  }

  const saveMacros = async () => {
    setIsSaving(true)
    setErrorText(null)

    try {
      const saved = await window.termide.updateMacros(normalizeMacros(draftMacros))
      setDraftMacros(saved)
      setSelectedMacroId((current) => (current && saved.some((macro) => macro.id === current) ? current : saved[0]?.id ?? null))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  const resetMacros = async () => {
    if (!confirm('Reset macros back to the default starter set?')) {
      return
    }

    setIsSaving(true)
    setErrorText(null)

    try {
      const saved = await window.termide.resetMacros()
      setDraftMacros(saved)
      setSelectedMacroId(saved[0]?.id ?? null)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-header">
          <div className="settings-brand">
            <h1>Macros</h1>
            <p className="settings-status">Build reusable prompts and actions.</p>
          </div>

          <button type="button" className="settings-primary-button" onClick={addMacro}>
            New Macro
          </button>
        </div>

        <div className="settings-nav">
          <div className="settings-nav-group">
            <div className="settings-nav-group-title">Library</div>
            <Reorder.Group
              axis="y"
              values={draftMacros}
              onReorder={setDraftMacros}
              className="settings-reorder-group"
            >
              {draftMacros.map((macro) => (
                <MacroItem
                  key={macro.id}
                  macro={macro}
                  isActive={macro.id === selectedMacroId}
                  onClick={() => setSelectedMacroId(macro.id)}
                />
              ))}
            </Reorder.Group>
            {!isLoading && draftMacros.length === 0 ? <p className="settings-empty-state">No macros yet.</p> : null}
          </div>
        </div>

        <div className="settings-sidebar-footer">
          <span className="settings-status">{isSaving ? 'Saving...' : `${draftMacros.length} macros`}</span>
          <button type="button" className="settings-reset-all" onClick={resetMacros}>
            Reset All
          </button>
        </div>
      </aside>

      <main className="settings-main">
        <div className="macros-content">
          {errorText ? <div className="settings-error-banner">{errorText}</div> : null}

          {!selectedMacro ? (
            <div className="settings-empty-hero">
              <h2>Select a macro to edit</h2>
              <p>Choose from your library or create a new one.</p>
            </div>
          ) : (
            <>
              <div className="settings-hero">
                <div className="settings-hero-main">
                  <input
                    className="settings-hero-title-input"
                    type="text"
                    value={selectedMacro.title}
                    onChange={(event) => updateSelectedMacro((macro) => ({ ...macro, title: event.target.value }))}
                    placeholder="Macro Title"
                  />
                  <input
                    className="settings-hero-desc-input"
                    type="text"
                    value={selectedMacro.description}
                    onChange={(event) => updateSelectedMacro((macro) => ({ ...macro, description: event.target.value }))}
                    placeholder="Describe what this macro does..."
                  />
                </div>
                <div className="settings-hero-actions">
                  <button type="button" className="settings-secondary-button" onClick={duplicateSelectedMacro}>
                    Duplicate
                  </button>
                  <button type="button" className="settings-danger-button" onClick={deleteSelectedMacro}>
                    Delete
                  </button>
                  <button type="button" className="settings-primary-button" onClick={saveMacros} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>

              <section className="settings-section">
                <div className="settings-section-header">
                  <h3 className="settings-section-title">Terminal Template</h3>
                </div>

                <div className="settings-group">
                  <textarea
                    className="settings-textarea settings-textarea--large"
                    value={selectedMacro.template}
                    onChange={(event) => updateSelectedMacro((macro) => ({ ...macro, template: event.target.value }))}
                    placeholder="Use {{Placeholder}} tokens to collect params before typing."
                    rows={4}
                  />
                  <div className="settings-group-footer">
                    <div className="settings-group-footer-left">
                      <select
                        className="settings-select settings-select--small"
                        value={selectedMacro.submitMode}
                        onChange={(event) =>
                          updateSelectedMacro((macro) => ({
                            ...macro,
                            submitMode: event.target.value as MacroDefinition['submitMode'],
                          }))
                        }
                      >
                        <option value="type-only">Type only</option>
                        <option value="type-and-submit">Type and submit</option>
                      </select>
                    </div>
                    <div className="settings-group-footer-right">
                      <div className="settings-chip-row">
                        {selectedPlaceholders.map((placeholder) => (
                          <span key={placeholder} className="settings-chip">
                            {placeholder}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <h3 className="settings-section-title">Fields</h3>
                  <div className="settings-inline-actions">
                    <button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={syncFieldsFromTemplate}>
                      Sync Missing
                    </button>
                    <button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={addField}>
                      Add Field
                    </button>
                  </div>
                </div>

                <Reorder.Group
                  axis="y"
                  values={selectedMacro.fields}
                  onReorder={(newFields) => updateSelectedMacro(m => ({ ...m, fields: newFields }))}
                  className="settings-group"
                  style={{ padding: 0 }}
                >
                  {selectedMacro.fields.length === 0 && (
                    <div className="settings-empty-state">No fields defined yet.</div>
                  )}
                  {selectedMacro.fields.map((field) => (
                    <FieldItem
                      key={field.id}
                      field={field}
                      onUpdateField={(updater) => updateSelectedField(field.id, updater)}
                      onRemoveField={() =>
                        updateSelectedMacro((macro) => ({
                          ...macro,
                          fields: macro.fields.filter((candidate) => candidate.id !== field.id),
                        }))
                      }
                    />
                  ))}
                </Reorder.Group>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <h3 className="settings-section-title">Output Preview</h3>
                </div>
                <div className="settings-group">
                  <pre className="settings-code-block">{selectedMacroPreview || 'Nothing to preview yet.'}</pre>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
