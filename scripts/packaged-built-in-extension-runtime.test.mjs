import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { createClaudeFixtureDriver } from '@markwylde/all-your-agents/testing'
import {
  DirectoryBuiltInExtensionArtifactSource,
  ExtensionInstaller,
  ExtensionHostManager,
} from '../packages/server-core/dist/extensions/index.js'
import {
  AgentStatusService,
  ProjectAgentScope,
  SessionSourceBridge,
  SessionSourceSupervisor,
  TerminalActivityService,
} from '../packages/server-core/dist/index.js'

const AGENTS_ID = 'com.terminay.builtin-agents'
const AGENTS_PACKAGE = 'terminay-builtin-agents'
// Held back from the first install so a later bundle proves a newly
// bundled floor is default-enabled.
const LATE_BUNDLED_ID = 'com.terminay.language.typescript'
const OVERRIDE_VERSION = '9.9.9'
const OVERRIDE_INTEGRITY = `sha512-${Buffer.alloc(64, 9).toString('base64')}`
const AGENTS_SOURCE_ID = `${AGENTS_ID}/agents`

class FilteredBuiltIns {
  constructor(source, omitted = new Set()) {
    this.source = source
    this.omitted = omitted
  }
  async list(signal) {
    return (await this.source.list(signal)).filter((artifact) => !this.omitted.has(artifact.extensionId))
  }
  materialize(artifact, root, signal) {
    return this.source.materialize(artifact, root, signal)
  }
}

class CorruptOneBuiltIn extends FilteredBuiltIns {
  async materialize(artifact, root, signal) {
    await super.materialize(artifact, root, signal)
    if (artifact.extensionId === AGENTS_ID) {
      await writeFile(join(root, 'node_modules', AGENTS_PACKAGE, ...artifact.manifestMetadata.entrypoint.split('/')), 'tampered\n')
    }
  }
}

class OverrideRegistry {
  constructor(manifest) {
    this.manifest = manifest
    this.npmVersion = '12.0.2'
  }
  async resolve(packageName, selector) {
    assert.equal(packageName, AGENTS_PACKAGE)
    assert.equal(selector, OVERRIDE_VERSION)
    return {
      packageName,
      version: OVERRIDE_VERSION,
      integrity: OVERRIDE_INTEGRITY,
      tarballUrl: `https://registry.npmjs.org/${packageName}/-/${packageName}-${OVERRIDE_VERSION}.tgz`,
      manifestMetadata: this.manifest,
    }
  }
  async materialize(resolution, root) {
    const value = overrideTree(this.manifest, resolution.tarballUrl)
    for (const [path, body] of value.files) {
      const target = join(root, path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, body)
    }
  }
}

function overrideTree(manifest, tarballUrl) {
  const entrypoint = manifest.entrypoint
  const packageJson = JSON.stringify({
    name: AGENTS_PACKAGE,
    version: OVERRIDE_VERSION,
    type: 'module',
    exports: { '.': `./${entrypoint}` },
    terminay: manifest,
  })
  const source = 'export function activate() {}\n'
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': {},
      [`node_modules/${AGENTS_PACKAGE}`]: {
        version: OVERRIDE_VERSION,
        resolved: tarballUrl,
        integrity: OVERRIDE_INTEGRITY,
      },
    },
  })
  return { files: [
    ['package-lock.json', lock],
    [`node_modules/${AGENTS_PACKAGE}/package.json`, packageJson],
    [`node_modules/${AGENTS_PACKAGE}/${entrypoint}`, source],
  ] }
}

function active(state, extensionId) {
  const record = state.extensions[extensionId]
  assert.ok(record, `missing extension state for ${extensionId}`)
  return record.slots[record.activeSlotId]
}

async function exercisePackagedRoot(label, artifactRoot) {
  const source = new DirectoryBuiltInExtensionArtifactSource(resolve(artifactRoot))
  const artifacts = await source.list()
  assert.equal(artifacts.length, 2, `${label} must expose the complete built-in inventory`)
  const agentsArtifact = artifacts.find((artifact) => artifact.extensionId === AGENTS_ID)
  assert.ok(agentsArtifact)
  const registry = new OverrideRegistry(agentsArtifact.manifestMetadata)
  const dataRoot = await mkdtemp(join(tmpdir(), `terminay-${label}-built-ins-`))
  try {
    const initialSource = new FilteredBuiltIns(source, new Set([LATE_BUNDLED_ID]))
    let installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: initialSource })
    let state = await installer.initialize()
    assert.equal(Object.keys(state.extensions).length, 1)
    assert.ok(Object.values(state.extensions).every((record) => record.enabled))

    await installer.disable(AGENTS_ID)
    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: initialSource })
    state = await installer.initialize()
    assert.equal(state.extensions[AGENTS_ID].enabled, false, `${label} restart must preserve disablement`)

    const preview = await installer.preview(`${AGENTS_PACKAGE}@${OVERRIDE_VERSION}`)
    state = await installer.confirm(preview.previewDigest)
    assert.equal(active(state, AGENTS_ID).version, OVERRIDE_VERSION)
    assert.equal(state.extensions[AGENTS_ID].enabled, false)

    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    state = await installer.initialize()
    assert.equal(state.extensions[LATE_BUNDLED_ID].enabled, true, `${label} must default-enable a newly bundled floor`)
    assert.equal(active(state, AGENTS_ID).version, OVERRIDE_VERSION, `${label} must retain the npm override`)

    state = await installer.remove(AGENTS_ID)
    assert.equal(active(state, AGENTS_ID).version, agentsArtifact.version, `${label} removal must roll back to the packaged floor`)
    assert.equal(state.extensions[AGENTS_ID].enabled, false)
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }

  const badRoot = await mkdtemp(join(tmpdir(), `terminay-${label}-bad-built-in-`))
  try {
    const bad = new CorruptOneBuiltIn(source)
    const installer = new ExtensionInstaller({ dataRoot: badRoot, registryClient: registry, materializer: registry, builtIns: bad })
    const state = await installer.initialize()
    assert.equal(state.extensions[AGENTS_ID].state, 'failed')
    assert.equal(Object.values(state.extensions).filter((record) => record.state === 'failed').length, 1, JSON.stringify(state.extensions))
    assert.equal(Object.keys(state.extensions).length, 3)
  } finally {
    await rm(badRoot, { recursive: true, force: true })
  }
  return await readFile(join(resolve(artifactRoot), 'inventory.v1.json'))
}

