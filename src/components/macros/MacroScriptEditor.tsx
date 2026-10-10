import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  blocksToSteps,
  createMacroStep,
  findSlashQuery,
  highlightScriptText,
  insertText,
  insertToken,
  MACRO_KEY_OPTIONS,
  matchStepMenu,
  removeToken,
  replaceSlashLine,
  stepsToBlocks,
  updateTokenStep,
  type InsertableStepType,
  type MacroScriptBlock,
  type MacroScriptCaret,
  type MacroScriptEdit,
  type MacroStepMenuItem,
  type MacroTokenStep,
} from '../../macroScript'
import type { MacroStep } from '../../types/macros'

const PLACEHOLDER =
  'Type what the macro should send. Use {{name}} to ask for a value, / to add a key press or a wait.'

type SlashMenu = {
  blockIndex: number
  lineStart: number
  items: MacroStepMenuItem[]
  activeIndex: number
}

type PendingFocus = MacroScriptCaret & { selectionEnd?: number }

function sameSteps(left: readonly MacroStep[], right: readonly MacroStep[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function HighlightedText({ text }: Readonly<{ text: string }>) {
  return (
    <>
      {highlightScriptText(text).map((part, index) =>
        part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  )
}

function TokenBody({
  step,
  onUpdate,
}: Readonly<{ step: MacroTokenStep; onUpdate: (update: (step: MacroTokenStep) => MacroTokenStep) => void }>) {
  switch (step.type) {
    case 'key':
      return (
        <>
          <span>Press</span>
          <select
            aria-label="Key to press"
            value={step.key}
            onChange={(event) => onUpdate((current) => (current.type === 'key' ? { ...current, key: event.target.value } : current))}
          >
            {MACRO_KEY_OPTIONS.some((option) => option.value === step.key) ? null : <option value={step.key}>{step.key}</option>}
            {MACRO_KEY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </>
      )
    case 'wait_time':
    case 'wait_inactivity':
      return (
        <>
          <span>{step.type === 'wait_time' ? 'Wait' : 'Wait until quiet for'}</span>
          <input
            type="text"
            aria-label={step.type === 'wait_time' ? 'Seconds to wait' : 'Seconds of quiet'}
            value={step.durationSeconds}
            placeholder="3 or {Delay}"
            spellCheck={false}
            onChange={(event) =>
              onUpdate((current) =>
                current.type === 'wait_time' || current.type === 'wait_inactivity'
                  ? { ...current, durationSeconds: event.target.value }
                  : current,
              )
            }
          />
          <span>seconds</span>
        </>
      )
    case 'select_line':
      return <span>Select current line</span>
    case 'paste':
      return <span>Paste clipboard. This step cannot run.</span>
    case 'unsupported':
      return <span>This step ({step.sourceType}) cannot run. Remove it to use the macro.</span>
  }
}

/**
 * A macro as one document. Text is what gets typed; every other step is a
 * token on its own line. Document order is run order. The parent owns the
 * steps; this component owns the caret and the blocks between saves.
 */
export function MacroScriptEditor({
  steps,
  onChange,
}: Readonly<{ steps: readonly MacroStep[]; onChange: (steps: MacroStep[]) => void }>) {
  const [blocks, setBlocks] = useState<MacroScriptBlock[]>(() => stepsToBlocks(steps))
  const [slash, setSlash] = useState<SlashMenu | null>(null)
  const [menuTop, setMenuTop] = useState(0)
  const textareas = useRef(new Map<string, HTMLTextAreaElement>())
  const marker = useRef<HTMLSpanElement | null>(null)
  const pendingFocus = useRef<PendingFocus | null>(null)
  const lastCaret = useRef<MacroScriptCaret | null>(null)

  // The steps changed underneath the editor: a discard, a save the server
  // normalised, or another macro's steps arriving under the same instance.
  useEffect(() => {
    setBlocks((current) => (sameSteps(blocksToSteps(current), steps) ? current : stepsToBlocks(steps)))
  }, [steps])

  useLayoutEffect(() => {
    const focus = pendingFocus.current
    if (focus === null) return
    pendingFocus.current = null
    const block = blocks[focus.blockIndex]
    const textarea = block ? textareas.current.get(block.id) : undefined
    if (textarea === undefined) return
    textarea.focus()
    textarea.setSelectionRange(focus.offset, focus.selectionEnd ?? focus.offset)
    lastCaret.current = { blockIndex: focus.blockIndex, offset: focus.offset }
  }, [blocks])

  useLayoutEffect(() => {
    if (slash !== null && marker.current !== null) setMenuTop(marker.current.offsetTop)
  }, [slash])

  const commit = useCallback(
    (next: MacroScriptBlock[], focus?: PendingFocus) => {
      if (focus !== undefined) pendingFocus.current = focus
      setBlocks(next)
      onChange(blocksToSteps(next))
    },
    [onChange],
  )

  const applyEdit = (edit: MacroScriptEdit) => {
    setSlash(null)
    commit(edit.blocks, edit.caret)
  }

  /** Where an insert control should act: the focused text, else where the caret last was, else the end. */
  const currentCaret = (): MacroScriptCaret => {
    const active = document.activeElement
    const focusedIndex = blocks.findIndex((block) => textareas.current.get(block.id) === active)
    if (focusedIndex !== -1 && active instanceof HTMLTextAreaElement) {
      return { blockIndex: focusedIndex, offset: active.selectionStart }
    }
    const last = lastCaret.current
    if (last !== null && blocks[last.blockIndex]?.kind === 'text') return last
    const end = blocks.length - 1
    const endBlock = blocks[end]
    return { blockIndex: end, offset: endBlock?.kind === 'text' ? endBlock.text.length : 0 }
  }

  const insertStep = (type: InsertableStepType) => applyEdit(insertToken(blocks, currentCaret(), createMacroStep(type)))

  const insertPlaceholder = () => {
    const caret = currentCaret()
    const edit = insertText(blocks, caret, '{{name}}')
    setSlash(null)
    // Leave `name` selected so the next keystrokes replace it.
    commit(edit.blocks, { blockIndex: edit.caret.blockIndex, offset: edit.caret.offset - 6, selectionEnd: edit.caret.offset - 2 })
  }

  const chooseSlashItem = (menu: SlashMenu, item: MacroStepMenuItem) => {
    const textarea = textareas.current.get(blocks[menu.blockIndex]?.id ?? '')
    const offset = textarea?.selectionStart ?? 0
    applyEdit(replaceSlashLine(blocks, { blockIndex: menu.blockIndex, offset }, createMacroStep(item.type)))
  }

  const onTextChange = (index: number, value: string, caret: number) => {
    const next = blocks.map((block, blockIndex) =>
      blockIndex === index && block.kind === 'text' ? { ...block, text: value } : block,
    )
    const query = findSlashQuery(value, caret)
    const items = query === null ? [] : matchStepMenu(query.query)
    setSlash(query !== null && items.length > 0 ? { blockIndex: index, lineStart: query.lineStart, items, activeIndex: 0 } : null)
    lastCaret.current = { blockIndex: index, offset: caret }
    commit(next)
  }

  const focusText = (index: number, offset: number) => {
    const block = blocks[index]
    const textarea = block ? textareas.current.get(block.id) : undefined
    if (textarea === undefined) return
    textarea.focus()
    textarea.setSelectionRange(offset, offset)
  }

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget
    if (slash !== null && slash.blockIndex === index) {
      const count = slash.items.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : count - 1
        setSlash({ ...slash, activeIndex: (slash.activeIndex + step) % count })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const item = slash.items[slash.activeIndex]
        if (item !== undefined) chooseSlashItem(slash, item)
        return
      }
      if (event.key === 'Escape') {
        // Stop here so the window's own Escape handling does not also fire.
        event.preventDefault()
        event.stopPropagation()
        setSlash(null)
        return
      }
    }
    const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0
    const atEnd = textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length
    if (event.key === 'Backspace' && atStart && index > 0) {
      event.preventDefault()
      applyEdit(removeToken(blocks, index - 1))
      return
    }
    if (event.key === 'ArrowUp' && atStart && index > 1) {
      event.preventDefault()
      const previous = blocks[index - 2]
      focusText(index - 2, previous?.kind === 'text' ? previous.text.length : 0)
      return
    }
    if (event.key === 'ArrowDown' && atEnd && index < blocks.length - 2) {
      event.preventDefault()
      focusText(index + 2, 0)
    }
  }

  let stepNumber = 0
  const lastIndex = blocks.length - 1

  return (
    <div className="settings-group macro-script">
      <div
        className="macro-script-document"
        onClick={(event) => {
          if (event.target !== event.currentTarget) return
          const end = blocks[lastIndex]
          focusText(lastIndex, end?.kind === 'text' ? end.text.length : 0)
        }}
      >
        {blocks.map((block, index) => {
          if (block.kind === 'token') {
            stepNumber += 1
            const blocked = block.step.type === 'unsupported' || block.step.type === 'paste'
            return (
              <div key={block.id} className="macro-script-block">
                <span className="macro-script-gutter" aria-hidden="true">{stepNumber}</span>
                <div>
                  <span className={`macro-token${blocked ? ' macro-token--blocked' : ''}`} data-step-type={block.step.type}>
                    <TokenBody step={block.step} onUpdate={(update) => commit(updateTokenStep(blocks, index, update))} />
                    <button
                      type="button"
                      className="macro-token-remove"
                      aria-label="Remove step"
                      title="Remove step"
                      onClick={() => applyEdit(removeToken(blocks, index))}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              </div>
            )
          }
          const hasText = block.text.length > 0
          if (hasText) stepNumber += 1
          const menu = slash !== null && slash.blockIndex === index ? slash : null
          const isGap = !hasText && index > 0 && index < lastIndex
          const menuId = `macro-step-menu-${block.id}`
          return (
            <div key={block.id} className={`macro-script-block${isGap ? ' macro-script-block--gap' : ''}`}>
              <span className="macro-script-gutter" aria-hidden="true">{hasText ? stepNumber : ''}</span>
              <div className="macro-script-text">
                <pre className="macro-script-highlight" aria-hidden="true">
                  {menu === null ? (
                    <HighlightedText text={block.text} />
                  ) : (
                    <>
                      <HighlightedText text={block.text.slice(0, menu.lineStart)} />
                      <span ref={marker} />
                      <HighlightedText text={block.text.slice(menu.lineStart)} />
                    </>
                  )}
                  {'​'}
                </pre>
                <textarea
                  ref={(element) => {
                    if (element === null) textareas.current.delete(block.id)
                    else textareas.current.set(block.id, element)
                  }}
                  rows={1}
                  value={block.text}
                  placeholder={index === 0 ? PLACEHOLDER : undefined}
                  aria-label="Text to type"
                  aria-controls={menu === null ? undefined : menuId}
                  aria-activedescendant={menu === null ? undefined : `${menuId}-${menu.activeIndex}`}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => onTextChange(index, event.target.value, event.target.selectionStart)}
                  onKeyDown={(event) => onKeyDown(index, event)}
                  onSelect={(event) => {
                    lastCaret.current = { blockIndex: index, offset: event.currentTarget.selectionStart }
                  }}
                  onBlur={() => setSlash(null)}
                />
                {menu === null ? null : (
                  <div className="macro-step-menu" id={menuId} role="listbox" aria-label="Insert a step" style={{ top: menuTop }}>
                    {menu.items.map((item, itemIndex) => (
                      <div
                        key={item.type}
                        id={`${menuId}-${itemIndex}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={itemIndex === menu.activeIndex}
                        className={`macro-step-menu-item${itemIndex === menu.activeIndex ? ' macro-step-menu-item--active' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseSlashItem(menu, item)}
                      >
                        <span>{item.label}</span>
                        <span className="macro-step-menu-hint">{item.hint}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Mouse-down is cancelled so the caret stays where the insert should land. */}
      <div className="settings-group-footer macro-script-insert" onMouseDown={(event) => event.preventDefault()}>
        <span>Insert</span>
        <button type="button" className="macro-insert-button" onClick={insertPlaceholder}>{'{{ input }}'}</button>
        <button type="button" className="macro-insert-button" onClick={() => insertStep('key')}>Press key</button>
        <button type="button" className="macro-insert-button" onClick={() => insertStep('wait_inactivity')}>Wait until quiet</button>
        <button type="button" className="macro-insert-button" onClick={() => insertStep('wait_time')}>Wait</button>
        <button type="button" className="macro-insert-button" onClick={() => insertStep('select_line')}>Select line</button>
        <span className="macro-script-insert-hint">or type <kbd>/</kbd> on a new line</span>
      </div>
    </div>
  )
}
