import type { ReactNode } from 'react'
import { MACRO_KEY_OPTIONS } from '../../macroScript'
import { renderMacroDurationMs, renderMacroTemplate } from '../../macroSettings'
import type { MacroDefinition, MacroFieldDefinition, MacroFieldValue } from '../../types/macros'
import { useFilePathDrop } from './useFilePathDrop'

/** Marks where an input with no value lands in rendered text, so its label can be shown there. */
const MISSING = '\u0001'

function optionsOf(field: MacroFieldDefinition): { label: string; value: string }[] {
  if (field.optionsText === undefined) return field.options
  return field.optionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [label = '', value] = line.split('|')
      return { label: label.trim(), value: (value ?? label).trim() }
    })
}

export function previewValueOf(field: MacroFieldDefinition, values: Readonly<Record<string, MacroFieldValue>>): MacroFieldValue {
  return values[field.name] ?? field.defaultValue
}

function PreviewFileInput({
  id,
  value,
  onChange,
}: Readonly<{ id: string; value: string; onChange: (value: string) => void }>) {
  const drop = useFilePathDrop(onChange)
  return (
    <div className={`macro-path-field${drop.isDragOver ? ' macro-path-field--over' : ''}`} {...drop.handlers}>
      <input
        id={id}
        className="settings-input-text"
        type="text"
        value={value}
        placeholder="/path/to/file"
        spellCheck={false}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          drop.clearNotice()
          onChange(event.target.value)
        }}
      />
      <p id={`${id}-hint`} className="macro-path-field-hint" role={drop.notice === null ? undefined : 'status'}>
        {drop.notice ?? 'Drop a file here, paste one, or type a path.'}
      </p>
    </div>
  )
}

function PreviewControl({
  field,
  id,
  value,
  onChange,
}: Readonly<{ field: MacroFieldDefinition; id: string; value: MacroFieldValue; onChange: (value: MacroFieldValue) => void }>) {
  switch (field.type) {
    case 'textarea':
      return <textarea id={id} className="settings-textarea settings-textarea--small" rows={2} value={String(value)} onChange={(event) => onChange(event.target.value)} />
    case 'select': {
      const options = optionsOf(field)
      return (
        <select id={id} className="settings-select" value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {options.some((option) => option.value === String(value)) ? null : <option value={String(value)}>{String(value) || 'Choose…'}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      )
    }
    case 'checkbox':
      return <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
    case 'number':
      return <input id={id} className="settings-input-text" type="number" value={String(value)} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} />
    case 'file':
      return <PreviewFileInput id={id} value={String(value)} onChange={onChange} />
    default:
      return <input id={id} className="settings-input-text" type="text" value={String(value)} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />
  }
}

/** Render text with the form's values; an input with no value shows as its label. */
function renderWithLabels(
  template: string,
  macro: MacroDefinition,
  values: Readonly<Record<string, MacroFieldValue>>,
): ReactNode {
  const labels: string[] = []
  const substituted: Record<string, MacroFieldValue> = {}
  for (const field of macro.fields) {
    const value = previewValueOf(field, values)
    if (value === '') {
      labels.push(field.label || field.name)
      substituted[field.name] = `${MISSING}${labels.length - 1}${MISSING}`
    } else {
      substituted[field.name] = value
    }
  }
  let rendered: string
  try {
    rendered = renderMacroTemplate(template, substituted)
  } catch {
    // The server decides what a template may contain; here the text is shown as written.
    return <span className="macro-preview-raw" title="This template could not be previewed. The server decides whether it runs.">{template}</span>
  }
  return rendered.split(new RegExp(`${MISSING}(\\d+)${MISSING}`)).map((part, index) =>
    index % 2 === 1 ? <span key={index} className="macro-preview-missing">{labels[Number(part)]}</span> : <span key={index}>{part}</span>,
  )
}

function seconds(duration: string, values: Record<string, MacroFieldValue>): string {
  try {
    return String(renderMacroDurationMs(duration, values) / 1000)
  } catch {
    return duration.trim() || '?'
  }
}

/**
 * What launching the macro asks and what it then sends, redrawn as the macro
 * and these sample values change. Rendering happens here in the client and
 * nothing is written to a terminal; the server renders for real at run time.
 */
export function MacroPreview({
  macro,
  values,
  onValueChange,
}: Readonly<{
  macro: MacroDefinition
  values: Readonly<Record<string, MacroFieldValue>>
  onValueChange: (name: string, value: MacroFieldValue) => void
}>) {
  const resolved: Record<string, MacroFieldValue> = {}
  for (const field of macro.fields) resolved[field.name] = previewValueOf(field, values)
  const cannotRun = macro.steps.some((step) => step.type === 'unsupported' || step.type === 'paste')

  return (
    <div className="macro-preview" data-testid="macro-preview">
      <section className="settings-section">
        <div className="settings-section-title-row macro-preview-title">
          <h3 className="settings-section-title">You will be asked</h3>
          {macro.fields.length > 0 ? <span className="settings-status">{macro.fields.length === 1 ? '1 input' : `${macro.fields.length} inputs`}</span> : null}
        </div>
        <div className="settings-group">
          {macro.fields.length === 0 ? (
            <div className="settings-empty-state">Nothing. It runs without asking anything.</div>
          ) : (
            <div className="macro-preview-form">
              {macro.fields.map((field) => {
                const id = `macro-preview-${macro.id}-${field.id}`
                return (
                  <div key={field.id} className="macro-preview-field">
                    <label htmlFor={id}>
                      {field.label || field.name}
                      {field.required ? <span className="macro-preview-required" title="Required"> *</span> : null}
                    </label>
                    <PreviewControl field={field} id={id} value={previewValueOf(field, values)} onChange={(value) => onValueChange(field.name, value)} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title-row macro-preview-title">
          <h3 className="settings-section-title">Then Terminay types</h3>
        </div>
        <ol className="macro-preview-sequence" aria-label="What the macro sends">
          {macro.steps.length === 0 ? <li className="macro-preview-dim">Nothing yet.</li> : null}
          {macro.steps.map((step) => (
            <li key={step.id} data-step-type={step.type}>
              {step.type === 'type' ? (
                <span className="macro-preview-typed">{renderWithLabels(step.content, macro, values)}</span>
              ) : (
                <span className="macro-preview-dim">
                  {step.type === 'key' ? `presses ${MACRO_KEY_OPTIONS.find((option) => option.value === step.key)?.label ?? step.key}` : null}
                  {step.type === 'wait_time' ? `waits ${seconds(step.durationSeconds, resolved)}s` : null}
                  {step.type === 'wait_inactivity' ? `waits for ${seconds(step.durationSeconds, resolved)}s of quiet` : null}
                  {step.type === 'select_line' ? 'selects the current line' : null}
                  {step.type === 'paste' ? 'paste clipboard: cannot run' : null}
                  {step.type === 'unsupported' ? `${step.sourceType} step: cannot run` : null}
                </span>
              )}
            </li>
          ))}
        </ol>
        {cannotRun ? <p className="macro-preview-warning" role="status">This macro will not run until the step marked as unable to run is removed.</p> : null}
        <p className="settings-status macro-preview-footnote">Preview only. Nothing is sent to a terminal from this window.</p>
      </section>
    </div>
  )
}
