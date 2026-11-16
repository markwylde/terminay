import { WORKFLOW_CLIENT_LIMITS, WORKFLOW_ICON_NAMES, type WorkflowIconName } from '@terminay/client-core'
import { FileText, GripVertical, X } from 'lucide-react'
import { type DragEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { SharedMacroLibraryPane } from '../../shared/SharedMacroLibraryPane'
import { type SettingsCategoryParts, SettingsListColumn, useSettingsShellNavigation } from '../../shared/SharedSettingsRouteBody'
import { analyzeStages, unimpliedDependencies } from '../../workspace/workflows/workflowGraph'
import { WorkflowIcon } from '../../workspace/workflows/workflowIcons'
import type { WorkflowEditor } from '../workflows/useWorkflowEditor'
import { type DraftTemplate, formatKiB, launchPreview, serializedSize, templateSearchText } from '../workflows/workflowLibraryModel'
import { groupKey, type Outline, outlineKeys, trackOf } from '../workflows/workflowOutlineModel'
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
          <span className="settings-status">In order, except steps placed alongside each other, which run at the same time</span>
        </div>
        <StepOutline editor={editor} template={template} />
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

type OutlineEditorActions = Pick<
  WorkflowEditor,
  'addStep' | 'addStepThen' | 'addStepAlongside' | 'addStepTrack' | 'removeStep' | 'updateStep' | 'moveStep' | 'moveStepBefore'
>

/** Rows the prompt editor grows between as its text does. */
const PROMPT_MIN_ROWS = 3
const PROMPT_MAX_ROWS = 18

/**
 * A template's steps as an outline (ADR-0128), drawn as the vertical panel
 * draws a workflow: one row per step, and a bracket of tracks for steps that
 * run alongside each other. Each row shows the step's icon and title, with
 * "+ then", "+ alongside", its prompt and its removal at its end; opening a
 * step's prompt edits it over as many lines as it needs. Each bracket offers
 * "+ another track alongside", and the outline ends with "+ Add step at the
 * end". A step moves within its track by drag or Alt+Arrow on its handle; the
 * moved handle keeps focus.
 */
export function StepOutline({ editor, template }: Readonly<{ editor: OutlineEditorActions; template: DraftTemplate }>) {
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const titles = useRef(new Map<string, HTMLInputElement>())
  const refocus = useRef<{ key: string; on: 'handle' | 'title' } | null>(null)
  const known = useRef(new Set(template.steps.map((step) => step.key)))
  const [open, setOpen] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ key: string; before: string | null } | null>(null)

  // A step just added opens, with its title focused, ready to be named.
  useLayoutEffect(() => {
    const fresh = template.steps.filter((step) => !known.current.has(step.key))
    known.current = new Set(template.steps.map((step) => step.key))
    if (fresh.length === 1 && fresh[0] !== undefined) {
      setOpen(fresh[0].key)
      refocus.current = { key: fresh[0].key, on: 'title' }
    }
  }, [template.steps])

  // Moving a step moves its row's element, which can drop the focus; give it back.
  useLayoutEffect(() => {
    const target = refocus.current
    if (target === null) return
    refocus.current = null
    const element = (target.on === 'handle' ? handles : titles).current.get(target.key)
    if (element !== undefined && element !== document.activeElement) element.focus()
  })

  const byKey = new Map(template.steps.map((step) => [step.key, step]))
  const numberOf = (key: string) => template.steps.findIndex((step) => step.key === key) + 1
  const full = template.steps.length >= WORKFLOW_CLIENT_LIMITS.maxSteps
  // Dependencies the outline cannot show, while they are still the stored ones.
  const analysis = template.shapeChanged
    ? undefined
    : analyzeStages(template.steps.map((step) => ({ id: step.key, after: step.after })))
  const unshown = (key: string) =>
    analysis === undefined
      ? []
      : unimpliedDependencies(analysis, key).flatMap((id) => {
          const title = byKey.get(id)?.title
          return title === undefined ? [] : [title]
        })
  const anyUnshown = template.steps.some((step) => unshown(step.key).length > 0)

  const finishDrag = () => {
    setDragging(null)
    setDrop(null)
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    const key = event.dataTransfer.getData(STEP_DRAG_TYPE) || dragging
    const target = drop
    finishDrag()
    if (!key || target === null) return
    event.preventDefault()
    editor.moveStepBefore(template.id, key, target.before)
  }

  const renderItems = (items: Outline): ReactNode[] =>
    items.map((item, position) => {
      if (typeof item !== 'string') {
        const first = groupKey(item)
        return (
          <li key={`group:${first}`} className="workflow-outline-group" data-outline-group={first}>
            <div className="workflow-outline-bracket">
              {item.tracks.map((track, index) => (
                <ol key={outlineKeys(track)[0] ?? index} className="workflow-outline-track">
                  {renderItems(track)}
                </ol>
              ))}
            </div>
            <button
              type="button"
              className="workflow-outline-link"
              disabled={full}
              onClick={() => editor.addStepTrack(template.id, first)}
            >
              + another track alongside
            </button>
          </li>
        )
      }
      const step = byKey.get(item)
      if (step === undefined) return null
      const number = numberOf(item)
      const after = unshown(item)
      const next = items[position + 1]
      const isOpen = open === step.key
      const isDropTarget = drop !== null && drop.before === item
      const sameTrack = (key: string | null) => key !== null && trackOf(template.outline, key).includes(item)
      const promptId = `workflow-step-prompt-${template.id}-${step.key}`
      const promptRows = Math.min(PROMPT_MAX_ROWS, Math.max(PROMPT_MIN_ROWS, step.prompt.split('\n').length + 1))
      const firstLine = step.prompt.trim().split('\n')[0] ?? ''
      return (
        <li
          key={step.key}
          className={`workflow-step-row${isOpen ? ' workflow-step-row--open' : ''}${isDropTarget ? ' workflow-step-row--drop' : ''}`}
          data-step-key={step.key}
          onDragOver={(event) => {
            if (!sameTrack(dragging)) return
            event.preventDefault()
            const box = event.currentTarget.getBoundingClientRect()
            const below = event.clientY > box.top + box.height / 2
            setDrop({
              key: item,
              before: below ? (typeof next === 'string' ? next : next === undefined ? null : groupKey(next)) : item,
            })
          }}
          onDrop={onDrop}
        >
          <div className="workflow-outline-row">
            <button
              type="button"
              className="workflow-step-handle"
              ref={(element) => {
                if (element === null) handles.current.delete(step.key)
                else handles.current.set(step.key, element)
              }}
              draggable
              aria-label={`Move step ${number}`}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-describedby="workflow-step-reorder-help"
              onDragStart={(event) => {
                event.dataTransfer.setData(STEP_DRAG_TYPE, step.key)
                event.dataTransfer.effectAllowed = 'move'
                setDragging(step.key)
              }}
              onDragEnd={finishDrag}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                event.preventDefault()
                refocus.current = { key: step.key, on: 'handle' }
                editor.moveStep(template.id, step.key, event.key === 'ArrowUp' ? -1 : 1)
              }}
            >
              <GripVertical size={14} aria-hidden="true" />
            </button>
            <IconPicker
              index={number - 1}
              value={step.icon}
              onChange={(icon) => editor.updateStep(template.id, step.key, { icon })}
            />
            <div className="workflow-outline-text">
              <input
                ref={(element) => {
                  if (element === null) titles.current.delete(step.key)
                  else titles.current.set(step.key, element)
                }}
                className="workflow-outline-title"
                type="text"
                aria-label={`Step ${number} title`}
                value={step.title}
                maxLength={WORKFLOW_CLIENT_LIMITS.maxTitleChars}
                onChange={(event) => editor.updateStep(template.id, step.key, { title: event.target.value })}
                placeholder="Step title"
              />
              {after.length === 0 ? null : <span className="workflow-outline-after">after {after.join(', ')}</span>}
              {isOpen || firstLine === '' ? null : (
                <button
                  type="button"
                  className="workflow-outline-excerpt"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setOpen(step.key)}
                >
                  {firstLine}
                </button>
              )}
            </div>
            <div className="workflow-outline-actions">
              <button
                type="button"
                className="workflow-outline-action"
                aria-label={`Add a step after step ${number}`}
                disabled={full}
                onClick={() => editor.addStepThen(template.id, step.key)}
              >
                + then
              </button>
              <button
                type="button"
                className="workflow-outline-action"
                aria-label={`Add a step alongside step ${number}`}
                disabled={full}
                onClick={() => editor.addStepAlongside(template.id, step.key)}
              >
                + alongside
              </button>
              <button
                type="button"
                className={`workflow-outline-icon-button${step.prompt.trim() === '' ? '' : ' workflow-outline-icon-button--filled'}`}
                aria-label={`Step ${number} prompt`}
                aria-expanded={isOpen}
                aria-controls={isOpen ? promptId : undefined}
                title={isOpen ? 'Close prompt' : 'Edit prompt'}
                onClick={() => setOpen(isOpen ? null : step.key)}
              >
                <FileText size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="workflow-outline-icon-button workflow-step-remove"
                aria-label={`Remove step ${number}`}
                title="Remove step"
                onClick={() => editor.removeStep(template.id, step.key)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          {isOpen ? (
            <div className="workflow-outline-detail">
              <textarea
                id={promptId}
                className="settings-input-text workflow-editor-textarea workflow-outline-prompt"
                aria-label={`Step ${number} prompt text`}
                rows={promptRows}
                value={step.prompt}
                onChange={(event) => editor.updateStep(template.id, step.key, { prompt: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return
                  event.preventDefault()
                  setOpen(null)
                  titles.current.get(step.key)?.focus()
                }}
                placeholder="What the agent does in this step… (Markdown, any number of lines)"
              />
            </div>
          ) : null}
        </li>
      )
    })

  return (
    <div className="workflow-steps-editor">
      <p id="workflow-step-reorder-help" className="sr-only">
        Press Alt and the up or down arrow to move this step within its track.
      </p>
      {anyUnshown ? (
        <p className="workflow-outline-notice" role="note">
          Some steps wait on steps the outline cannot show, marked “after”. Adding, removing or moving a step, or placing one
          alongside another, replaces them with what the outline shows.
        </p>
      ) : null}
      <ol className="workflow-step-rows workflow-outline">{renderItems(template.outline)}</ol>
      <button
        type="button"
        className="settings-secondary-button workflow-outline-add-end"
        onClick={() => editor.addStep(template.id)}
        disabled={full}
      >
        + Add step at the end
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
