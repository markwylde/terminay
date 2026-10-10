import assert from 'node:assert/strict'
import test from 'node:test'

import {
  blocksToSteps,
  createMacroStep,
  detectInputNames,
  findSlashQuery,
  highlightScriptText,
  insertText,
  insertToken,
  matchStepMenu,
  removeToken,
  replaceSlashLine,
  stepsToBlocks,
  syncInputsWithSteps,
  unusedInputNames,
  updateTokenStep,
} from './macroScript.ts'
import type { MacroFieldDefinition, MacroStep } from './types/macros.ts'

const kinds = (steps: readonly MacroStep[]) => steps.map((step) => step.type)

test('every supported step type round-trips through the script', () => {
  const steps: MacroStep[] = [
    { id: 'a', type: 'type', content: 'sudo apt-get update' },
    { id: 'b', type: 'key', key: 'Enter' },
    { id: 'c', type: 'wait_inactivity', durationSeconds: '3' },
    { id: 'd', type: 'wait_time', durationSeconds: '{Delay}' },
    { id: 'e', type: 'select_line' },
    { id: 'f', type: 'type', content: 'line one\nline two' },
    { id: 'g', type: 'paste' },
  ]
  assert.deepEqual(blocksToSteps(stepsToBlocks(steps)), steps)
})

test('an unsupported step round-trips', () => {
  const steps: MacroStep[] = [
    { id: 'a', type: 'type', content: 'sudo deploy' },
    { id: 'b', type: 'unsupported', sourceType: 'secret' },
    { id: 'c', type: 'key', key: 'Enter' },
  ]
  assert.deepEqual(blocksToSteps(stepsToBlocks(steps)), steps)
})

test('a prompt is only text', () => {
  const blocks = stepsToBlocks([])
  assert.equal(blocks.length, 1)
  const edited = insertText(blocks, { blockIndex: 0, offset: 0 }, 'Create a pull request.')
  assert.deepEqual(kinds(blocksToSteps(edited.blocks)), ['type'])
  assert.equal((blocksToSteps(edited.blocks)[0] as { content: string }).content, 'Create a pull request.')
})

test('consecutive type steps load as one block and save as one step typing the same bytes', () => {
  const blocks = stepsToBlocks([
    { id: 'a', type: 'type', content: 'git commit -m "' },
    { id: 'b', type: 'type', content: '{{message}}"' },
  ])
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocksToSteps(blocks), [{ id: 'a', type: 'type', content: 'git commit -m "{{message}}"' }])
})

test('an empty block yields no step', () => {
  const blocks = stepsToBlocks([
    { id: 'a', type: 'key', key: 'Enter' },
    { id: 'b', type: 'wait_time', durationSeconds: '1' },
  ])
  // Text surrounds every token so the caret has somewhere to rest.
  assert.deepEqual(blocks.map((block) => block.kind), ['text', 'token', 'text', 'token', 'text'])
  assert.deepEqual(kinds(blocksToSteps(blocks)), ['key', 'wait_time'])
})

test('document order is run order', () => {
  let edit = insertText(stepsToBlocks([]), { blockIndex: 0, offset: 0 }, 'first')
  edit = insertToken(edit.blocks, edit.caret, createMacroStep('key', 'k'))
  edit = insertToken(edit.blocks, edit.caret, createMacroStep('wait_time', 'w'))
  edit = insertText(edit.blocks, edit.caret, 'second')
  assert.deepEqual(kinds(blocksToSteps(edit.blocks)), ['type', 'key', 'wait_time', 'type'])
})

test('a token inserted mid-document lands after the caret line and consumes its line break', () => {
  const blocks = stepsToBlocks([{ id: 'a', type: 'type', content: 'one\ntwo\nthree' }])
  const edit = insertToken(blocks, { blockIndex: 0, offset: 5 }, createMacroStep('key', 'k'))
  assert.deepEqual(blocksToSteps(edit.blocks).map((step) => (step.type === 'type' ? step.content : step.type)), [
    'one\ntwo',
    'key',
    'three',
  ])
  assert.deepEqual(edit.caret, { blockIndex: 2, offset: 0 })
})

test('the slash line is replaced by the chosen step', () => {
  const blocks = stepsToBlocks([{ id: 'a', type: 'type', content: 'run tests\n/wa\nthen report' }])
  const edit = replaceSlashLine(blocks, { blockIndex: 0, offset: 13 }, createMacroStep('wait_inactivity', 'w'))
  assert.deepEqual(blocksToSteps(edit.blocks).map((step) => (step.type === 'type' ? step.content : step.type)), [
    'run tests',
    'wait_inactivity',
    'then report',
  ])
})

test('removing a token keeps the text on both sides, on separate lines', () => {
  const blocks = stepsToBlocks([
    { id: 'a', type: 'type', content: 'before' },
    { id: 'b', type: 'key', key: 'Enter' },
    { id: 'c', type: 'type', content: 'after' },
  ])
  const edit = removeToken(blocks, 1)
  assert.deepEqual(blocksToSteps(edit.blocks), [{ id: 'a', type: 'type', content: 'before\nafter' }])
  assert.deepEqual(edit.caret, { blockIndex: 0, offset: 6 })

  const trailing = removeToken(stepsToBlocks([{ id: 'a', type: 'type', content: 'only' }, { id: 'b', type: 'key', key: 'Enter' }]), 1)
  assert.deepEqual(blocksToSteps(trailing.blocks), [{ id: 'a', type: 'type', content: 'only' }])
})

