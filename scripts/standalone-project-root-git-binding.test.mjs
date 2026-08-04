import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const cli = await readFile('apps/terminay-server/src/cli.ts', 'utf8')
const desktopAuthority = await readFile('electron/serverTerminalAuthority.ts', 'utf8')
const processCwd = await readFile('apps/terminay-server/src/processCwd.ts', 'utf8')

test('standalone project root updates rebind the Git service', () => {
  assert.match(
    cli,
    /const gitService = new GitService\([\s\S]*?const files = createDefaultProjectFileServices\([\s\S]*?gitService,/u,
  )
  assert.match(
    cli,
    /function createDefaultProjectFileServices\([\s\S]*gitService: GitService/u,
  )

  const prepareProjectRootUpdate =
    cli.match(/prepareProjectRootUpdate: async \(projectId, root\) => \{[\s\S]*?\n\t\t\},\n\t\};/u)?.[0] ?? ''
  assert.ok(prepareProjectRootUpdate.length > 0, 'expected standalone root update implementation')
  assert.match(prepareProjectRootUpdate, /const canonicalRoot = await nextResolver\.root\(\)/u)
  assert.match(prepareProjectRootUpdate, /await gitService\.bindProject\(projectId, canonicalRoot\)/u)
  assert.match(prepareProjectRootUpdate, /sessionProjects\.set\(projectId/u)
  assert.match(prepareProjectRootUpdate, /contentProjects\.set\(projectId/u)
  assert.match(prepareProjectRootUpdate, /catalogProjects\.set\(projectId/u)
})

test('embedded desktop project root updates stay on the workspace and Git authority', () => {
  assert.match(
    desktopAuthority,
    /capabilities: \['terminal', 'workspace', 'files', 'agents', 'git'\]/u,
  )
  assert.match(desktopAuthority, /this\.git = new GitService\(\{\s*limits: \{/u)
  assert.match(desktopAuthority, /maxStatusEntries: 128/u)
  assert.match(desktopAuthority, /maxWorktrees: 128/u)
  assert.match(
    desktopAuthority,
    /workspaceOperations: \{\s*prepareProjectRootUpdate: \(projectId, root\) =>\s*this\.prepareProjectRootUpdate\(projectId, root\),\s*\}/u,
  )

  const prepareProjectRootUpdate =
    desktopAuthority.match(/private async prepareProjectRootUpdate\(projectId: string, root: string\) \{[\s\S]*?\n\t\}/u)?.[0] ?? ''
  assert.ok(prepareProjectRootUpdate.length > 0, 'expected embedded Desktop root update implementation')
  assert.match(prepareProjectRootUpdate, /const canonicalRoot = await resolver\.root\(\)/u)
  assert.match(prepareProjectRootUpdate, /commit: async \(\) => \{[\s\S]*await this\.git\.bindProject\(projectId, canonicalRoot\)/u)
  assert.match(prepareProjectRootUpdate, /this\.fileProjectRoots\.set\(projectId, canonicalRoot\)/u)
  assert.match(prepareProjectRootUpdate, /this\.fileCatalogProjects\.set\(projectId, context\)/u)
  assert.match(prepareProjectRootUpdate, /this\.fileContentProjects\.set\(projectId, contentContext\)/u)
})

test('standalone root-from-terminal uses live PTY cwd observation', () => {
  assert.match(cli, /import \{ resolveTerminalProcessCwd \} from '\.\/processCwd\.js'/u)
  assert.match(
    cli,
    /createNodePtyFactory\(nodePty as unknown as NodePtyModuleLike, \{\s*resolveCwd: resolveTerminalProcessCwd,\s*\}\)/u,
  )
  assert.match(processCwd, /export async function resolveTerminalProcessCwd/u)
  assert.match(processCwd, /resolveDeepestProcessPid/u)
  assert.match(processCwd, /process\.platform === 'linux'/u)
  assert.match(processCwd, /process\.platform === 'darwin'/u)
  assert.match(processCwd, /\/proc\/\$\{pid\}\/cwd/u)
  assert.match(processCwd, /\/usr\/sbin\/lsof/u)
})
