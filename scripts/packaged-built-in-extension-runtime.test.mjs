import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import {
  DirectoryBuiltInExtensionArtifactSource,
  ExtensionInstaller,
  ExtensionHostManager,
} from '../packages/server-core/dist/extensions/index.js'
import {
  AgentStatusService,
  TerminalActivityService,
} from '../packages/server-core/dist/index.js'

const CODEX_ID = 'com.terminay.agent.codex'
const CODEX_PACKAGE = 'terminay-agent-codex'
const CURSOR_ID = 'com.terminay.agent.cursor'
const OVERRIDE_VERSION = '9.9.9'
const OVERRIDE_INTEGRITY = `sha512-${Buffer.alloc(64, 9).toString('base64')}`
const CODEX_PROVIDER_ID = `${CODEX_ID}/cli`

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
    if (artifact.extensionId === CODEX_ID) {
      await writeFile(join(root, 'node_modules', CODEX_PACKAGE, ...artifact.manifestMetadata.entrypoint.split('/')), 'tampered\n')
    }
  }
}

class OverrideRegistry {
  constructor(manifest) {
    this.manifest = manifest
    this.npmVersion = '12.0.2'
  }
  async resolve(packageName, selector) {
    assert.equal(packageName, CODEX_PACKAGE)
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
    name: CODEX_PACKAGE,
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
      [`node_modules/${CODEX_PACKAGE}`]: {
        version: OVERRIDE_VERSION,
        resolved: tarballUrl,
        integrity: OVERRIDE_INTEGRITY,
      },
    },
  })
  return { files: [
    ['package-lock.json', lock],
    [`node_modules/${CODEX_PACKAGE}/package.json`, packageJson],
    [`node_modules/${CODEX_PACKAGE}/${entrypoint}`, source],
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
  assert.equal(artifacts.length, 7, `${label} must expose the complete built-in inventory`)
  const codex = artifacts.find((artifact) => artifact.extensionId === CODEX_ID)
  assert.ok(codex)
  const registry = new OverrideRegistry(codex.manifestMetadata)
  const dataRoot = await mkdtemp(join(tmpdir(), `terminay-${label}-built-ins-`))
  try {
    const initialSource = new FilteredBuiltIns(source, new Set([CURSOR_ID]))
    let installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: initialSource })
    let state = await installer.initialize()
    assert.equal(Object.keys(state.extensions).length, 6)
    assert.ok(Object.values(state.extensions).every((record) => record.enabled))

    await installer.disable(CODEX_ID)
    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: initialSource })
    state = await installer.initialize()
    assert.equal(state.extensions[CODEX_ID].enabled, false, `${label} restart must preserve disablement`)

    const preview = await installer.preview(`${CODEX_PACKAGE}@${OVERRIDE_VERSION}`)
    state = await installer.confirm(preview.previewDigest)
    assert.equal(active(state, CODEX_ID).version, OVERRIDE_VERSION)
    assert.equal(state.extensions[CODEX_ID].enabled, false)

    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    state = await installer.initialize()
    assert.equal(state.extensions[CURSOR_ID].enabled, true, `${label} must default-enable a newly bundled floor`)
    assert.equal(active(state, CODEX_ID).version, OVERRIDE_VERSION, `${label} must retain the npm override`)

    state = await installer.remove(CODEX_ID)
    assert.equal(active(state, CODEX_ID).version, codex.version, `${label} removal must roll back to the packaged floor`)
    assert.equal(state.extensions[CODEX_ID].enabled, false)
  } finally {
    await rm(dataRoot, { recursive: true, force: true })
  }

  const badRoot = await mkdtemp(join(tmpdir(), `terminay-${label}-bad-built-in-`))
  try {
    const bad = new CorruptOneBuiltIn(source)
    const installer = new ExtensionInstaller({ dataRoot: badRoot, registryClient: registry, materializer: registry, builtIns: bad })
    const state = await installer.initialize()
    assert.equal(state.extensions[CODEX_ID].state, 'failed')
    assert.equal(Object.values(state.extensions).filter((record) => record.state === 'failed').length, 1, JSON.stringify(state.extensions))
    assert.equal(Object.keys(state.extensions).length, 7)
  } finally {
    await rm(badRoot, { recursive: true, force: true })
  }
  return await readFile(join(resolve(artifactRoot), 'inventory.v1.json'))
}

