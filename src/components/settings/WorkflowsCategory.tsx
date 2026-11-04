import { WORKFLOW_CLIENT_LIMITS, WORKFLOW_ICON_NAMES, type WorkflowIconName } from '@terminay/client-core'
import { GripVertical, X } from 'lucide-react'
import { type DragEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { SharedMacroLibraryPane } from '../../shared/SharedMacroLibraryPane'
import { type SettingsCategoryParts, SettingsListColumn, useSettingsShellNavigation } from '../../shared/SharedSettingsRouteBody'
import { WorkflowIcon } from '../../workspace/workflows/workflowIcons'
import type { WorkflowEditor } from '../workflows/useWorkflowEditor'
import { type DraftTemplate, formatKiB, launchPreview, moveBefore, serializedSize, templateSearchText } from '../workflows/workflowLibraryModel'
import '../workflows/WorkflowsCategory.css'

const NEW_CATEGORY = '\u0000new'
const WORKFLOW_NOUN = Object.freeze({ one: 'workflow', many: 'workflows', title: 'Workflows' })
const STEP_DRAG_TYPE = 'application/x-terminay-workflow-step'

/** Why the selected server's workflows cannot be edited, or undefined when they can. */
export type WorkflowsUnavailable = 'disconnected' | 'incompatible'

type LibraryProps = Parameters<typeof SharedMacroLibraryPane>[0]

function WorkflowLibraryColumn({ onSelect, onCreate, ...props }: LibraryProps) {
  const { showDetail } = useSettingsShellNavigation()
  return (
    <SharedMacroLibraryPane
      {...props}
      onSelect={(id) => {
        onSelect(id)
        showDetail()
      }}
      onCreate={(category) => {
        onCreate(category)
        showDetail()
      }}
    />
  )
}

function NewWorkflowButton({ disabled, onCreate }: Readonly<{ disabled: boolean; onCreate: () => void }>) {
  const { showDetail } = useSettingsShellNavigation()
  return (
    <button
      type="button"
      className="settings-list-add-button"
      onClick={() => {
        onCreate()
        showDetail()
      }}
      disabled={disabled}
    >
      New workflow
    </button>
  )
}

/** One template as the library lists it: its step count beside its name. */
export function workflowListItems(editor: Pick<WorkflowEditor, 'draft' | 'unsavedIds'>) {
  return editor.draft.templates.map((template) => ({
    id: template.id,
    title: `${template.name || 'Untitled'} · ${template.steps.length} ${template.steps.length === 1 ? 'step' : 'steps'}`,
    category: template.category,
    isUnsaved: editor.unsavedIds.has(template.id),
    searchText: `${template.name}\n${templateSearchText(template)}`,
  }))
}

/**
 * The Workflows category of Settings: the selected server's templates in the
 * list column and the selected template in the detail. The change set lives
 * in the editor the caller owns.
 */
export function WorkflowsCategory({
  editor,
  unavailable,
  render,
}: Readonly<{
  editor: WorkflowEditor
  unavailable?: WorkflowsUnavailable
  render: (parts: SettingsCategoryParts) => ReactNode
}>) {
  const { draft, loadError, isReady, isSaving, isDirty, errorText, saveState, filter, setFilter, selected, selectedId, focusNameFor } = editor
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isNamingCategory, setIsNamingCategory] = useState(false)
  const nameInput = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    if (selectedId === null || focusNameFor.current !== selectedId) return
    focusNameFor.current = null
    nameInput.current?.focus()
    nameInput.current?.select()
  }, [focusNameFor, selectedId])

  const select = (id: string) => {
    editor.select(id)
    setConfirmingDelete(false)
    setIsNamingCategory(false)
  }

  const list = (
    <SettingsListColumn
      title="Workflows"
      action={<NewWorkflowButton disabled={!isReady} onCreate={() => editor.addTemplate('')} />}
    >
      {unavailable === undefined ? (
        <WorkflowLibraryColumn
          embedded
          noun={WORKFLOW_NOUN}
          activeMacroId={selectedId}
          canManageCategories
          categories={draft.categories}
          filter={filter}
          isLoading={!isReady}
          macros={workflowListItems(editor)}
          onCreate={editor.addTemplate}
          onCreateCategory={editor.createCategory}
          onFilterChange={setFilter}
          onMoveMacro={editor.moveTemplate}
          onRemoveCategory={editor.removeCategory}
          onRenameCategory={editor.renameCategory}
          onReorderCategories={editor.reorderCategories}
          onReorder={editor.reorderTemplates}
          onSelect={select}
        />
      ) : null}
    </SettingsListColumn>
  )

  const detailActions =
    unavailable === undefined ? (
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
    ) : undefined

  const detail =
    unavailable !== undefined ? (
      <div className="settings-empty-hero" role="status">
        <h2>{unavailable === 'incompatible' ? 'This server does not support workflows' : 'Not connected'}</h2>
        <p>
          {unavailable === 'incompatible'
            ? 'Update Terminay on the selected server to manage its workflows here.'
            : 'Workflows appear once the selected server is connected.'}
        </p>
      </div>
    ) : (
      <>
        {loadError ? <div className="settings-error-banner" role="alert">Workflows could not be loaded. {loadError.message}</div> : null}
        {errorText ? <div className="settings-error-banner macro-save-error" role="alert">{errorText}</div> : null}
        {selected === null ? (
          <div className="settings-empty-hero">
            <h2>{draft.templates.length === 0 ? 'No workflows yet' : 'Select a workflow to edit'}</h2>
            <p>
              {draft.templates.length === 0
                ? 'Create one with New workflow. Launch it on a terminal from the Command Bar.'
                : 'Choose one from the list, or create a new one.'}
            </p>
          </div>
        ) : (
          <fieldset className="workflow-editor-fieldset" disabled={isSaving}>
          <TemplateDetail
            editor={editor}
            template={selected}
            nameInput={nameInput}
            isNamingCategory={isNamingCategory}
            setIsNamingCategory={setIsNamingCategory}
            confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete}
          />
          </fieldset>
        )}
      </>
    )

  return render({
    list,
    detail,
    detailTitle: selected?.name || 'Workflows',
    ...(detailActions === undefined ? {} : { detailActions }),
  })
}

