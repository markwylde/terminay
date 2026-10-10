import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-command-bar-macro-groups-'))
const outputPath = join(outputDirectory, 'CommandBar.mjs')

await build({
  bundle: true,
  entryPoints: ['src/workspace/CommandBar.tsx'],
  format: 'esm',
  jsx: 'automatic',
  outfile: outputPath,
  platform: 'node',
  target: 'node24',
  logLevel: 'silent',
})

const { filterCommandBarItems, groupCommandBarItems, macroCommandGroup, orderMacrosByCategory } = await import(outputPath)

test.after(async () => rm(outputDirectory, { force: true, recursive: true }))

const categories = ['Release', 'Commands', 'Empty']
const macros = [
  { id: 'say', title: 'Say thing', category: '' },
  { id: 'tag', title: 'Tag a release', category: 'Release' },
  { id: 'lint', title: 'Run lint', category: 'Commands' },
  { id: 'notes', title: 'Release notes', category: 'Release' },
  { id: 'stray', title: 'Stray', category: 'Deleted' },
]

function commandItem(id, group, title = id) {
  return { id, group, title, description: '', searchText: title.toLowerCase(), icon: null, onSelect() {} }
}

function macroItems() {
  return orderMacrosByCategory(macros, categories).map((macro) => ({
    ...commandItem(macro.id, '', macro.title),
    ...macroCommandGroup(macro.category, categories),
  }))
}

const shape = (groups) => groups.map((group) => [group.group, group.items.map(({ item }) => item.id)])

test('macro groups follow category order', () => {
  const items = [commandItem('new-terminal', 'Terminal'), commandItem('show-dashboard', 'Workspace'), ...macroItems()]
  assert.deepEqual(shape(groupCommandBarItems(items)), [
    ['Terminal', ['new-terminal']],
    ['Workspace', ['show-dashboard']],
    ['Release', ['tag', 'notes']],
    ['Commands', ['lint']],
    // No category, or a category that is no longer listed: the Macros group, last.
    ['Macros', ['say', 'stray']],
  ])
})

test('each macro group is one contiguous run of the flat list the keyboard moves through', () => {
  const items = [commandItem('new-terminal', 'Terminal'), ...macroItems()]
  const indexes = groupCommandBarItems(items).flatMap((group) => group.items.map(({ index }) => index))
  assert.deepEqual(indexes, [0, 1, 2, 3, 4, 5])
})

test('a category named like a built-in group does not merge with it', () => {
  const builtIn = ['Terminal', 'Workspace']
  const clashing = [{ id: 'm', title: 'Macro', category: 'Terminal' }]
  const items = [
    commandItem('new-terminal', 'Terminal'),
    { ...commandItem('m', '', 'Macro'), ...macroCommandGroup('Terminal', builtIn) },
  ]
  const groups = groupCommandBarItems(items)
  assert.equal(groups.length, 2)
  assert.deepEqual(shape(groups), [['Terminal', ['new-terminal']], ['Terminal', ['m']]])
  assert.notEqual(groups[0].key, groups[1].key)
  assert.equal(clashing.length, 1)
})

test('a category with no match is not shown', () => {
  const items = [commandItem('new-terminal', 'Terminal', 'New terminal'), ...macroItems()]
  assert.deepEqual(shape(groupCommandBarItems(filterCommandBarItems(items, 'release'))), [['Release', ['tag', 'notes']]])
  // An empty category never has an item, so it never has a group.
  assert.equal(groupCommandBarItems(items).some((group) => group.group === 'Empty'), false)
})

test('macros keep their saved order within a group when a search ranks them', () => {
  const items = macroItems()
  // "notes" scores higher on its title, but saved order within the group wins.
  assert.deepEqual(filterCommandBarItems(items, 'release').map((item) => item.id), ['tag', 'notes'])
})