async function startEnabled(installer, hosts, dataRoot) {
  for (const extensionId of await installer.enabledExtensionIds()) {
    const descriptor = await installer.launchDescriptor(extensionId)
    const root = join(dataRoot, 'extensions')
    const directories = {
      config: join(root, 'config', extensionId),
      data: join(root, 'data', extensionId),
      cache: join(root, 'cache', extensionId),
    }
    await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true })))
    await hosts.start({
      ...descriptor,
      configDirectory: directories.config,
      dataDirectory: directories.data,
      cacheDirectory: directories.cache,
      permissions: descriptor.manifest.permissions,
      agentSessionSources: descriptor.agentSessionSources,
      mcpInstallTargets: descriptor.mcpInstallTargets,
      languageServers: descriptor.languageServers,
      extensionDependencies: descriptor.manifest.extensionDependencies ?? [],
    })
  }
}

async function waitFor(assertion, label) {
  const deadline = Date.now() + 10_000
  let lastError
  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function exercisePackagedHostRuntime(label, artifactRoot) {
  const source = new DirectoryBuiltInExtensionArtifactSource(resolve(artifactRoot))
  const artifacts = await source.list()
  const agentsArtifact = artifacts.find((artifact) => artifact.extensionId === AGENTS_ID)
  assert.ok(agentsArtifact, `${label} must package the built-in agents extension`)
  const sessionSource = agentsArtifact.manifestMetadata.contributes.agentSessionSources?.find((contribution) => contribution.id === AGENTS_SOURCE_ID)
  assert.deepEqual(
    sessionSource?.harnesses.map((harness) => harness.id),
    ['claude-code', 'codex', 'grok', 'oh-my-pi'],
    `${label} must package the four library harnesses`,
  )
  assert.ok(sessionSource.environmentVariables.includes('CLAUDE_CONFIG_DIR'), `${label} must declare the harness home variables`)
  const registry = new OverrideRegistry(agentsArtifact.manifestMetadata)
  const dataRoot = await realpath(await mkdtemp(join(tmpdir(), `terminay-${label}-built-in-host-`)))
  const project = join(dataRoot, 'project')
  const claudeHome = join(dataRoot, 'claude-home')
  await mkdir(project, { recursive: true })
  const previousClaudeHome = process.env.CLAUDE_CONFIG_DIR
  // The declared home variable reaches the packaged child from the host environment.
  process.env.CLAUDE_CONFIG_DIR = claudeHome
  // A real process stands in for the agent so liveness comes from the OS.
  const agent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { stdio: 'ignore' })
  await new Promise((resolveSpawn) => agent.once('spawn', resolveSpawn))
  await createClaudeFixtureDriver(claudeHome, Date.now()).createLiveSession({
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pid: agent.pid,
    cwd: project,
    status: 'busy',
    title: 'Packaged Claude session',
  })
  let hosts
  let agentStatus
  let scope
  try {
    const activity = new TerminalActivityService({ serverId: `${label}-server` })
    agentStatus = new AgentStatusService({ activity })
    await agentStatus.start()
    scope = new ProjectAgentScope()
    scope.setProject(`${label}-project`, project)
    await scope.settled()
    const bridge = new SessionSourceBridge({ agents: agentStatus, scope })
    const supervisor = new SessionSourceSupervisor({ bridge, agents: agentStatus })
    const packagedEntries = () => Object.values(agentStatus.getSnapshotForProject(`${label}-project`).entries)
    const newHosts = () => {
      const created = new ExtensionHostManager({ broker: { async request() {} }, agents: supervisor })
      supervisor.attach(created)
      return created
    }
    let installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    hosts = newHosts()
    let state = await installer.initialize()
    const enabledByDefault = new Set(await installer.enabledExtensionIds())
    for (const artifact of artifacts) {
      assert.equal(enabledByDefault.has(artifact.extensionId), true, `${label} must enable ${artifact.extensionId} by default`)
    }
    await startEnabled(installer, hosts, dataRoot)
    assert.deepEqual(
      hosts.statuses().map((status) => [status.extensionId, status.state]),
      artifacts.map((artifact) => [artifact.extensionId, 'running']).sort((left, right) => left[0].localeCompare(right[0])),
      `${label} first run must activate every staged extension child`,
    )
    assert.deepEqual(
      hosts.sessionSourceContributions().map((provider) => provider.contribution.id),
      [AGENTS_SOURCE_ID],
      `${label} must publish the staged session source only after activation`,
    )
    await waitFor(() => {
      const entry = packagedEntries().find((candidate) => candidate.displayName === 'Packaged Claude session')
      assert.ok(entry, `${label} must reduce the packaged library session into a canonical agent root`)
      assert.equal(entry.state, 'working')
      assert.equal(entry.external, true)
      assert.equal(entry.harness, 'claude-code')
    }, `${label} packaged built-in agents session`)

    state = await installer.disable(AGENTS_ID)
    await hosts.stop(AGENTS_ID)
    assert.equal(state.extensions[AGENTS_ID].enabled, false)
    assert.equal(hosts.statuses().find((status) => status.extensionId === AGENTS_ID)?.state, 'stopped')
    assert.equal(hosts.sessionSourceContributions().length, 0)
    await waitFor(() => assert.equal(packagedEntries().length, 0), `${label} disabling the source must withdraw its sessions`)
    await hosts.shutdown()

    // This deliberately constructs a new server authority against the same
    // isolated profile: release restart must not silently re-enable the agents.
    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    hosts = newHosts()
    state = await installer.initialize()
    await startEnabled(installer, hosts, dataRoot)
    assert.equal(state.extensions[AGENTS_ID].enabled, false, `${label} restart must preserve explicit disablement`)
    assert.equal(hosts.statuses().find((status) => status.extensionId === AGENTS_ID), undefined)

    const preview = await installer.preview(`${AGENTS_PACKAGE}@${OVERRIDE_VERSION}`)
    state = await installer.confirm(preview.previewDigest)
    assert.equal(active(state, AGENTS_ID).version, OVERRIDE_VERSION)
    state = await installer.enable(AGENTS_ID)
    await startEnabled(installer, hosts, dataRoot)
    assert.equal(active(state, AGENTS_ID).version, OVERRIDE_VERSION)
    assert.equal(hosts.statuses().find((status) => status.extensionId === AGENTS_ID)?.state, 'running')

    await hosts.stop(AGENTS_ID)
    state = await installer.remove(AGENTS_ID)
    assert.equal(active(state, AGENTS_ID).version, agentsArtifact.version, `${label} rollback must select the packaged floor`)
    await startEnabled(installer, hosts, dataRoot)
    assert.ok(hosts.sessionSourceContributions().some((provider) => provider.contribution.id === AGENTS_SOURCE_ID), `${label} rollback must reactivate the staged session source`)
    await waitFor(
      () => assert.ok(packagedEntries().some((entry) => entry.displayName === 'Packaged Claude session')),
      `${label} rollback must report the live session again`,
    )
  } finally {
    agent.kill('SIGKILL')
    if (previousClaudeHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeHome
    await hosts?.shutdown().catch(() => undefined)
    scope?.dispose()
    await agentStatus?.stop().catch(() => undefined)
    await rm(dataRoot, { recursive: true, force: true })
  }
}

const target = process.env.TERMINAY_PACKAGED_LIFECYCLE_TARGET ?? 'both'

if (!['both', 'electron', 'standalone'].includes(target)) {
  throw new Error('TERMINAY_PACKAGED_LIFECYCLE_TARGET must be both, electron, or standalone')
}

function requiredArtifactRoot(name) {
  const root = process.env[name]
  assert.ok(root, `${name} must point at the packaged runtime resource`)
  return root
}

test('selected packaged resources pass the complete offline built-in lifecycle', async () => {
  const inventories = []
  if (target === 'both' || target === 'electron') {
    inventories.push(await exercisePackagedRoot('electron', requiredArtifactRoot('TERMINAY_ELECTRON_BUILT_INS')))
  }
  if (target === 'both' || target === 'standalone') {
    inventories.push(await exercisePackagedRoot('standalone', requiredArtifactRoot('TERMINAY_STANDALONE_BUILT_INS')))
  }
  if (inventories.length === 2) {
    assert.deepEqual(inventories[1], inventories[0], 'Electron and standalone must ship one identical inventory')
  }
})

test('selected packaged resources activate staged extensions and report sessions through real extension children', async () => {
  if (target === 'both' || target === 'electron') {
    await exercisePackagedHostRuntime('electron', requiredArtifactRoot('TERMINAY_ELECTRON_BUILT_INS'))
  }
  if (target === 'both' || target === 'standalone') {
    await exercisePackagedHostRuntime('standalone', requiredArtifactRoot('TERMINAY_STANDALONE_BUILT_INS'))
  }
})
