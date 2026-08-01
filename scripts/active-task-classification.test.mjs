import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  auditActiveTaskClassifications,
  classifyUncheckedItem,
} from './active-task-classification.mjs'

test('active task checklists contain no operational-only unchecked gates', async () => {
  const report = await auditActiveTaskClassifications()

  assert.ok(report.taskFiles.length > 0)
  assert.deepEqual(report.violations, [])
})

test('operational publication, deployment, runner, and evidence gates are classified', () => {
  const operationalOnly = [
    'Deploy the public host and verify its DNS.',
    'Deploy the hosted service to production.',
    'Publish signed Desktop artifacts.',
    'Publish verified standalone artifacts for every platform.',
    'Notarize the macOS package.',
    'Run the complete probes on native release runners.',
    'Collect physical evidence from supported devices.',
    'Record hosted evidence for the release.',
    'Produce native-runner evidence for both architectures.',
  ]

  for (const item of operationalOnly) {
    assert.equal(classifyUncheckedItem(item).operationalOnly, true, item)
  }
})

test('code-level build, test, and workflow contracts remain valid checklist work', () => {
  const codeLevel = [
    'Build and test the hosted deployment-order contract.',
    'Implement artifact publication verification.',
    'Add notarization workflow validation.',
    'Test native runner evidence parsing with deterministic fixtures.',
    'Create a physical-device capability model.',
    'Complete peer creation/signaling and production runtime integration.',
  ]

  for (const item of codeLevel) {
    assert.equal(classifyUncheckedItem(item).operationalOnly, false, item)
  }
})

test('wrapped operational-only checkbox titles fail with their source location', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'terminay-active-task-classification-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'specs/tasks'), { recursive: true })
  await writeFile(
    join(root, 'specs/tasks/example.md'),
    '- [ ] Publish signed Desktop artifacts for every supported\n  release architecture.\n',
  )

  const report = await auditActiveTaskClassifications(root)
  assert.deepEqual(
    report.violations.map(({ file, line, text }) => ({ file, line, text })),
    [{
      file: 'specs/tasks/example.md',
      line: 1,
      text: 'Publish signed Desktop artifacts for every supported release architecture.',
    }],
  )
})
