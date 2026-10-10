import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { groupMacroLibrary, type MacroLibraryEntry } from './macroLibraryGroups'

export type SharedMacroListItem = MacroLibraryEntry

/**
 * Returns a new order for one bounded keyboard reorder operation. Invalid
 * moves deliberately preserve the current order instead of emitting a host
 * mutation for a no-op.
 */
export function moveSharedMacro(
  macroIds: readonly string[],
  macroId: string,
  direction: -1 | 1,
): readonly string[] {
  const currentIndex = macroIds.indexOf(macroId)
  const nextIndex = currentIndex + direction
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= macroIds.length) return macroIds

  const next = [...macroIds]
  const [movedId] = next.splice(currentIndex, 1)
  next.splice(nextIndex, 0, movedId)
  return next
}

type DropTarget = Readonly<{ beforeMacroId: string } | { category: string }>

const MACRO_DRAG_TYPE = 'application/x-terminay-macro'

function MacroLibraryItem({ macro, isActive, isDropTarget, onMove, onSelect, onDragStart, onDragOverItem, onDropOnItem }: Readonly<{
  macro: SharedMacroListItem
  isActive: boolean
  isDropTarget: boolean
  onMove: (macroId: string, direction: -1 | 1) => void
  onSelect: (macroId: string) => void
  onDragStart: (event: DragEvent<HTMLElement>, macroId: string) => void
  onDragOverItem: (event: DragEvent<HTMLElement>, macroId: string) => void
  onDropOnItem: (event: DragEvent<HTMLElement>, macroId: string) => void
}>) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    onMove(macro.id, event.key === 'ArrowUp' ? -1 : 1)
  }
  return (
    <li
      className={`macro-nav-item${isActive ? ' macro-nav-item--active' : ''}${isDropTarget ? ' macro-nav-item--drop' : ''}`}
      data-macro-id={macro.id}
      draggable
      onDragStart={(event) => onDragStart(event, macro.id)}
      onDragOver={(event) => onDragOverItem(event, macro.id)}
      onDrop={(event) => onDropOnItem(event, macro.id)}
    >
      <div className="macro-nav-item-inner">
        <button
          type="button"
          className="macro-nav-item-button"
          aria-current={isActive ? 'true' : undefined}
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          aria-describedby="shared-macro-reorder-help"
          onClick={() => onSelect(macro.id)}
          onKeyDown={onKeyDown}
        >
          <span className="macro-nav-item-title">{macro.title || 'Untitled'}</span>
          {macro.isUnsaved ? <span className="macro-nav-item-unsaved" role="img" aria-label="Unsaved changes" title="Unsaved changes" /> : null}
        </button>
      </div>
    </li>
  )
}

