import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const webEntrySource = await readFile(new URL('../src/web/main.tsx', import.meta.url), 'utf8')
const webStyleSource = await readFile(new URL('../src/web/index.css', import.meta.url), 'utf8')

test('disconnected web host renders Terminay shell with connect modal, not the old Connections page', () => {
  assert.match(webEntrySource, /className="browser-host-shell"/u)
  assert.match(webEntrySource, /data-web-host-shell="terminay"/u)
  assert.match(webEntrySource, /role="dialog"/u)
  assert.match(webEntrySource, /aria-modal="true"/u)
  assert.match(webEntrySource, /const connectModalRef = useRef<HTMLElement \| null>\(null\)/u)
  assert.match(webEntrySource, /modal\.addEventListener\('keydown', handleKeyDown\)/u)
  assert.match(webEntrySource, /event\.key !== 'Tab'/u)
  assert.match(webEntrySource, /last\.focus\(\)/u)
  assert.match(webEntrySource, /first\.focus\(\)/u)
  assert.match(webEntrySource, />Connect to Remote Server</u)
  assert.match(webEntrySource, /Browser host · no Local server/u)
  assert.match(webEntrySource, /placeholder="https:\/\/\.\.\. or http:\/\/localhost:4317\/#pairingToken=\.\.\."/u)
  assert.doesNotMatch(webEntrySource, /<h1>Connections<\/h1>/u)
  assert.doesNotMatch(webEntrySource, /Choose a Terminay Server to open its workspace\./u)
  assert.doesNotMatch(webEntrySource, /className="web-shell"/u)
})

test('disconnected web shell styles preserve an app-like workspace behind the modal', () => {
  assert.match(webStyleSource, /\.browser-host-titlebar/u)
  assert.match(webStyleSource, /\.browser-project-tab--active/u)
  assert.match(webStyleSource, /\.browser-host-workspace/u)
  assert.match(webStyleSource, /\.browser-host-empty-terminal/u)
  assert.match(webStyleSource, /\.connect-modal-backdrop/u)
  assert.match(webStyleSource, /\.connect-modal/u)
  assert.doesNotMatch(webStyleSource, /\.web-shell/u)
  assert.doesNotMatch(webStyleSource, /\.connection-card/u)
})

test('archived web profiles are recoverable without advertising an unavailable open action', () => {
  assert.match(webEntrySource, /function restoreConnection\(profileId: string\)/u)
  assert.match(webEntrySource, /host\.unarchive\(profileId\)/u)
  assert.match(webEntrySource, /profile\.archived === true \? \(/u)
  assert.match(webEntrySource, />Restore<\/button>/u)
  assert.doesNotMatch(
    webEntrySource,
    /profile\.archived === true \? \([\s\S]*?openConnection\(profile\.id\)[\s\S]*?\) :/u,
  )
})
