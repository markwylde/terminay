import assert from 'node:assert/strict'
import test from 'node:test'
import {
  droppedFileSources,
  getTerminalDropText,
  shouldInterceptTerminalDrop,
  uploadTerminalDropFiles,
  type TerminalDropData,
} from './terminalDropInteraction.ts'

function file(name: string, contents: string) {
  const bytes = new TextEncoder().encode(contents)
  return {
    name,
    size: bytes.byteLength,
    slice: (start: number, end: number) => ({
      arrayBuffer: async () => bytes.slice(start, end).buffer,
    }),
  }
}

function drop(types: string[], files: unknown[] = [], data: Record<string, string> = {}): TerminalDropData {
  return { types, files, getData: (format) => data[format] ?? '' }
}

test('an OS file drop is always claimed, so an unservable one fails visibly', () => {
  assert.equal(shouldInterceptTerminalDrop(drop(['Files'], [file('a', 'x')])), true)
  assert.equal(shouldInterceptTerminalDrop(drop(['text/plain'], [], { 'text/plain': 'hello' })), false)
})

test('without a native resolver a File drop yields no client path', () => {
  assert.equal(getTerminalDropText(drop(['Files'], [file('a', 'x')])), null)
  assert.equal(
    getTerminalDropText(drop(['Files'], [file('a', 'x')]), () => '/Users/me/a'),
    "'/Users/me/a'",
  )
})

test('uploaded files are inserted as shell-escaped server paths, read in parts', async () => {
  const reads: Array<[number, number, number]> = []
  const text = await uploadTerminalDropFiles(
    [file("it's.png", 'abcdef'), file('b.txt', 'hi')],
    async (files, readPart) => {
      assert.deepEqual(files, [{ name: "it's.png", size: 6 }, { name: 'b.txt', size: 2 }])
      const first = await readPart(0, 2, 3)
      reads.push([0, 2, 3])
      assert.equal(new TextDecoder().decode(first), 'cde')
      return ["/tmp/terminay-drops/x/it_s.png", '/tmp/terminay-drops/x/b.txt']
    },
  )
  assert.equal(text, "'/tmp/terminay-drops/x/it_s.png' '/tmp/terminay-drops/x/b.txt'")
  assert.deepEqual(reads, [[0, 2, 3]])
})

test('an upload failure propagates and nothing is returned to insert', async () => {
  await assert.rejects(() =>
    uploadTerminalDropFiles([file('a', 'x')], async () => {
      throw new Error('server refused')
    }),
  )
})

test('a dropped folder is detected from the drop items', () => {
  const items = {
    length: 2,
    0: { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
    1: { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) },
  }
  const result = droppedFileSources([file('a', 'x'), file('folder', '')], items)
  assert.equal(result.hasFolder, true)
  assert.equal(result.files.length, 2)
  assert.equal(droppedFileSources([file('a', 'x')]).hasFolder, false)
})
