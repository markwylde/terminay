import { useCallback, useEffect, useMemo, useState } from 'react'
import { Reorder, useDragControls } from 'framer-motion'
import {
  defaultMacros,
  extractAllMacroPlaceholders,
  mergeFieldsWithSteps,
  normalizeMacros,
} from '../macroSettings'
import { useMacroSettings } from '../hooks/useMacroSettings'
import type { MacroDefinition, MacroFieldDefinition, MacroFieldValue, MacroStep, SecretDefinition } from '../types/macros'
import '../settings.css'

function createEmptyMacro(nextIndex: number): MacroDefinition {
  return {
    id: `macro-${Date.now()}`,
    title: `Macro ${nextIndex}`,
    description: '',
    submitMode: 'type-only',
    template: '',
    steps: [],
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

function createEmptyStep(type: MacroStep['type']): MacroStep {
  const id = `step-${Date.now()}`
  switch (type) {
    case 'type':
      return { id, type, content: '' }
    case 'key':
      return { id, type, key: 'Enter' }
    case 'secret':
      return { id, type, secretId: '' }
    case 'wait_time':
      return { id, type, durationMs: 1000 }
    case 'wait_inactivity':
      return { id, type, durationMs: 3000 }
    case 'select_line':
    case 'paste':
      return { id, type }
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

function StepItem({
  step,
  secrets,
  onUpdateStep,
  onRemoveStep
}: {
  step: MacroStep,
  secrets: SecretDefinition[],
  onUpdateStep: (updater: (step: MacroStep) => MacroStep) => void,
  onRemoveStep: () => void
}) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={step}
      dragListener={false}
      dragControls={controls}
      className="settings-field-card"
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

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="settings-step-type-badge">
              {step.type.replace('_', ' ')}
            </span>

            {step.type === 'type' && (
              <input
                className="settings-input-text"
                type="text"
                value={step.content}
                style={{ flex: 1 }}
                onChange={(e) => onUpdateStep(s => ({ ...s, content: e.target.value } as MacroStep))}
                placeholder="Type text... use {{Variable}} for fields."
              />
            )}

            {step.type === 'key' && (
              <select
                className="settings-select"
                style={{ flex: 1 }}
                value={step.key}
                onChange={(e) => onUpdateStep(s => ({ ...s, key: e.target.value } as MacroStep))}
              >
                <option value="Enter">Enter</option>
                <option value="Tab">Tab</option>
                <option value="Escape">Escape</option>
                <option value="Backspace">Backspace</option>
                <option value="ArrowUp">Up Arrow</option>
                <option value="ArrowDown">Down Arrow</option>
              </select>
            )}

            {step.type === 'secret' && (
              <select
                className="settings-select"
                style={{ flex: 1 }}
                value={step.secretId}
                onChange={(e) => onUpdateStep(s => ({ ...s, secretId: e.target.value } as MacroStep))}
              >
                <option value="">Select a secret...</option>
                {secrets.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            )}

            {(step.type === 'wait_time' || step.type === 'wait_inactivity') && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                <input
                  className="settings-input-text"
                  type="number"
                  value={step.durationMs}
                  style={{ width: 100 }}
                  onChange={(e) => onUpdateStep(s => ({ ...s, durationMs: parseInt(e.target.value, 10) || 0 } as MacroStep))}
                />
                <span style={{ fontSize: 12, color: 'var(--settings-text-muted)' }}>ms</span>
              </div>
            )}

            {(step.type === 'select_line' || step.type === 'paste') && (
              <div style={{ flex: 1, fontSize: 12, color: 'var(--settings-text-muted)' }}>
                {step.type === 'select_line' ? 'Selects current terminal line' : 'Pastes clipboard content'}
              </div>
            )}

            <button
              type="button"
              className="settings-danger-button settings-danger-button--quiet"
              onClick={onRemoveStep}
            >
              Remove
            </button>
          </div>
        </div>
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

function SecretsManager({ secrets, onRefresh }: { secrets: SecretDefinition[], onRefresh: () => void }) {
  const [newSecretName, setNewSecretName] = useState('')
  const [newSecretValue, setNewSecretValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!newSecretName || !newSecretValue) return
    setIsSaving(true)
    try {
      await window.termide.saveSecret(newSecretName, newSecretValue)
      setNewSecretName('')
      setNewSecretValue('')
      onRefresh()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this secret? This cannot be undone.')) return
    await window.termide.deleteSecret(id)
    onRefresh()
  }

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h3 className="settings-section-title">Encrypted Secrets</h3>
        <p className="settings-status" style={{ margin: 0 }}>Stored securely using OS-level encryption.</p>
      </div>

      <div className="settings-group">
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              className="settings-input-text"
              placeholder="Secret Name (e.g. Linux Password)"
              value={newSecretName}
              onChange={e => setNewSecretName(e.target.value)}
              style={{ flex: 1 }}
            />
            <input
              className="settings-input-text"
              type="password"
              placeholder="Value"
              value={newSecretValue}
              onChange={e => setNewSecretValue(e.target.value)}
              style={{ flex: 1 }}
            />
            <button 
              className="settings-primary-button" 
              onClick={handleSave} 
              disabled={isSaving || !newSecretName || !newSecretValue}
            >
              Add Secret
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            {secrets.length === 0 ? (
              <p className="settings-empty-state">No secrets stored yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {secrets.map(s => (
                  <div key={s.id} className="settings-secret-item">
                    <span className="settings-secret-name">{s.name}</span>
                    <button 
                      className="settings-danger-button settings-danger-button--quiet"
                      onClick={() => handleDelete(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function MacrosWindow() {
  const { macros: persistedMacros, isLoading } = useMacroSettings()
  const [draftMacros, setDraftMacros] = useState<MacroDefinition[]>(defaultMacros)
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<SecretDefinition[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'macros' | 'secrets'>('macros')

  const refreshSecrets = useCallback(async () => {
    const list = await window.termide.getSecrets()
    setSecrets(list)
  }, [])

  useEffect(() => {
    refreshSecrets()
  }, [refreshSecrets])

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

  const selectedPlaceholders = useMemo(
    () => (selectedMacro ? extractAllMacroPlaceholders(selectedMacro) : []),
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

  const updateSelectedStep = (stepId: string, updater: (step: MacroStep) => MacroStep) => {
    updateSelectedMacro((macro) => ({
      ...macro,
      steps: macro.steps.map((step) => (step.id === stepId ? updater(step) : step)),
    }))
  }

  const addMacro = () => {
    const nextMacro = createEmptyMacro(draftMacros.length + 1)
    setDraftMacros((current) => [...current, nextMacro])
    setSelectedMacroId(nextMacro.id)
    setActiveTab('macros')
  }

  const duplicateSelectedMacro = () => {
    if (!selectedMacro) {
      return
    }

    const duplicated: MacroDefinition = {
      ...selectedMacro,
      id: `macro-${Date.now()}`,
      title: `${selectedMacro.title} Copy`,
      steps: selectedMacro.steps.map(s => ({ ...s, id: `step-${Date.now()}-${Math.random()}` })),
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

  const addStep = (type: MacroStep['type']) => {
    if (!selectedMacro) return
    const nextStep = createEmptyStep(type)
    updateSelectedMacro(m => ({
      ...m,
      steps: [...m.steps, nextStep]
    }))
  }

  const syncFieldsFromSteps = () => {
    if (!selectedMacro) {
      return
    }

    updateSelectedMacro((macro) => ({
      ...macro,
      fields: mergeFieldsWithSteps(macro.steps, macro.fields),
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
            <p className="settings-status">Build reusable automation steps.</p>
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
                  isActive={macro.id === selectedMacroId && activeTab === 'macros'}
                  onClick={() => {
                    setSelectedMacroId(macro.id)
                    setActiveTab('macros')
                  }}
                />
              ))}
            </Reorder.Group>
            {!isLoading && draftMacros.length === 0 ? <p className="settings-empty-state">No macros yet.</p> : null}
          </div>

          <div className="settings-nav-group" style={{ marginTop: 'auto', borderTop: '1px solid var(--settings-border)', paddingTop: 16 }}>
            <button 
              className={`settings-tab-button ${activeTab === 'macros' ? 'settings-tab-button--active' : ''}`}
              style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
              onClick={() => setActiveTab('macros')}
            >
              ⌨️ Macro Library
            </button>
            <button 
              className={`settings-tab-button ${activeTab === 'secrets' ? 'settings-tab-button--active' : ''}`}
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => setActiveTab('secrets')}
            >
              🔐 Secrets Manager
            </button>
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

          {activeTab === 'secrets' ? (
            <SecretsManager secrets={secrets} onRefresh={refreshSecrets} />
          ) : !selectedMacro ? (
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
                  <h3 className="settings-section-title">Execution Steps</h3>
                  <div className="settings-inline-actions">
                    <div className="settings-dropdown-container">
                      <select 
                        className="settings-select settings-select--small"
                        onChange={(e) => {
                          if (e.target.value) {
                            addStep(e.target.value as MacroStep['type'])
                            e.target.value = ''
                          }
                        }}
                      >
                        <option value="">+ Add Step...</option>
                        <option value="type">Type Text</option>
                        <option value="key">Press Key</option>
                        <option value="secret">Insert Secret</option>
                        <option value="wait_time">Wait (Time)</option>
                        <option value="wait_inactivity">Wait (Inactivity)</option>
                        <option value="select_line">Select Line</option>
                        <option value="paste">Paste Clipboard</option>
                      </select>
                    </div>
                  </div>
                </div>

                <Reorder.Group
                  axis="y"
                  values={selectedMacro.steps}
                  onReorder={(newSteps) => updateSelectedMacro(m => ({ ...m, steps: newSteps }))}
                  className="settings-group"
                  style={{ padding: 0 }}
                >
                  {selectedMacro.steps.length === 0 && (
                    <div className="settings-empty-state">No steps defined yet. Start by adding one above.</div>
                  )}
                  {selectedMacro.steps.map((step) => (
                    <StepItem
                      key={step.id}
                      step={step}
                      secrets={secrets}
                      onUpdateStep={(updater) => updateSelectedStep(step.id, updater)}
                      onRemoveStep={() =>
                        updateSelectedMacro((macro) => ({
                          ...macro,
                          steps: macro.steps.filter((s) => s.id !== step.id),
                        }))
                      }
                    />
                  ))}
                </Reorder.Group>
              </section>

              <section className="settings-section">
                <div className="settings-section-header">
                  <h3 className="settings-section-title">Required Fields</h3>
                  <div className="settings-inline-actions">
                    <button type="button" className="settings-secondary-button settings-secondary-button--small" onClick={syncFieldsFromSteps}>
                      Sync from Steps
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
                    <div className="settings-empty-state">No fields defined yet. Fields are auto-detected from Type steps.</div>
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
                
                {selectedPlaceholders.length > 0 && (
                   <div className="settings-group-footer" style={{ marginTop: 8 }}>
                      <div className="settings-chip-row">
                        <span style={{ fontSize: 12, color: 'var(--settings-text-muted)' }}>Detected:</span>
                        {selectedPlaceholders.map((placeholder) => (
                          <span key={placeholder} className="settings-chip">
                            {placeholder}
                          </span>
                        ))}
                      </div>
                   </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
