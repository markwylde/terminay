import { extractAllMacroPlaceholders } from './macroSettings.ts'
import type { MacroDefinition, MacroFieldDefinition, MacroStep } from './types/macros'

/**
 * The Macros window edits a macro as one script: runs of text with step tokens
 * between them. This module is the mapping between that document and the
 * stored `MacroStep[]`, and the edits the document supports. It is pure; the
 * server still normalises and owns whatever is saved.
 */

export type MacroTokenStep = Exclude<MacroStep, { type: 'type' }>

export type MacroScriptBlock =
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'token'; step: MacroTokenStep }

export type MacroScriptCaret = { blockIndex: number; offset: number }

export type MacroScriptEdit = { blocks: MacroScriptBlock[]; caret: MacroScriptCaret }

/** Step kinds a user can insert. `paste` and `unsupported` only ever come from stored data. */
export type InsertableStepType = 'key' | 'wait_time' | 'wait_inactivity' | 'select_line'

export type MacroStepMenuItem = {
  type: InsertableStepType
  label: string
  hint: string
  keywords: readonly string[]
}

export const MACRO_STEP_MENU: readonly MacroStepMenuItem[] = [
  { type: 'key', label: 'Press key', hint: 'Enter, Tab, Escape…', keywords: ['press', 'key', 'enter', 'tab', 'escape'] },
  { type: 'wait_inactivity', label: 'Wait until quiet', hint: 'no output for a while', keywords: ['wait', 'until', 'quiet', 'idle', 'inactivity'] },
  { type: 'wait_time', label: 'Wait', hint: 'fixed time', keywords: ['wait', 'time', 'sleep', 'pause'] },
  { type: 'select_line', label: 'Select current line', hint: '', keywords: ['select', 'line'] },
]

export const MACRO_KEY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'Enter', label: 'Enter' },
  { value: 'Tab', label: 'Tab' },
  { value: 'Escape', label: 'Escape' },
  { value: 'Backspace', label: 'Backspace' },
  { value: 'ArrowUp', label: 'Up Arrow' },
  { value: 'ArrowDown', label: 'Down Arrow' },
]

let idCounter = 0