function TemplateDetail({
  editor,
  template,
  nameInput,
  isNamingCategory,
  setIsNamingCategory,
  confirmingDelete,
  setConfirmingDelete,
}: Readonly<{
  editor: WorkflowEditor
  template: DraftTemplate
  nameInput: React.RefObject<HTMLInputElement | null>
  isNamingCategory: boolean
  setIsNamingCategory: (naming: boolean) => void
  confirmingDelete: boolean
  setConfirmingDelete: (confirming: boolean | ((current: boolean) => boolean)) => void
}>) {
  const { draft, updateTemplate } = editor
  const set = (patch: Partial<DraftTemplate>) => updateTemplate(template.id, (current) => ({ ...current, ...patch }))
  const category = draft.categories.includes(template.category) ? template.category : ''
  const size = serializedSize(template)
  const oversized = size > WORKFLOW_CLIENT_LIMITS.maxSerializedBytes
  const commitCategory = (value: string) => {
    setIsNamingCategory(false)
    editor.assignNewCategory(value)
  }

  return (
    <>
      <section className="settings-section">
        <div className="settings-group">
          <label className="settings-row settings-row--field">
            <span className="settings-row-label">Name</span>
            <input
              ref={nameInput}
              className="settings-input-text"
              type="text"
              aria-label="Workflow name"
              value={template.name}
              maxLength={WORKFLOW_CLIENT_LIMITS.maxNameChars}
              onChange={(event) => set({ name: event.target.value })}
              placeholder="Workflow name"
            />
          </label>
          <label className="settings-row settings-row--field">
            <span className="settings-row-label">Description</span>
            <input
              className="settings-input-text"
              type="text"
              aria-label="Description"
              value={template.description}
              onChange={(event) => set({ description: event.target.value })}
              placeholder="What this workflow is for…"
            />
          </label>
          <div className="settings-row settings-row--field macro-category-row">
            <label className="settings-row-label" htmlFor="workflow-category">Category</label>
            {isNamingCategory ? (
              <input
                autoFocus
                id="workflow-category"
                className="settings-input-text"
                placeholder="Category name"
                maxLength={64}
                onBlur={(event) => commitCategory(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitCategory(event.currentTarget.value)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setIsNamingCategory(false)
                  }
                }}
              />
            ) : (
              <select
                id="workflow-category"
                className="settings-select"
                value={category}
                onChange={(event) => {
                  if (event.target.value === NEW_CATEGORY) setIsNamingCategory(true)
                  else set({ category: event.target.value })
                }}
              >
                {draft.categories.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
                <option value="">No category</option>
                <option value={NEW_CATEGORY}>New category…</option>
              </select>
            )}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section-title-row">
          <h3 className="settings-section-title">Opening prompt</h3>
          <span className="settings-status">Typed after /goal when the workflow is launched</span>
        </div>
        <textarea
          className="settings-input-text workflow-editor-textarea"
          aria-label="Opening prompt"
          rows={4}
          value={template.openingPrompt}
          onChange={(event) => set({ openingPrompt: event.target.value })}
          placeholder="Brief the agent: what this run is for and anything it must know…"
        />
      </section>

      <section className="settings-section">
        <div className="settings-section-title-row">
          <h3 className="settings-section-title">Steps</h3>
          <span className="settings-status">The agent works through these in order</span>
        </div>
        <StepList editor={editor} template={template} />
      </section>

      <section className="settings-section" aria-label="Launch text">
        <div className="settings-section-title-row">
          <h3 className="settings-section-title">Launch text</h3>
          <span className={`settings-status${oversized ? ' workflow-size--over' : ''}`} data-testid="workflow-size">
            {formatKiB(size)} of 56 KiB
          </span>
        </div>
        <pre className="workflow-launch-preview" title="Text typed into the terminal">{launchPreview(template.openingPrompt)}</pre>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Manage</h3>
        <div className="settings-inline-actions">
          <button type="button" className="settings-secondary-button" onClick={editor.duplicateSelected}>
            Duplicate
          </button>
          <button
            type="button"
            className="settings-danger-button"
            onClick={() => {
              if (confirmingDelete) {
                editor.deleteSelected()
                setConfirmingDelete(false)
              } else setConfirmingDelete(true)
            }}
            onBlur={() => setConfirmingDelete(false)}
          >
            {confirmingDelete ? 'Click again to delete' : 'Delete'}
          </button>
        </div>
      </section>
    </>
  )
}

