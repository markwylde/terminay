import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('xterm context menu exposes selection, paste, and hovered-link clipboard actions', async () => {
  const panel = await readFile(new URL('src/components/TerminalPanel.tsx', root), 'utf8')

  assert.match(panel, /root\.addEventListener\('contextmenu', openTerminalContextMenu\)/u)
  assert.match(panel, /hasSelection: terminal\.hasSelection\(\)/u)
  assert.match(panel, /label: 'Copy'/u)
  assert.match(panel, /label: 'Paste'/u)
  assert.match(panel, /label: 'Copy Link'/u)
  assert.match(panel, /hoveredLinkRef\.current = uri/u)
  assert.match(panel, /copyContextMenuLink\(terminalContextMenu\.link as string\)/u)
  assert.match(panel, /root\.removeEventListener\('contextmenu', openTerminalContextMenu\)/u)
})