/** Host-neutral macro library chrome: filter, categories, and the grouped list. Editing, execution, and persistence stay with the host route. */
export function SharedMacroLibraryPane({
  activeMacroId,
  canManageCategories,
  categories,
  filter,
  isLoading,
  macros,
  onCreate,
  onCreateCategory,
  onFilterChange,
  onMoveMacro,
  onRemoveCategory,
  onRenameCategory,
  onReorder,
  onSelect,
}: Readonly<{
  activeMacroId: string | null
  /** False against a server that does not store categories; the list is then flat. */
  canManageCategories: boolean
  categories: readonly string[]
  filter: string
  /** True until the server's macros can be edited: nothing may be created before then. */
  isLoading: boolean
  macros: readonly SharedMacroListItem[]
  onCreate: (category: string) => void
  /** Creates a category and returns its name so it can be named in place. */
  onCreateCategory: () => string
  onFilterChange: (filter: string) => void
  onMoveMacro: (macroId: string, target: DropTarget) => void
  onRemoveCategory: (category: string) => void
  /** Returns false when the name is empty or already taken. */
  onRenameCategory: (category: string, name: string) => boolean
  onReorder: (orderedMacroIds: readonly string[]) => void
  onSelect: (macroId: string) => void
}>) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const groups = groupMacroLibrary(macros, canManageCategories ? categories : [], filter)

  /** Alt+Arrow moves a macro among the macros of its own category. */
  const moveMacro = (macroId: string, direction: -1 | 1) => {
    const group = groups.find((candidate) => candidate.macros.some((macro) => macro.id === macroId))
    if (group === undefined) return
    const groupIds = group.macros.map((macro) => macro.id)
    const movedIds = moveSharedMacro(groupIds, macroId, direction)
    if (movedIds === groupIds) return
    const queue = [...movedIds]
    const members = new Set(groupIds)
    const nextIds = macros.map((macro) => (members.has(macro.id) ? (queue.shift() as string) : macro.id))
    if (nextIds.every((id, index) => id === macros[index]?.id)) return
    onReorder(nextIds)
  }

  const startRename = (category: string) => {
    setRenaming(category)
    setRenameText(category)
  }

  const commitRename = () => {
    if (renaming === null) return
    onRenameCategory(renaming, renameText)
    setRenaming(null)
  }

  const isMacroDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes(MACRO_DRAG_TYPE)

  const onDragStart = (event: DragEvent<HTMLElement>, macroId: string) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(MACRO_DRAG_TYPE, macroId)
  }

  const onDragOverTarget = (event: DragEvent<HTMLElement>, key: string) => {
    if (!isMacroDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(key)
  }

  const onDropOnTarget = (event: DragEvent<HTMLElement>, target: DropTarget) => {
    if (!isMacroDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(null)
    const macroId = event.dataTransfer.getData(MACRO_DRAG_TYPE)
    if (macroId.length === 0 || ('beforeMacroId' in target && target.beforeMacroId === macroId)) return
    onMoveMacro(macroId, target)
  }

  return (
    <section className="settings-nav-group macro-library" data-shared-route-body="macro-library">
      <div className="settings-sidebar-header">
        <div className="settings-brand macro-library-brand">
          <h1>Macros</h1>
          <span className="settings-status" title={`${macros.length} macros`}>{isLoading ? '' : macros.length}</span>
        </div>
        <div className="settings-search-container">
          <input
            className="settings-search-input"
            type="search"
            placeholder="Filter macros"
            aria-label="Filter macros"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </div>
      </div>
      <p id="shared-macro-reorder-help" className="sr-only">
        Drag a macro to reorder it or to move it to another category, or use Alt+Up Arrow and Alt+Down Arrow on a macro.
      </p>
      <div
        className="settings-nav macro-library-list"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null)
        }}
        onDragEnd={() => setDropTarget(null)}
      >
        {groups.map((group) => {
          const key = `category:${group.category}`
          const showHeader = canManageCategories || group.category !== ''
          return (
            <div key={key} className="macro-library-group" data-macro-category={group.category}>
              {showHeader ? (
                <div
                  className={`settings-nav-group-title macro-library-category${dropTarget === key ? ' macro-library-category--drop' : ''}`}
                  onDragOver={(event) => onDragOverTarget(event, key)}
                  onDrop={(event) => onDropOnTarget(event, { category: group.category })}
                >
                  {group.category !== '' && renaming === group.category ? (
                    <input
                      autoFocus
                      className="settings-input-text macro-library-category-input"
                      aria-label="Category name"
                      value={renameText}
                      maxLength={64}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenameText(event.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitRename()
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          event.stopPropagation()
                          setRenaming(null)
                        }
                      }}
                    />
                  ) : (
                    <>
                      <span
                        className="macro-library-category-name"
                        title={group.category === '' ? undefined : 'Double-click to rename'}
                        onDoubleClick={() => {
                          if (group.category !== '') startRename(group.category)
                        }}
                      >
                        {group.category === '' ? 'No category' : group.category}
                      </span>
                      {group.category !== '' ? (
                        <span className="macro-library-category-actions">
                          <button type="button" aria-label={`New macro in ${group.category}`} title={`New macro in ${group.category}`} onClick={() => onCreate(group.category)}>+</button>
                          <button type="button" aria-label={`Rename category ${group.category}`} title="Rename category" onClick={() => startRename(group.category)}>✎</button>
                          <button type="button" aria-label={`Remove category ${group.category}`} title="Remove category and keep its macros" onClick={() => onRemoveCategory(group.category)}>✕</button>
                        </span>
                      ) : null}
                      <span className="macro-library-category-count">{group.macros.length}</span>
                    </>
                  )}
                </div>
              ) : null}
              {group.macros.length === 0 ? (
                <div
                  className={`macro-library-empty-category${dropTarget === key ? ' macro-library-category--drop' : ''}`}
                  onDragOver={(event) => onDragOverTarget(event, key)}
                  onDrop={(event) => onDropOnTarget(event, { category: group.category })}
                >
                  Empty. Drag a macro here.
                </div>
              ) : (
                <ul className="settings-reorder-group">
                  {group.macros.map((macro) => (
                    <MacroLibraryItem
                      key={macro.id}
                      macro={macro}
                      isActive={macro.id === activeMacroId}
                      isDropTarget={dropTarget === `macro:${macro.id}`}
                      onMove={moveMacro}
                      onSelect={onSelect}
                      onDragStart={onDragStart}
                      onDragOverItem={(event, macroId) => onDragOverTarget(event, `macro:${macroId}`)}
                      onDropOnItem={(event, macroId) => onDropOnTarget(event, { beforeMacroId: macroId })}
                    />
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        {!isLoading && macros.length === 0 ? <p className="settings-empty-state">No macros yet.</p> : null}
        {!isLoading && macros.length > 0 && groups.every((group) => group.macros.length === 0) && filter.trim().length > 0 ? (
          <p className="settings-empty-state">No macro matches “{filter.trim()}”.</p>
        ) : null}
      </div>
      <div className="settings-sidebar-footer macro-library-footer">
        <button
          type="button"
          className="settings-secondary-button settings-secondary-button--small"
          disabled={isLoading}
          // A new macro starts beside the one being edited.
          onClick={() => onCreate(macros.find((macro) => macro.id === activeMacroId)?.category ?? '')}
        >
          New macro
        </button>
        {canManageCategories ? (
          <button
            type="button"
            className="settings-secondary-button settings-secondary-button--small"
            disabled={isLoading}
            onClick={() => {
              onFilterChange('')
              startRename(onCreateCategory())
            }}
          >
            New category
          </button>
        ) : null}
      </div>
    </section>
  )
}