/** A template's steps: drag or Alt+Arrow on a handle to reorder; the moved handle keeps focus. */
export function StepList({ editor, template }: Readonly<{ editor: Pick<WorkflowEditor, 'addStep' | 'removeStep' | 'updateStep' | 'moveStep' | 'reorderSteps'>; template: DraftTemplate }>) {
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const refocus = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropBefore, setDropBefore] = useState<number | null>(null)

  // Reordering moves the row's element, which can drop the focus; give it back.
  useLayoutEffect(() => {
    const key = refocus.current
    if (key === null) return
    refocus.current = null
    const handle = handles.current.get(key)
    if (handle !== undefined && handle !== document.activeElement) handle.focus()
  })

  const keys = template.steps.map((step) => step.key)
  const onDrop = (event: DragEvent<HTMLElement>, before: number) => {
    const key = event.dataTransfer.getData(STEP_DRAG_TYPE) || dragging
    setDragging(null)
    setDropBefore(null)
    if (!key) return
    event.preventDefault()
    const next = moveBefore(keys, keys.indexOf(key), before)
    if (next !== keys) editor.reorderSteps(template.id, next)
  }

  return (
    <div className="workflow-steps-editor">
      <p id="workflow-step-reorder-help" className="sr-only">
        Press Alt and the up or down arrow to move this step.
      </p>
      <ol className="workflow-step-rows">
        {template.steps.map((step, index) => (
          <li
            key={step.key}
            className={`workflow-step-row${dropBefore === index ? ' workflow-step-row--drop' : ''}`}
            data-step-key={step.key}
            onDragOver={(event) => {
              if (dragging === null) return
              event.preventDefault()
              const box = event.currentTarget.getBoundingClientRect()
              setDropBefore(event.clientY > box.top + box.height / 2 ? index + 1 : index)
            }}
            onDrop={(event) => onDrop(event, dropBefore ?? index)}
          >
            <button
              type="button"
              className="workflow-step-handle"
              ref={(element) => {
                if (element === null) handles.current.delete(step.key)
                else handles.current.set(step.key, element)
              }}
              draggable
              aria-label={`Move step ${index + 1}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-describedby="workflow-step-reorder-help"
              onDragStart={(event) => {
                event.dataTransfer.setData(STEP_DRAG_TYPE, step.key)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(step.key)
              }}
              onDragEnd={() => {
                setDragging(null)
                setDropBefore(null)
              }}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                event.preventDefault()
                refocus.current = step.key
                editor.moveStep(template.id, step.key, event.key === 'ArrowUp' ? -1 : 1)
              }}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
            <span className="workflow-step-number" aria-hidden="true">{index + 1}</span>
            <div className="workflow-step-fields">
              <div className="workflow-step-title-row">
                <IconPicker
                  index={index}
                  value={step.icon}
                  onChange={(icon) => editor.updateStep(template.id, step.key, { icon })}
                />
                <input
                  className="settings-input-text"
                  type="text"
                  aria-label={`Step ${index + 1} title`}
                  value={step.title}
                  maxLength={WORKFLOW_CLIENT_LIMITS.maxTitleChars}
                  onChange={(event) => editor.updateStep(template.id, step.key, { title: event.target.value })}
                  placeholder="Step title"
                />
              </div>
              <textarea
                className="settings-input-text workflow-editor-textarea"
                aria-label={`Step ${index + 1} prompt`}
                rows={2}
                value={step.prompt}
                onChange={(event) => editor.updateStep(template.id, step.key, { prompt: event.target.value })}
                placeholder="What the agent does in this step…"
              />
            </div>
            <button
              type="button"
              className="workflow-step-remove"
              aria-label={`Remove step ${index + 1}`}
              title="Remove step"
              onClick={() => editor.removeStep(template.id, step.key)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="settings-secondary-button"
        onClick={() => editor.addStep(template.id)}
        disabled={template.steps.length >= WORKFLOW_CLIENT_LIMITS.maxSteps}
      >
        Add step
      </button>
    </div>
  )
}

/** A step's icon: one of the fixed set, or none. The chosen icon is drawn beside the menu. */
export function IconPicker({ index, value, onChange }: Readonly<{ index: number; value: WorkflowIconName | ''; onChange: (icon: WorkflowIconName | '') => void }>) {
  return (
    <span className="workflow-icon-picker" data-icon={value || 'none'}>
      <span className="workflow-icon-picker-swatch" aria-hidden="true">
        {value === '' ? null : <WorkflowIcon name={value} />}
      </span>
      <select
        className="settings-select"
        aria-label={`Step ${index + 1} icon`}
        value={value}
        onChange={(event) => onChange(event.target.value as WorkflowIconName | '')}
      >
        <option value="">No icon</option>
        {WORKFLOW_ICON_NAMES.map((name) => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>
    </span>
  )
}