test('a token setting is edited in place', () => {
  const blocks = stepsToBlocks([{ id: 'w', type: 'wait_time', durationSeconds: '1' }])
  const next = updateTokenStep(blocks, 1, (step) => (step.type === 'wait_time' ? { ...step, durationSeconds: '2.5' } : step))
  assert.deepEqual(blocksToSteps(next), [{ id: 'w', type: 'wait_time', durationSeconds: '2.5' }])
})

test('the step menu claims a line only while it matches a step', () => {
  assert.deepEqual(findSlashQuery('/', 1), { lineStart: 0, query: '' })
  assert.deepEqual(findSlashQuery('hello\n/wa', 9), { lineStart: 6, query: 'wa' })
  // Not at the start of a line, not at the end of the line, or not just letters.
  assert.equal(findSlashQuery('cd /tmp', 4), null)
  assert.equal(findSlashQuery('/wa more', 3), null)
  assert.equal(findSlashQuery('/opsx:apply', 11), null)

  assert.deepEqual(matchStepMenu('').map((item) => item.type), ['key', 'wait_inactivity', 'wait_time', 'select_line'])
  assert.deepEqual(matchStepMenu('w').map((item) => item.type), ['wait_inactivity', 'wait_time'])
  // `/opsx:apply` and `/clear` are the user's own text: nothing matches as they are typed.
  assert.deepEqual(matchStepMenu('o'), [])
  assert.deepEqual(matchStepMenu('opsx'), [])
  assert.deepEqual(matchStepMenu('c'), [])
  assert.deepEqual(matchStepMenu('clear'), [])
})

test('inputs are detected from text, Eta tags and wait durations', () => {
  const steps: MacroStep[] = [
    { id: 'a', type: 'type', content: 'Deploy {{Name}} <%= env %>' },
    { id: 'b', type: 'wait_time', durationSeconds: '{Delay}' },
  ]
  assert.deepEqual(detectInputNames(steps), ['Name', 'env', 'Delay'])
})

function field(name: string, id: string): MacroFieldDefinition {
  return { id, name, label: name, type: 'text', required: true, description: '', placeholder: '', defaultValue: '', options: [] }
}

test('typing a placeholder adds an input', () => {
  const steps: MacroStep[] = [{ id: 'a', type: 'type', content: 'merge into {{target_branch}}' }]
  const synced = syncInputsWithSteps([], new Set(), steps)
  assert.equal(synced.fields.length, 1)
  assert.equal(synced.fields[0]?.name, 'target_branch')
  assert.equal(synced.fields[0]?.label, 'Target branch')
  assert.equal(synced.fields[0]?.type, 'text')
  assert.equal(synced.fields[0]?.required, true)
  assert.equal(synced.autoFieldIds.has(synced.fields[0]?.id ?? ''), true)
  // Syncing again changes nothing.
  assert.deepEqual(syncInputsWithSteps(synced.fields, synced.autoFieldIds, steps).fields, synced.fields)
})

test('an untouched input is removed when nothing references it', () => {
  const first = syncInputsWithSteps([], new Set(), [{ id: 'a', type: 'type', content: '{{branch}}' }])
  const after = syncInputsWithSteps(first.fields, first.autoFieldIds, [{ id: 'a', type: 'type', content: 'no inputs now' }])
  assert.deepEqual(after.fields, [])
  assert.equal(after.autoFieldIds.size, 0)
})

test('an edited or explicit input is kept as unused when nothing references it', () => {
  const steps: MacroStep[] = [{ id: 'a', type: 'type', content: 'no inputs now' }]
  // Loaded from the server, or edited by the user: not in the auto set.
  const explicit = [field('branch', 'f1')]
  const after = syncInputsWithSteps(explicit, new Set(), steps)
  assert.deepEqual(after.fields, explicit)
  assert.deepEqual([...unusedInputNames(after.fields, steps)], ['branch'])
  assert.deepEqual([...unusedInputNames(after.fields, [{ id: 'a', type: 'type', content: '{{branch}}' }])], [])
})

test('renaming a placeholder swaps an untouched input and keeps an edited one', () => {
  const first = syncInputsWithSteps([], new Set(), [{ id: 'a', type: 'type', content: '{{branch}}' }])
  const renamed: MacroStep[] = [{ id: 'a', type: 'type', content: '{{branches}}' }]
  assert.deepEqual(syncInputsWithSteps(first.fields, first.autoFieldIds, renamed).fields.map((item) => item.name), ['branches'])
  // Once edited, the old input is the user's to remove.
  assert.deepEqual(syncInputsWithSteps(first.fields, new Set(), renamed).fields.map((item) => item.name), ['branch', 'branches'])
})

test('placeholders and Eta tags are marked for highlighting', () => {
  assert.deepEqual(highlightScriptText('say {{Name}} <% if (x === 1) { %>y<% } %>'), [
    { text: 'say ', mark: false },
    { text: '{{Name}}', mark: true },
    { text: ' ', mark: false },
    { text: '<% if (x === 1) { %>', mark: true },
    { text: 'y', mark: false },
    { text: '<% } %>', mark: true },
  ])
  assert.deepEqual(highlightScriptText('plain'), [{ text: 'plain', mark: false }])
})