function codexRuntimeBroker({ agentStatus, identity, publications, cancellations }) {
  const rollout = Object.freeze({ id: 'rollout-fixture' })
  const sessionIndex = Object.freeze({ id: 'session-index-fixture' })
  const sessions = Object.freeze({ id: 'sessions-fixture' })
  const rolloutBytes = new TextEncoder().encode(`${JSON.stringify({
    timestamp: '2026-08-24T12:00:00.000Z',
    type: 'session_meta',
    payload: {
      id: 'packaged-codex-session',
      originator: 'codex-tui',
      source: 'cli',
      model: 'gpt-packaged',
    },
  })}\n`)
  let rolloutDelivered = false
  return {
    async observe(request) {
      switch (request.operation) {
        case 'process.descendants':
          return [{ handle: { id: 'codex-process' }, executableName: 'codex' }]
        case 'process.open-files':
          return [{
            handle: rollout,
            path: '/fixture/codex/sessions/2026/08/24/rollout-fixture.jsonl',
            access: 'writable',
          }]
        case 'process.environment':
          return { CODEX_HOME: '/fixture/codex' }
        case 'filesystem.realpath':
          return request.payload.handle
        case 'filesystem.stat':
          return {
            handle: request.payload.handle,
            kind: 'file',
            size: rolloutBytes.byteLength,
            modifiedAt: '2026-08-24T12:00:00.000Z',
          }
        case 'filesystem.read':
          return [...rolloutBytes]
        case 'filesystem.resolve-relative-to-environment':
          return sessionIndex
        case 'filesystem.resolve-directory-relative-to-environment':
          return sessions
        case 'filesystem.list-directory':
          return { entries: [] }
        case 'filesystem.follow': {
          const watcherId = request.payload.watcherId
          if (watcherId === undefined)
            return { watcherId: request.payload.handle.id === rollout.id ? 'rollout-watch' : 'index-watch' }
          if (watcherId === 'rollout-watch' && !rolloutDelivered) {
            rolloutDelivered = true
            return { events: [{ type: 'append', bytes: [...rolloutBytes] }], closed: false }
          }
          return { events: [], closed: false }
        }
        case 'filesystem.unfollow':
          return { stopped: true }
        case 'filesystem.watch-directory':
          return request.payload.watcherId === undefined
            ? { watcherId: 'sessions-watch', snapshot: { entries: [] } }
            : { listings: [], closed: false }
        case 'filesystem.unwatch-directory':
          return { stopped: true }
        default:
          throw new Error(`unexpected packaged Codex observation: ${request.operation}`)
      }
    },
    async publish(request) {
      publications.push(request)
      return agentStatus.ingestExtensionLifecycle(
        identity,
        request.providerId,
        request.mappingVersion,
        request.binding,
        request.events,
      )
    },
    terminalCancelled(request) {
      cancellations.push(request)
    },
  }
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
      agentProviders: descriptor.agentProviders,
      projectEnvironmentProviders: descriptor.manifest.contributes.projectEnvironments ?? [],
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
  const codex = artifacts.find((artifact) => artifact.extensionId === CODEX_ID)
  assert.ok(codex, `${label} must package Codex for lifecycle admission`)
  assert.deepEqual(
    codex.manifestMetadata.contributes.agentProviders?.find((provider) => provider.id === CODEX_PROVIDER_ID)?.requiredEnvironmentVariables,
    ['CODEX_HOME'],
    `${label} must package Codex's declared terminal-scoped observation input`,
  )
  const registry = new OverrideRegistry(codex.manifestMetadata)
  const dataRoot = await mkdtemp(join(tmpdir(), `terminay-${label}-built-in-host-`))
  let hosts
  let agentStatus
  try {
    const publications = []
    const cancellations = []
    const identity = {
      serverId: `${label}-server`,
      projectId: `${label}-project`,
      sessionId: `${label}-terminal`,
    }
    const activity = new TerminalActivityService({ serverId: identity.serverId })
    activity.register(identity)
    agentStatus = new AgentStatusService({ activity })
    await agentStatus.start()
    agentStatus.register(identity)
    agentStatus.claimExtensionProvider(identity, CODEX_PROVIDER_ID)
    const agents = codexRuntimeBroker({ agentStatus, identity, publications, cancellations })
    let installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    hosts = new ExtensionHostManager({ broker: { async request() {} }, agents })
    let state = await installer.initialize()
    await startEnabled(installer, hosts, dataRoot)
    assert.deepEqual(
      hosts.statuses().map((status) => [status.extensionId, status.state]),
      artifacts.map((artifact) => [artifact.extensionId, 'running']).sort((left, right) => left[0].localeCompare(right[0])),
      `${label} first run must activate every staged extension child`,
    )
    assert.deepEqual(
      hosts.agentProviderContributions().map((provider) => provider.id),
      [
        'com.terminay.agent.claude-code/cli',
        CODEX_PROVIDER_ID,
        'com.terminay.agent.cursor/cli',
        'com.terminay.agent.grok/cli',
        'com.terminay.agent.omp/cli',
      ],
      `${label} must publish all staged agent contributions only after activation`,
    )

    await hosts.admitAgentTerminal({
      context: {
        contextId: `${label}-codex-context`,
        serverId: identity.serverId,
        projectId: identity.projectId,
        projectEnvironmentId: 'terminay.this-server',
        terminalSessionId: identity.sessionId,
        terminalIncarnationId: '1',
        providerId: CODEX_PROVIDER_ID,
      },
      observationCapabilities: ['process-observation', 'filesystem-observation', 'agent-journal'],
    })
    await waitFor(() => {
      assert.ok(publications.some((publication) => publication.binding?.providerSessionId === 'packaged-codex-session'))
      assert.ok(publications.some((publication) => publication.events.some((event) => event.kind === 'session.started')))
      assert.ok(
        Object.values(agentStatus.getSnapshot().entries).some((entry) => entry.provider === CODEX_PROVIDER_ID && entry.displayName === 'Codex'),
        `${label} must reduce the packaged lifecycle into a canonical agent root`,
      )
    }, `${label} packaged Codex lifecycle admission`)

    state = await installer.disable(CODEX_ID)
    await hosts.stop(CODEX_ID)
    assert.equal(state.extensions[CODEX_ID].enabled, false)
    assert.equal(hosts.statuses().find((status) => status.extensionId === CODEX_ID)?.state, 'stopped')
    assert.equal(hosts.agentProviderContributions().some((provider) => provider.id === CODEX_PROVIDER_ID), false)
    assert.equal(cancellations.length, 1, `${label} disabling a live provider must drain its admitted terminal`)
    await hosts.shutdown()

    // This deliberately constructs a new server authority against the same
    // isolated profile: release restart must not silently re-enable Codex.
    installer = new ExtensionInstaller({ dataRoot, registryClient: registry, materializer: registry, builtIns: source })
    hosts = new ExtensionHostManager({ broker: { async request() {} }, agents })
    state = await installer.initialize()
    await startEnabled(installer, hosts, dataRoot)
    assert.equal(state.extensions[CODEX_ID].enabled, false, `${label} restart must preserve explicit disablement`)
    assert.equal(hosts.statuses().find((status) => status.extensionId === CODEX_ID), undefined)

    const preview = await installer.preview(`${CODEX_PACKAGE}@${OVERRIDE_VERSION}`)
    state = await installer.confirm(preview.previewDigest)
    assert.equal(active(state, CODEX_ID).version, OVERRIDE_VERSION)
    state = await installer.enable(CODEX_ID)
    await startEnabled(installer, hosts, dataRoot)
    assert.equal(active(state, CODEX_ID).version, OVERRIDE_VERSION)
    assert.equal(hosts.statuses().find((status) => status.extensionId === CODEX_ID)?.state, 'running')

    await hosts.stop(CODEX_ID)
    state = await installer.remove(CODEX_ID)
    assert.equal(active(state, CODEX_ID).version, codex.version, `${label} rollback must select the packaged floor`)
    await startEnabled(installer, hosts, dataRoot)
    assert.ok(hosts.agentProviderContributions().some((provider) => provider.id === CODEX_PROVIDER_ID), `${label} rollback must reactivate the staged Codex provider`)
  } finally {
    await hosts?.shutdown().catch(() => undefined)
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

test('selected packaged resources activate staged extensions and admit lifecycle through real extension children', async () => {
  if (target === 'both' || target === 'electron') {
    await exercisePackagedHostRuntime('electron', requiredArtifactRoot('TERMINAY_ELECTRON_BUILT_INS'))
  }
  if (target === 'both' || target === 'standalone') {
    await exercisePackagedHostRuntime('standalone', requiredArtifactRoot('TERMINAY_STANDALONE_BUILT_INS'))
  }
})
