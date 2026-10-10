import type { MacroFieldDefinition, MacroFieldType, MacroFieldValue } from '../../types/macros'

const FIELD_TYPES: readonly { value: MacroFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'select', label: 'Choice' },
  { value: 'number', label: 'Number' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'emoji', label: 'Emoji' },
  { value: 'file', label: 'File' },
]

export function serializeMacroFieldOptions(field: MacroFieldDefinition): string {
  return field.options.map((option) => (option.label === option.value ? option.label : `${option.label}|${option.value}`)).join('\n')
}

function coerceDefault(type: MacroFieldType, value: string): MacroFieldValue {
  switch (type) {
    case 'number':
      return value.trim().length > 0 && Number.isFinite(Number(value)) ? Number(value) : 0
    case 'checkbox':
      return value === 'true'
    default:
      return value
  }
}

/** Switching type keeps a default that still makes sense and resets one that does not. */
function defaultForType(field: MacroFieldDefinition, type: MacroFieldType): MacroFieldValue {
  if (type === 'checkbox') return field.defaultValue === true
  if (type === 'number') return typeof field.defaultValue === 'number' ? field.defaultValue : 0
  return typeof field.defaultValue === 'string' ? field.defaultValue : ''
}

/**
 * The inputs a macro asks for when it runs. Rows appear as the script mentions
 * a name; an input nothing mentions any more stays, marked, until removed.
 */
export function MacroInputsTable({
  fields,
  unusedNames,
  onUpdate,
  onRemove,
}: Readonly<{
  fields: readonly MacroFieldDefinition[]
  unusedNames: ReadonlySet<string>
  onUpdate: (fieldId: string, update: (field: MacroFieldDefinition) => MacroFieldDefinition) => void
  onRemove: (fieldId: string) => void
}>) {
  if (fields.length === 0) {
    return (
      <div className="settings-group">
        <div className="settings-empty-state">
          No inputs, so this macro runs straight away. Type <span className="settings-chip">{'{{name}}'}</span> in the text to ask for a value.
        </div>
      </div>
    )
  }

  return (
    <div className="settings-group macro-inputs">
      <div className="macro-inputs-row macro-inputs-head">
        <span>Name in text</span>
        <span>Label when run</span>
        <span>Type</span>
        <span>Default</span>
        <span>Required</span>
        <span />
      </div>
      {fields.map((field) => {
        const isUnused = unusedNames.has(field.name)
        return (
          <div key={field.id} className="macro-inputs-entry" data-input-name={field.name}>
            <div className="macro-inputs-row">
              <span className="settings-chip macro-inputs-name" title={`{{${field.name}}}`}>{`{{${field.name}}}`}</span>
              <span>
                <input
                  className="settings-input-text"
                  type="text"
                  aria-label={`Label for ${field.name}`}
                  value={field.label}
                  onChange={(event) => onUpdate(field.id, (current) => ({ ...current, label: event.target.value }))}
                />
              </span>
              <span>
                <select
                  className="settings-select"
                  aria-label={`Type for ${field.name}`}
                  value={field.type}
                  onChange={(event) => {
                    const type = event.target.value as MacroFieldType
                    onUpdate(field.id, (current) => ({ ...current, type, defaultValue: defaultForType(current, type) }))
                  }}
                >
                  {FIELD_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </span>
              <span>
                {field.type === 'checkbox' ? (
                  <select
                    className="settings-select"
                    aria-label={`Default for ${field.name}`}
                    value={String(field.defaultValue === true)}
                    onChange={(event) => onUpdate(field.id, (current) => ({ ...current, defaultValue: event.target.value === 'true' }))}
                  >
                    <option value="false">Unchecked</option>
                    <option value="true">Checked</option>
                  </select>
                ) : (
                  <input
                    className="settings-input-text"
                    type={field.type === 'number' ? 'number' : 'text'}
                    aria-label={`Default for ${field.name}`}
                    placeholder="None"
                    value={String(field.defaultValue ?? '')}
                    onChange={(event) => onUpdate(field.id, (current) => ({ ...current, defaultValue: coerceDefault(current.type, event.target.value) }))}
                  />
                )}
              </span>
              <span>
                <label className="settings-switch macro-inputs-switch">
                  <input
                    type="checkbox"
                    aria-label={`${field.name} is required`}
                    checked={field.required}
                    onChange={(event) => onUpdate(field.id, (current) => ({ ...current, required: event.target.checked }))}
                  />
                  <span className="settings-slider" />
                </label>
              </span>
              <span>
                {isUnused ? (
                  <button
                    type="button"
                    className="macro-inputs-remove"
                    aria-label={`Remove input ${field.name}`}
                    title="Remove input"
                    onClick={() => onRemove(field.id)}
                  >
                    ✕
                  </button>
                ) : null}
              </span>
            </div>
            {isUnused ? (
              <p className="macro-inputs-note">Not used in the text any more. It is kept until you remove it.</p>
            ) : null}
            {field.type === 'select' ? (
              <div className="macro-inputs-options">
                <label htmlFor={`macro-input-options-${field.id}`}>
                  Choices, one per line. Write <code>Label|value</code> to send a different value.
                </label>
                <textarea
                  id={`macro-input-options-${field.id}`}
                  className="settings-textarea settings-textarea--small"
                  rows={2}
                  placeholder={'Staging|staging\nProduction|prod'}
                  value={field.optionsText ?? serializeMacroFieldOptions(field)}
                  onChange={(event) => onUpdate(field.id, (current) => ({ ...current, optionsText: event.target.value }))}
                />
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
