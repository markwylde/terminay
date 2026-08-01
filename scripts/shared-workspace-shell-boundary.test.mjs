import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const shellSource = await readFile(
  new URL('../src/shared/ResponsiveWorkspaceShell.tsx', import.meta.url),
  'utf8',
)
const shellStyleSource = await readFile(
  new URL('../src/shared/ResponsiveWorkspaceShell.css', import.meta.url),
  'utf8',
)

const forbiddenHostCouplings = [
  /@xterm/u,
  /electron/u,
  /node:/u,
  /window\./u,
  /document\./u,
  /HttpByteTransport/u,
  /TerminayClient/u,
  /TerminayTerminal/u,
  /WebConnectionHost/u,
  /WEB_MANAGER_ORIGIN/u,
  /localhost:4317/u,
  /127\.0\.0\.1/u,
]

test('shared workspace shell stays host and transport independent', () => {
  assert.match(shellSource, /from '@terminay\/responsive-ui'/u)
  assert.match(shellSource, /data-shared-ui="responsive-workspace"/u)
  assert.match(shellSource, /data-shared-route-registry=\{shell\.routes\.map/u)
  assert.match(shellSource, /data-shared-region="terminal"/u)
  assert.match(shellSource, /routeEnabled = route => route\.route === shell\.route\.route/u)
  assert.match(shellSource, /onRouteSelect\?: \(route: SharedWorkspaceRouteEntry\) => void/u)

  for (const pattern of forbiddenHostCouplings) {
    assert.doesNotMatch(shellSource, pattern)
  }
})

test('shared workspace shell defines responsive wide, medium, and narrow chrome styles', () => {
  assert.match(shellStyleSource, /\.shared-workspace-frame/u)
  assert.match(shellStyleSource, /grid-template-columns:\s*220px minmax\(0, 1fr\)/u)
  assert.match(
    shellStyleSource,
    /@media \(min-width: 721px\) and \(max-width: 1099px\)[\s\S]*\.workspace-shell--medium[\s\S]*grid-template-columns:\s*minmax\(10rem, 12rem\) minmax\(0, 1fr\)/u,
  )
  assert.match(
    shellStyleSource,
    /\.workspace-shell--medium \.shared-workspace-nav\s*\{[\s\S]*padding:\s*8px/u,
  )
  assert.match(shellStyleSource, /@media \(max-width: 720px\)/u)
  assert.match(shellStyleSource, /grid-template-columns:\s*1fr/u)
  assert.match(shellStyleSource, /\.shared-workspace-nav\s*\{[\s\S]*display:\s*flex/u)
  assert.match(shellStyleSource, /\.terminal-card/u)
})
