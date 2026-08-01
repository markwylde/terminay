import { Reorder, useDragControls } from 'framer-motion'
import type { KeyboardEvent } from 'react'

export type SharedMacroListItem = Readonly<{ id: string; title: string }>

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

function MacroLibraryItem({ macro, isActive, onMove, onSelect }: Readonly<{
  macro: SharedMacroListItem
  isActive: boolean
  onMove: (macroId: string, direction: -1 | 1) => void
  onSelect: (macroId: string) => void
}>) {
  const controls = useDragControls()
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    onMove(macro.id, event.key === 'ArrowUp' ? -1 : 1)
  }
  return (
    <Reorder.Item value={macro} className={`macro-nav-item${isActive ? ' macro-nav-item--active' : ''}`} dragListener={false} dragControls={controls}>
      <div className="macro-nav-item-inner">
        <div className="macro-nav-item-drag-handle" onPointerDown={(event) => controls.start(event)}>⋮⋮</div>
        <button
          type="button"
          className="macro-nav-item-button"
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          aria-describedby="shared-macro-reorder-help"
          onClick={() => onSelect(macro.id)}
          onKeyDown={onKeyDown}
        >
          {macro.title}
        </button>
      </div>
    </Reorder.Item>
  )
}

/** Host-neutral macro library chrome. Editing, execution, secrets, and persistence stay with the host route. */
export function SharedMacroLibraryPane({
  activeMacroId,
  isLoading,
  macros,
  onCreate,
  onReorder,
  onSelect,
}: Readonly<{
  activeMacroId: string | null
  isLoading: boolean
  macros: readonly SharedMacroListItem[]
  onCreate: () => void
  onReorder: (orderedMacroIds: readonly string[]) => void
  onSelect: (macroId: string) => void
}>) {
  const moveMacro = (macroId: string, direction: -1 | 1) => {
    const nextIds = moveSharedMacro(macros.map((macro) => macro.id), macroId, direction)
    if (nextIds.every((id, index) => id === macros[index]?.id)) return
    onReorder(nextIds)
  }

  return (
    <section className="settings-nav-group" data-shared-route-body="macro-library">
      <div className="settings-sidebar-header">
        <div className="settings-brand">
          <h1>Macros</h1>
          <p className="settings-status">Build reusable automation steps.</p>
        </div>
        <button type="button" className="settings-primary-button" onClick={onCreate}>New Macro</button>
      </div>
      <div className="settings-nav-group-title">Library</div>
      <p id="shared-macro-reorder-help" className="settings-status">
        Drag to reorder, or use Alt+Up Arrow and Alt+Down Arrow on a macro.
      </p>
      <Reorder.Group axis="y" values={macros as SharedMacroListItem[]} onReorder={(items) => onReorder(items.map((item) => item.id))} className="settings-reorder-group">
        {macros.map((macro) => <MacroLibraryItem key={macro.id} macro={macro} isActive={macro.id === activeMacroId} onMove={moveMacro} onSelect={onSelect} />)}
      </Reorder.Group>
      {!isLoading && macros.length === 0 ? <p className="settings-empty-state">No macros yet.</p> : null}
    </section>
  )
}
