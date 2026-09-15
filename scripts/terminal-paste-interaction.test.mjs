import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'

const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-terminal-paste-interaction-'))
const outputPath = join(outputDirectory, 'terminalPasteInteraction.mjs')

await build({
  bundle: true,
  entryPoints: ['src/components/terminalPasteInteraction.ts'],
  format: 'esm',
  outfile: outputPath,
  platform: 'node',
})

const {
  createTerminalPasteActivation,
  describeClipboardFailure,
  pasteOrMaterializeTerminalClipboard,
  pasteTerminalClipboard,
  preferTerminalClipboardContents,
  readBrowserTerminalClipboard,
  readPasteEventClipboard,
  shouldClaimBrowserImagePaste,
  shouldHandleTerminalPasteShortcut,
} = await import(pathToFileURL(outputPath).href)

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

test.after(async () => {
  await rm(outputDirectory, { recursive: true, force: true })
})

test('terminal paste sends non-empty clipboard text through xterm and announces one input', async () => {
  const pasted = []
  let announcements = 0
  let focusCalls = 0

  const handled = await pasteTerminalClipboard(
    async () => 'printf hello',
    {
      announceInput: () => { announcements += 1 },
      paste: (text) => { pasted.push(text) },
      focus: () => { focusCalls += 1 },
    },
  )

  assert.equal(handled, true)
  assert.deepEqual(pasted, ['printf hello'])
  assert.equal(announcements, 1)
  assert.equal(focusCalls, 0)
})

test('terminal paste ignores empty or non-text clipboard values without announcing input', async () => {
  for (const value of ['', null, { text: 'not text' }]) {
    const pasted = []
    let announcements = 0
    const handled = await pasteTerminalClipboard(
      async () => value,
      {
        announceInput: () => { announcements += 1 },
        paste: (text) => { pasted.push(text) },
        focus: () => {},
      },
    )

    assert.equal(handled, false)
    assert.deepEqual(pasted, [])
    assert.equal(announcements, 0)
  }
})

test('terminal paste recovers from clipboard and xterm failures so the next paste can proceed', async () => {
  let focusCalls = 0
  let fail = true
  const pasted = []
  const options = {
    announceInput: () => {},
    paste: (text) => {
      if (fail) throw new Error('xterm unavailable')
      pasted.push(text)
    },
    focus: () => { focusCalls += 1 },
  }

  assert.equal(await pasteTerminalClipboard(async () => 'first', options), false)
  fail = false
  assert.equal(await pasteTerminalClipboard(async () => 'second', options), true)
  assert.deepEqual(pasted, ['second'])
  assert.equal(focusCalls, 1)
})

test('handles macOS Cmd+V through the Desktop smart clipboard bridge', () => {
  assert.equal(
    shouldHandleTerminalPasteShortcut(
      { altKey: false, ctrlKey: false, key: 'v', metaKey: true, shiftKey: false },
      true,
      true,
    ),
    true,
  )
})

test('leaves macOS Cmd+V to the browser when the Desktop bridge is unavailable', () => {
  assert.equal(
    shouldHandleTerminalPasteShortcut(
      { altKey: false, ctrlKey: false, key: 'v', metaKey: true, shiftKey: false },
      true,
      false,
    ),
    false,
  )
})

test('continues to handle the terminal-specific Ctrl+Shift+V shortcut in the renderer', () => {
  assert.equal(
    shouldHandleTerminalPasteShortcut(
      { altKey: false, ctrlKey: true, key: 'v', metaKey: false, shiftKey: true },
      true,
      true,
    ),
    true,
  )
})

test('prefers non-empty text over a clipboard image', () => {
  assert.deepEqual(
    preferTerminalClipboardContents('ls', { bytes: PNG, mimeType: 'image/png' }),
    { kind: 'text', text: 'ls' },
  )
  assert.equal(preferTerminalClipboardContents('', { bytes: PNG, mimeType: 'image/png' }).kind, 'image')
  assert.equal(preferTerminalClipboardContents(undefined, undefined).kind, 'empty')
})

test('reads an image-only ClipboardItem list from clipboard.read()', async () => {
  const clipboard = {
    async read() {
      return [
        {
          types: ['image/png'],
          async getType(type) {
            assert.equal(type, 'image/png')
            return new Blob([PNG], { type: 'image/png' })
          },
        },
      ]
    },
  }
  const contents = await readBrowserTerminalClipboard(clipboard)
  assert.equal(contents.kind, 'image')
  assert.equal(contents.mimeType, 'image/png')
  assert.deepEqual([...contents.bytes], [...PNG])
})

