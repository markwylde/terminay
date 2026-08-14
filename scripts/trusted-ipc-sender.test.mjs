import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'

const directory = await mkdtemp(join(tmpdir(), 'terminay-trusted-ipc-'))
const output = join(directory, 'trustedIpcSender.mjs')
await build({ bundle: true, entryPoints: ['electron/trustedIpcSender.ts'], format: 'esm', logLevel: 'silent', outfile: output, platform: 'node' })
const { assertTrustedIpcSender } = await import(pathToFileURL(output).href)
test.after(async () => { await rm(directory, { recursive: true, force: true }) })

function event(url = 'file:///app/dist/index.html') {
  const mainFrame = { url }
  return { sender: { mainFrame }, senderFrame: mainFrame }
}
const options = { isKnownWindow: () => true, isAllowedNavigation: (url) => url.startsWith('file:///app/dist/') }

test('accepts only known top-level Terminay app renderer senders', () => {
  assert.doesNotThrow(() => assertTrustedIpcSender(event(), options))
  assert.throws(() => assertTrustedIpcSender({ ...event(), senderFrame: { url: 'file:///app/dist/index.html' } }, options), /top-level/u)
  assert.throws(() => assertTrustedIpcSender(event('https://attacker.example'), options), /application origin/u)
  assert.throws(() => assertTrustedIpcSender(event(), { ...options, isKnownWindow: () => false }), /registered BrowserWindow/u)
})

test('remaining privileged handlers enforce trusted renderer provenance first', async () => {
  const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
  const guardedChannels = [
    'test:create-server-terminal',
    'secrets:save',
    'secrets:get-decrypted',
    'test:get-mcp-control-environment',
    'test:send-app-command',
    'test:set-ai-tab-metadata-mock',
    'test:emit-agent-journal-record',
  ]

  for (const channel of guardedChannels) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      source,
      new RegExp(`ipcMain\\.(?:handle|on)\\(\\s*'${escaped}'[\\s\\S]{0,420}?assertTrustedAppSender\\(event\\)`),
      `${channel} must establish trusted top-level renderer provenance`,
    )
  }
})

test('all direct and modular privileged IPC registrations establish provenance', async () => {
  const registrations = [
    ['electron/main.ts', 'assertTrustedAppSender'],
    ['electron/fileViewer/ipc.ts', 'assertTrustedSender'],
  ]

  for (const [relativePath, assertion] of registrations) {
    const source = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8')
    const matcher = /ipcMain\.(?:handle|on)\(\s*(?:\n\s*)?'([^']+)'/gu
    const channels = [...source.matchAll(matcher)]
    assert.ok(channels.length > 0, `${relativePath} contains IPC registrations`)
    for (const registration of channels) {
      const channel = registration[1]
      const channelAssertion = assertion
      const offset = registration.index ?? 0
      const nextRegistration = source.indexOf('ipcMain.', offset + registration[0].length)
      let handler = source.slice(offset, nextRegistration === -1 ? undefined : nextRegistration)
      const namedListener = handler.match(
        new RegExp(
          `ipcMain\\.on\\(\\s*'${channel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}'\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\)`,
          'u',
        ),
      )?.[1]
      if (namedListener !== undefined) {
        const listenerDeclaration = source.lastIndexOf(
          `const ${namedListener} =`,
          offset,
        )
        if (listenerDeclaration !== -1) {
          handler = source.slice(
            listenerDeclaration,
            nextRegistration === -1 ? undefined : nextRegistration,
          )
        }
      }
      assert.match(
        handler,
        new RegExp(`${channelAssertion}\\(event\\)`),
        `${relativePath} ${channel} establishes trusted renderer provenance`,
      )
    }
  }
})

test('privileged IPC registration modules require the trusted sender before services run', async () => {
  const modules = [
    ['electron/fileViewer/ipc.ts', ['file:get-info', 'file:read-bytes', 'file:read-text', 'file:save', 'file:get-text-metadata', 'file:read-text-lines', 'file:save-sparse', 'file:watch', 'file:unwatch', 'file:get-preview-source', 'file:get-git-repo-info', 'file:get-git-diff']],
  ]
  for (const [file, channels] of modules) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /assertTrustedSender: \(event: IpcMainInvokeEvent\) => void/u, `${file} accepts the assertion dependency`)
    for (const channel of channels) {
      const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.match(source, new RegExp(`ipcMain\\.handle\\(\\s*'${escaped}'[\\s\\S]{0,420}?assertTrustedSender\\(event\\)`), `${channel} checks provenance before handling`)
    }
  }
})