/** Ids must satisfy the server's id pattern: a letter or digit, then letters, digits, `.`, `_`, `:` or `-`. */
export function createMacroScriptId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`
}

export function createMacroStep(type: InsertableStepType, id = createMacroScriptId('step')): MacroTokenStep {
  switch (type) {
    case 'key':
      return { id, type, key: 'Enter' }
    case 'wait_time':
      return { id, type, durationSeconds: '1' }
    case 'wait_inactivity':
      return { id, type, durationSeconds: '3' }
    case 'select_line':
      return { id, type }
  }
}

function textBlock(text: string, id = createMacroScriptId('step')): MacroScriptBlock {
  return { id, kind: 'text', text }
}

/**
 * Text always surrounds tokens: a text block exists at the start, at the end,
 * and between any two tokens, so the caret has somewhere to rest. Neighbouring
 * text blocks are merged.
 */
function withTextAroundTokens(blocks: readonly MacroScriptBlock[]): MacroScriptBlock[] {
  const result: MacroScriptBlock[] = []
  for (const block of blocks) {
    const last = result[result.length - 1]
    if (block.kind === 'text') {
      if (last?.kind === 'text') {
        result[result.length - 1] = { ...last, text: last.text + block.text }
      } else {
        result.push(block)
      }
      continue
    }
    if (last === undefined || last.kind !== 'text') result.push(textBlock(''))
    result.push(block)
  }
  if (result.length === 0 || result[result.length - 1]?.kind !== 'text') result.push(textBlock(''))
  return result
}

/**
 * Stored steps as a script. Consecutive `type` steps become one text block,
 * concatenated with nothing between them, which types the same bytes.
 */
export function stepsToBlocks(steps: readonly MacroStep[]): MacroScriptBlock[] {
  return withTextAroundTokens(
    steps.map((step): MacroScriptBlock =>
      step.type === 'type'
        ? { id: step.id, kind: 'text', text: step.content }
        : { id: step.id, kind: 'token', step },
    ),
  )
}

/** A script as stored steps. An empty text block is presentation only and yields no step. */
export function blocksToSteps(blocks: readonly MacroScriptBlock[]): MacroStep[] {
  const steps: MacroStep[] = []
  for (const block of blocks) {
    if (block.kind === 'token') {
      steps.push(block.step)
    } else if (block.text.length > 0) {
      steps.push({ id: block.id, type: 'type', content: block.text })
    }
  }
  return steps
}

function replaceBlocks(
  blocks: readonly MacroScriptBlock[],
  index: number,
  removeCount: number,
  replacement: readonly MacroScriptBlock[],
): MacroScriptBlock[] {
  const next = [...blocks]
  next.splice(index, removeCount, ...replacement)
  return next
}

/**
 * Put a token on its own line after the line the caret is on. The line break
 * that separated the two halves of the text is consumed: a token's line is
 * presentation and is not typed.
 */
export function insertToken(
  blocks: readonly MacroScriptBlock[],
  caret: MacroScriptCaret,
  step: MacroTokenStep,
): MacroScriptEdit {
  const block = blocks[caret.blockIndex]
  if (block === undefined || block.kind !== 'text') {
    const end = blocks.length - 1
    const last = blocks[end]
    return insertToken(blocks, { blockIndex: end, offset: last?.kind === 'text' ? last.text.length : 0 }, step)
  }
  const lineEnd = block.text.indexOf('\n', caret.offset)
  const cut = lineEnd === -1 ? block.text.length : lineEnd
  return splitAround(blocks, caret.blockIndex, block.text.slice(0, cut), block.text.slice(cut + 1), step)
}

/** Replace the `/query` line the caret is on with a token. */
export function replaceSlashLine(
  blocks: readonly MacroScriptBlock[],
  caret: MacroScriptCaret,
  step: MacroTokenStep,
): MacroScriptEdit {
  const block = blocks[caret.blockIndex]
  if (block === undefined || block.kind !== 'text') return { blocks: [...blocks], caret }
  const slash = findSlashQuery(block.text, caret.offset)
  if (slash === null) return insertToken(blocks, caret, step)
  const before = block.text.slice(0, slash.lineStart).replace(/\n$/, '')
  const after = block.text.slice(caret.offset).replace(/^\n/, '')
  return splitAround(blocks, caret.blockIndex, before, after, step)
}

function splitAround(
  blocks: readonly MacroScriptBlock[],
  blockIndex: number,
  before: string,
  after: string,
  step: MacroTokenStep,
): MacroScriptEdit {
  const original = blocks[blockIndex] as Extract<MacroScriptBlock, { kind: 'text' }>
  return {
    blocks: replaceBlocks(blocks, blockIndex, 1, [
      { ...original, text: before },
      { id: step.id, kind: 'token', step },
      textBlock(after),
    ]),
    caret: { blockIndex: blockIndex + 2, offset: 0 },
  }
}

/**
 * Remove the token at `tokenIndex`. The text before and after it were on
 * separate lines on screen, so they are joined with a line break.
 */
export function removeToken(blocks: readonly MacroScriptBlock[], tokenIndex: number): MacroScriptEdit {
  const token = blocks[tokenIndex]
  const before = blocks[tokenIndex - 1]
  const after = blocks[tokenIndex + 1]
  if (token?.kind !== 'token' || before?.kind !== 'text' || after?.kind !== 'text') {
    return { blocks: [...blocks], caret: { blockIndex: Math.max(0, tokenIndex - 1), offset: 0 } }
  }
  const joined = before.text.length > 0 && after.text.length > 0
    ? `${before.text}\n${after.text}`
    : before.text + after.text
  return {
    blocks: replaceBlocks(blocks, tokenIndex - 1, 3, [{ ...before, text: joined }]),
    caret: { blockIndex: tokenIndex - 1, offset: before.text.length },
  }
}

export function updateTokenStep(
  blocks: readonly MacroScriptBlock[],
  tokenIndex: number,
  update: (step: MacroTokenStep) => MacroTokenStep,
): MacroScriptBlock[] {
  return blocks.map((block, index) =>
    index === tokenIndex && block.kind === 'token' ? { ...block, step: update(block.step) } : block,
  )
}

/** Insert literal text (a placeholder, say) at the caret of a text block. */
export function insertText(
  blocks: readonly MacroScriptBlock[],
  caret: MacroScriptCaret,
  text: string,
): MacroScriptEdit {
  const block = blocks[caret.blockIndex]
  if (block === undefined || block.kind !== 'text') {
    const end = blocks.length - 1
    const last = blocks[end]
    return insertText(blocks, { blockIndex: end, offset: last?.kind === 'text' ? last.text.length : 0 }, text)
  }
  return {
    blocks: replaceBlocks(blocks, caret.blockIndex, 1, [
      { ...block, text: block.text.slice(0, caret.offset) + text + block.text.slice(caret.offset) },
    ]),
    caret: { blockIndex: caret.blockIndex, offset: caret.offset + text.length },
  }
}

/**
 * The step menu belongs to a line only while that line is `/` followed by
 * letters, with the caret at its end. Lines such as `/opsx:apply` are the
 * user's own text and must stay that way.
 */
export function findSlashQuery(text: string, caret: number): { lineStart: number; query: string } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const typed = text.slice(lineStart, caret)
  const atLineEnd = caret === text.length || text[caret] === '\n'
  if (!atLineEnd || !/^\/[A-Za-z]*$/.test(typed)) return null
  return { lineStart, query: typed.slice(1).toLowerCase() }
}

/** Steps whose name has a word starting with the query. An empty result means the line is plain text. */
export function matchStepMenu(query: string): MacroStepMenuItem[] {
  const normalized = query.toLowerCase()
  return MACRO_STEP_MENU.filter(
    (item) => normalized.length === 0 || item.keywords.some((keyword) => keyword.startsWith(normalized)),
  )
}

export function scriptHasUnsupportedStep(steps: readonly MacroStep[]): boolean {
  return steps.some((step) => step.type === 'unsupported')
}

/** Every input name the steps mention, in first-mention order. */
export function detectInputNames(steps: readonly MacroStep[]): string[] {
  return extractAllMacroPlaceholders({ steps } as unknown as MacroDefinition)
}

function labelFromName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name
}

export type MacroInputSync = {
  fields: MacroFieldDefinition[]
  /** Ids of inputs created by detection that the user has not edited since. */
  autoFieldIds: ReadonlySet<string>
}

/**
 * Keep the inputs in step with the script. A newly mentioned name gains an
 * input. An input detection created and the user never edited is dropped when
 * nothing mentions it; any other input is kept, for the user to remove.
 */
export function syncInputsWithSteps(
  fields: readonly MacroFieldDefinition[],
  autoFieldIds: ReadonlySet<string>,
  steps: readonly MacroStep[],
): MacroInputSync {
  const mentioned = detectInputNames(steps)
  const mentionedSet = new Set(mentioned)
  const kept = fields.filter((field) => mentionedSet.has(field.name) || !autoFieldIds.has(field.id))
  const known = new Set(kept.map((field) => field.name))
  const nextAuto = new Set([...autoFieldIds].filter((id) => kept.some((field) => field.id === id)))
  const next = [...kept]
  for (const name of mentioned) {
    if (known.has(name)) continue
    const id = createMacroScriptId('field')
    next.push({
      id,
      name,
      label: labelFromName(name),
      type: 'text',
      required: true,
      description: '',
      placeholder: '',
      defaultValue: '',
      options: [],
    })
    known.add(name)
    nextAuto.add(id)
  }
  return { fields: next, autoFieldIds: nextAuto }
}

/** Names of inputs that no step mentions. */
export function unusedInputNames(fields: readonly MacroFieldDefinition[], steps: readonly MacroStep[]): Set<string> {
  const mentioned = new Set(detectInputNames(steps))
  return new Set(fields.filter((field) => !mentioned.has(field.name)).map((field) => field.name))
}

/** Split text into literal runs and template marks, for the editor's highlight layer. */
export function highlightScriptText(text: string): { text: string; mark: boolean }[] {
  const parts = text.split(/({{\s*[^{}\n]+?\s*}}|<%[\s\S]*?%>)/g)
  return parts
    .map((part, index) => ({ text: part, mark: index % 2 === 1 }))
    .filter((part) => part.text.length > 0)
}