test('clipboard.read() with both text and image returns the text', async () => {
  const clipboard = {
    async read() {
      return [
        {
          types: ['text/plain', 'image/png'],
          async getType(type) {
            return type === 'text/plain'
              ? new Blob(['echo hi'], { type: 'text/plain' })
              : new Blob([PNG], { type: 'image/png' })
          },
        },
      ]
    },
  }
  assert.deepEqual(await readBrowserTerminalClipboard(clipboard), { kind: 'text', text: 'echo hi' })
})

test('denied clipboard.read() is empty after pasteOrMaterialize refocuses', async () => {
  let focusCalls = 0
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => {
      throw new Error('NotAllowedError')
    },
    {
      announceInput: () => {},
      paste: () => {},
      focus: () => { focusCalls += 1 },
      escapePath: (path) => path,
    },
  )
  assert.equal(handled, false)
  assert.equal(focusCalls, 1)
})

test('paste event with a PNG file is claimed on a browser terminal', async () => {
  const file = new File([PNG], 'screenshot.png', { type: 'image/png' })
  const event = {
    clipboardData: {
      files: [file],
      items: [],
      getData(type) {
        return type === 'text/plain' ? '' : ''
      },
    },
  }
  assert.equal(shouldClaimBrowserImagePaste(event, false), true)
  assert.equal(shouldClaimBrowserImagePaste(event, true), false)
  const contents = await readPasteEventClipboard(event)
  assert.equal(contents.kind, 'image')
  assert.equal(contents.mimeType, 'image/png')
})

test('paste event with text is not claimed as an image paste', () => {
  const event = {
    clipboardData: {
      files: [new File([PNG], 'screenshot.png', { type: 'image/png' })],
      items: [],
      getData(type) {
        return type === 'text/plain' ? 'ls\n' : ''
      },
    },
  }
  assert.equal(shouldClaimBrowserImagePaste(event, false), false)
})

test('materialises an image clipboard into an escaped server path', async () => {
  const pasted = []
  const uploads = []
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => ({ kind: 'image', bytes: PNG, mimeType: 'image/png' }),
    {
      announceInput: () => {},
      paste: (text) => { pasted.push(text) },
      focus: () => {},
      escapePath: (path) => `'${path.replaceAll("'", `'\\''`)}'`,
      materializeImage: async (image) => {
        uploads.push(image.mimeType)
        return "/tmp/terminay-clipboard/clipboard-1.png"
      },
    },
  )
  assert.equal(handled, true)
  assert.deepEqual(uploads, ['image/png'])
  assert.deepEqual(pasted, ["'/tmp/terminay-clipboard/clipboard-1.png'"])
})

test('upload failure reports and does not paste a path', async () => {
  const pasted = []
  let failed = 0
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => ({ kind: 'image', bytes: PNG, mimeType: 'image/png' }),
    {
      announceInput: () => {},
      paste: (text) => { pasted.push(text) },
      focus: () => {},
      escapePath: (path) => path,
      materializeImage: async () => {
        throw new Error('upload failed')
      },
      onImageUploadFailed: () => { failed += 1 },
    },
  )
  assert.equal(handled, false)
  assert.equal(failed, 1)
  assert.deepEqual(pasted, [])
})

test('a text-only clipboard host still pastes through readText()', async () => {
  const clipboard = {
    async readText() {
      return 'echo hi'
    },
  }
  assert.deepEqual(await readBrowserTerminalClipboard(clipboard), { kind: 'text', text: 'echo hi' })
})

test('a host exposing neither clipboard read route is empty rather than throwing', async () => {
  assert.deepEqual(await readBrowserTerminalClipboard({}), { kind: 'empty' })
  assert.deepEqual(await readBrowserTerminalClipboard(undefined), { kind: 'empty' })
})

test('a refused clipboard read reports its reason instead of failing silently', async () => {
  const failures = []
  let focusCalls = 0
  const denied = new DOMException('Read permission denied.', 'NotAllowedError')
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => {
      throw denied
    },
    {
      announceInput: () => {},
      paste: () => assert.fail('a refused clipboard must not paste'),
      focus: () => {
        focusCalls += 1
      },
      escapePath: (path) => path,
      onClipboardReadFailed: (error) => failures.push(error),
    },
  )
  assert.equal(handled, false)
  assert.equal(focusCalls, 1)
  assert.deepEqual(failures, [denied])
})

test('an empty clipboard stays silent, because there is no failure to report', async () => {
  const failures = []
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => ({ kind: 'empty' }),
    {
      announceInput: () => {},
      paste: () => assert.fail('an empty clipboard must not paste'),
      focus: () => {},
      escapePath: (path) => path,
      onClipboardReadFailed: (error) => failures.push(error),
    },
  )
  assert.equal(handled, false)
  assert.deepEqual(failures, [])
})

test('a clipboard failure is described with the name that identifies the refusal', () => {
  assert.equal(
    describeClipboardFailure(new DOMException('Read permission denied.', 'NotAllowedError')),
    'NotAllowedError: Read permission denied.',
  )
  assert.equal(describeClipboardFailure(new DOMException('', 'NotAllowedError')), 'NotAllowedError')
  assert.equal(describeClipboardFailure('nope'), 'the clipboard could not be read')
  assert.equal(describeClipboardFailure(new Error('a'.repeat(400))).length, 160)
})

test('a tap reads the clipboard from its pointerup and pastes only once', () => {
  let pastes = 0
  let clock = 5_000
  const activation = createTerminalPasteActivation(() => { pastes += 1 }, () => clock)

  activation.onPointerUp()
  assert.equal(pastes, 1, 'a touch grants its activation on pointerup, so read there')
  clock += 30
  activation.onClick()
  assert.equal(pastes, 1, 'the click closing the same tap must not paste again')
})

test('a button activated without a pointer still pastes', () => {
  let pastes = 0
  const activation = createTerminalPasteActivation(() => { pastes += 1 }, () => 5_000)
  activation.onClick()
  assert.equal(pastes, 1)
})

test('an abandoned tap does not swallow a later activation', () => {
  let pastes = 0
  let clock = 5_000
  const activation = createTerminalPasteActivation(() => { pastes += 1 }, () => clock)

  // A tap that drags away never produces its click, leaving the latch set.
  activation.onPointerUp()
  assert.equal(pastes, 1)
  clock += 60_000
  activation.onClick()
  assert.equal(pastes, 2, 'a stale latch must expire rather than eat a real click')
})

test('consecutive taps each paste once', () => {
  let pastes = 0
  let clock = 5_000
  const activation = createTerminalPasteActivation(() => { pastes += 1 }, () => clock)

  for (let tap = 0; tap < 3; tap += 1) {
    activation.onPointerUp()
    clock += 20
    activation.onClick()
    clock += 2_000
  }
  assert.equal(pastes, 3)
})

test('a refused read routes to the fallback sheet instead of a terminal error', async () => {
  let fallbackOpened = 0
  const handled = await pasteOrMaterializeTerminalClipboard(
    async () => {
      throw new DOMException('Read permission denied.', 'NotAllowedError')
    },
    {
      announceInput: () => {},
      paste: () => assert.fail('a refused clipboard must not paste'),
      focus: () => {},
      escapePath: (path) => path,
      onClipboardReadFailed: () => { fallbackOpened += 1 },
    },
  )
  assert.equal(handled, false)
  assert.equal(fallbackOpened, 1, 'the closed route must offer the open one exactly once')
})

test('a native paste event from the fallback field carries an image through upload', async () => {
  const pasted = []
  const event = {
    clipboardData: {
      getData: () => '',
      files: [new File([PNG], 'shot.png', { type: 'image/png' })],
      items: [],
    },
  }
  const handled = await pasteOrMaterializeTerminalClipboard(
    () => readPasteEventClipboard(event),
    {
      announceInput: () => {},
      paste: (text) => pasted.push(text),
      focus: () => {},
      escapePath: (path) => `'${path}'`,
      materializeImage: async (image) => {
        assert.equal(image.mimeType, 'image/png')
        assert.deepEqual([...image.bytes], [...PNG])
        return '/tmp/terminay-clipboard/clipboard-9.png'
      },
    },
  )
  assert.equal(handled, true)
  assert.deepEqual(pasted, ["'/tmp/terminay-clipboard/clipboard-9.png'"])
})
