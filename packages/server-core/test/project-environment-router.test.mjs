import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EnvironmentRoutedProjectService,
  ProjectEnvironmentCapabilityError,
  ProjectEnvironmentRegistry,
  ProjectEnvironmentRouteError,
  ProjectEnvironmentRouter,
  THIS_SERVER_ENVIRONMENT_ID,
  createInitialProjectEnvironmentState,
  createInitialWorkspace,
  createServerCoreComposition,
  createEnvironmentRoutedProjectServices,
  createEnvironmentRoutedPtyFactory,
  filterRemoteTerminalEnvironment,
  classifyProjectOperation,
  routeProjectOperationRegistries,
} from '../dist/index.js';

function fixture() {
  const initialWorkspace = createInitialWorkspace('server-a');
  const project = initialWorkspace.projects.default;
  const workspace = {
    ...initialWorkspace,
    projects: {
      ...initialWorkspace.projects,
      default: { ...project, projectEnvironmentId: 'ssh-one', environmentRevision: 7 },
      second: { ...project, id: 'second', projectEnvironmentId: 'ssh-two', environmentRevision: 3 },
    },
  };
  const initialEnvironments = createInitialProjectEnvironmentState('server-a');
  const environment = (id, revision, providerId) => ({
    id,
    providerId,
    pinnedRevision: revision,
    name: id,
    endpointSummary: id,
    declaredCapabilities: ['terminal', 'filesystem', 'git'],
    availableCapabilities: ['terminal', 'filesystem', 'git'],
    status: 'ready',
    operationReferences: [],
    projectReferenceCount: 1,
    archived: false,
    builtIn: false,
  });
  const environments = {
    ...initialEnvironments,
    environments: {
      ...initialEnvironments.environments,
      'ssh-one': environment('ssh-one', 7, 'sentinel-one'),
      'ssh-two': environment('ssh-two', 3, 'sentinel-two'),
    },
  };
  const calls = [];
  const runtime = (providerId) => ({
    providerId,
    capabilities: ['terminal', 'filesystem', 'git'],
    async invoke(capability, operation, input, context) {
      calls.push({ providerId, capability, operation, input, context });
      return `${providerId}:${operation}`;
    },
  });
  const registry = new ProjectEnvironmentRegistry();
  registry.register(runtime('sentinel-one'));
  registry.register(runtime('sentinel-two'));
  const router = new ProjectEnvironmentRouter({
    serverId: 'server-a',
    workspaceSnapshot: () => workspace,
    environmentSnapshot: () => environments,
    registry,
  });
  return { workspace, environments, calls, registry, router };
}

test('routes terminal, filesystem, and Git operations only through the canonical project environment', async () => {
  const { calls, router } = fixture();
  const terminal = new EnvironmentRoutedProjectService(router, 'terminal');
  const files = new EnvironmentRoutedProjectService(router, 'filesystem');
  const git = new EnvironmentRoutedProjectService(router, 'git');

  assert.equal(await terminal.invoke('default', 'spawn', { command: 'sentinel-one' }), 'sentinel-one:spawn');
  assert.equal(await files.invoke('second', 'read', { path: '/sentinel-two' }), 'sentinel-two:read');
  assert.equal(await git.invoke('default', 'status', {}), 'sentinel-one:status');
  assert.deepEqual(calls.map(({ providerId, capability }) => [providerId, capability]), [
    ['sentinel-one', 'terminal'],
    ['sentinel-two', 'filesystem'],
    ['sentinel-one', 'git'],
  ]);
  assert.equal(calls[0].context.projectEnvironmentId, 'ssh-one');
  assert.equal(calls[1].context.projectEnvironmentId, 'ssh-two');
});

test('files.watch and folder-size classify as observation, not filesystem listing', () => {
  assert.deepEqual(classifyProjectOperation('files.watch.start'), { capability: 'filesystem-observation' });
  assert.deepEqual(classifyProjectOperation('files.watch.read'), { capability: 'filesystem-observation' });
  assert.deepEqual(classifyProjectOperation('files.folder-size.start'), { capability: 'filesystem-observation' });
  assert.deepEqual(classifyProjectOperation('files.list'), { capability: 'filesystem' });
  assert.deepEqual(classifyProjectOperation('files.catalog'), { capability: 'filesystem' });
});

test('remote files.watch.start fails closed without opening the remote filesystem or This server watch', async () => {
  const { calls, router } = fixture();
  let localCalls = 0;
  const routed = routeProjectOperationRegistries({
    queries: {
      'files.list': async () => { localCalls += 1; return { local: true }; },
    },
    commands: {
      'files.watch.start': async () => { localCalls += 1; return { local: true }; },
    },
  }, router);
  const request = (projectId) => ({
    envelope: { payload: { projectId } }, body: new Uint8Array(),
    context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal },
  });
  await assert.rejects(
    () => routed.commands.get('files.watch.start')(request('default')),
    ProjectEnvironmentCapabilityError,
  );
  assert.equal(localCalls, 0);
  assert.equal(calls.length, 0);
  assert.equal(await routed.queries.get('files.list')(request('default')), 'sentinel-one:files.list');
  assert.deepEqual(calls.map(({ capability, operation }) => [capability, operation]), [['filesystem', 'files.list']]);
});

test('This server still reaches its local file watch handler', async () => {
  const { environments, registry, workspace } = fixture();
  workspace.projects.local = {
    ...workspace.projects.default,
    id: 'local',
    projectEnvironmentId: THIS_SERVER_ENVIRONMENT_ID,
    environmentRevision: 1,
  };
  const router = new ProjectEnvironmentRouter({
    serverId: 'server-a',
    workspaceSnapshot: () => workspace,
    environmentSnapshot: () => environments,
    registry,
  });
  let localCalls = 0;
  const routed = routeProjectOperationRegistries({
    commands: {
      'files.watch.start': async () => { localCalls += 1; return { subscriptionId: 'watch-local' }; },
    },
  }, router);
  const result = await routed.commands.get('files.watch.start')({
    envelope: { payload: { projectId: 'local' } }, body: new Uint8Array(),
    context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal },
  });
  assert.deepEqual(result, { subscriptionId: 'watch-local' });
  assert.equal(localCalls, 1);
});

test('unknown git operations on a remote project never fall back to local Git', async () => {
  const { calls, router } = fixture();
  let localCalls = 0;
  const local = async () => { localCalls += 1; return { local: true }; };
  const routed = routeProjectOperationRegistries({
    queries: {
      'git.status': local,
      'git.invented': local,
    },
    commands: {
      'git.worktree.pull': local,
      'git.quick-push.propose': local,
    },
  }, router);
  const request = (projectId) => ({
    envelope: { payload: { projectId } }, body: new Uint8Array(),
    context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal },
  });
  assert.equal(await routed.queries.get('git.invented')(request('default')), 'sentinel-one:unsupported');
  assert.equal(await routed.commands.get('git.worktree.pull')(request('second')), 'sentinel-two:unsupported');
  assert.equal(await routed.commands.get('git.quick-push.propose')(request('default')), 'sentinel-one:unsupported');
  assert.equal(localCalls, 0);
  assert.deepEqual(calls.map(({ capability, operation }) => [capability, operation]), [
    ['git', 'unsupported'],
    ['git', 'unsupported'],
    ['git', 'unsupported'],
  ]);
});

test('This server still reaches its local Git handler for host-owned worktree commands', async () => {
  const { environments, registry, workspace } = fixture();
  workspace.projects.local = {
    ...workspace.projects.default,
    id: 'local',
    projectEnvironmentId: THIS_SERVER_ENVIRONMENT_ID,
    environmentRevision: 1,
  };
  const router = new ProjectEnvironmentRouter({
    serverId: 'server-a',
    workspaceSnapshot: () => workspace,
    environmentSnapshot: () => environments,
    registry,
  });
  let localCalls = 0;
  const routed = routeProjectOperationRegistries({
    commands: {
      'git.worktree.pull': async () => { localCalls += 1; return { pulled: true }; },
    },
  }, router);
  const result = await routed.commands.get('git.worktree.pull')({
    envelope: { payload: { projectId: 'local' } }, body: new Uint8Array(),
    context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal },
  });
  assert.deepEqual(result, { pulled: true });
  assert.equal(localCalls, 1);
});

test('production protocol registries route remote files and Git before local adapters', async () => {
  const { calls, router } = fixture();
  let localCalls = 0;
  const routed = routeProjectOperationRegistries({
    queries: {
      'files.catalog': async () => { localCalls += 1; return { local: true }; },
      'git.status': async () => { localCalls += 1; return { local: true }; },
    },
  }, router);
  const request = (projectId) => ({
    envelope: { payload: { projectId } }, body: new Uint8Array(),
    context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal },
  });
  assert.equal(await routed.queries.get('files.catalog')(request('default')), 'sentinel-one:files.catalog');
  assert.equal(await routed.queries.get('git.status')(request('second')), 'sentinel-two:status');
  assert.equal(localCalls, 0);
  assert.deepEqual(calls.slice(-2).map(({ capability }) => capability), ['filesystem', 'git']);
});

test('routed PTY factory keeps streams server-owned and never calls local spawn for a remote project', async () => {
  const { calls, router } = fixture();
  let localCalls = 0;
  const local = { spawn() { localCalls += 1; return { write() {}, resize() {}, kill() {}, onData() {}, onExit() {} }; } };
  const factory = createEnvironmentRoutedPtyFactory(router, local);
  await factory.spawn({ projectId: 'default', projectEnvironmentId: 'ssh-one', environmentRevision: 7, shellPath: '/bin/sh', shell: '/bin/sh', args: [], cwd: '/sentinel', env: { TERMINAY_SECRET: 'no', CUSTOM: 'yes' }, cols: 80, rows: 24 });
  assert.equal(localCalls, 0);
  const call = calls.at(-1);
  assert.equal(call.capability, 'terminal');
  assert.equal(call.operation, 'spawn');
  assert.deepEqual(call.input.env, { CUSTOM: 'yes' });
});

test('production composition dispatches project operations through the remote provider and never its local handler', async () => {
  const { environments, registry, workspace, calls } = fixture();
  const router = new ProjectEnvironmentRouter({ serverId: 'server-a', workspaceSnapshot: () => workspace, environmentSnapshot: () => environments, registry });
  let localFiles = 0;
  const composition = createServerCoreComposition({
    serverId: 'server-a', serverVersion: 'test', capabilities: ['terminal', 'files'],
    authenticate: () => ({ clientId: 'client', authScope: 'admin' }), workspace: { state: workspace },
    ptyFactory: { spawn() { throw new Error('local PTY must not run'); } },
    allowUnresolvedTestSessions: true, projectEnvironmentRouter: router,
    operations: { queries: { 'files.catalog': async () => { localFiles += 1; return { local: true }; } } },
  });
  const handler = composition.operations.queries.get('files.catalog');
  const result = await handler({ envelope: { payload: { projectId: 'default' } }, body: new Uint8Array(), context: { clientId: 'client', connectionId: 'connection', authScope: 'admin', signal: new AbortController().signal } });
  assert.equal(result, 'sentinel-one:files.catalog');
  assert.equal(localFiles, 0);
  assert.equal(calls.at(-1).providerId, 'sentinel-one');
  await composition.shutdown();
});

test('missing provider and capability fail closed without invoking This server', async () => {
  const { environments, registry, workspace } = fixture();
  let localCalls = 0;
  registry.register({
    providerId: 'terminay:this-server',
    capabilities: ['terminal'],
    async invoke() { localCalls += 1; return 'unsafe-local-fallback'; },
  });
  const missingProvider = new ProjectEnvironmentRouter({
    serverId: 'server-a', workspaceSnapshot: () => workspace,
    environmentSnapshot: () => ({ ...environments, environments: { ...environments.environments, 'ssh-one': { ...environments.environments['ssh-one'], providerId: 'not-installed' } } }),
    registry,
  });
  await assert.rejects(() => missingProvider.invoke('default', 'terminal', 'spawn', {}), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'provider-unavailable');

  const noGitRegistry = new ProjectEnvironmentRegistry();
  noGitRegistry.register({
    providerId: 'sentinel-one',
    capabilities: ['terminal', 'filesystem'],
    async invoke() { throw new Error('git must not run'); },
  });
  const noGit = new ProjectEnvironmentRouter({
    serverId: 'server-a', workspaceSnapshot: () => workspace,
    environmentSnapshot: () => ({ ...environments, environments: { ...environments.environments, 'ssh-one': { ...environments.environments['ssh-one'], availableCapabilities: ['terminal'] } } }),
    registry: noGitRegistry,
  });
  await assert.rejects(() => noGit.invoke('default', 'git', 'status', {}), ProjectEnvironmentCapabilityError);
  assert.equal(localCalls, 0);
});

test('a ready remote environment can use Git after the live provider gains that capability', async () => {
  const { environments, workspace } = fixture();
  const registry = new ProjectEnvironmentRegistry();
  const calls = [];
  registry.register({
    providerId: 'sentinel-one',
    capabilities: ['terminal', 'filesystem', 'git'],
    async invoke(_capability, operation) { calls.push(operation); return 'remote-git'; },
  });
  const router = new ProjectEnvironmentRouter({
    serverId: 'server-a',
    workspaceSnapshot: () => workspace,
    environmentSnapshot: () => ({
      ...environments,
      environments: {
        ...environments.environments,
        'ssh-one': { ...environments.environments['ssh-one'], declaredCapabilities: ['terminal', 'filesystem'], availableCapabilities: ['terminal', 'filesystem'] },
      },
    }),
    registry,
  });
  assert.equal(await router.invoke('default', 'git', 'worktrees', { payload: { projectId: 'default' } }), 'remote-git');
  assert.deepEqual(calls, ['worktrees']);
});

test('long-lived operations retain their immutable environment binding', async () => {
  const { calls, router, workspace } = fixture();
  const files = new EnvironmentRoutedProjectService(router, 'filesystem');
  const binding = files.bind('default');
  workspace.projects.default = { ...workspace.projects.default, projectEnvironmentId: THIS_SERVER_ENVIRONMENT_ID, environmentRevision: 1 };
  assert.equal(await files.invokeBound(binding, 'save-draft', { path: '/sentinel-one' }), 'sentinel-one:save-draft');
  assert.equal(calls.at(-1).providerId, 'sentinel-one');
});

test('unavailable and revision-mismatched environments remain represented as typed failures', async () => {
  const { environments, router } = fixture();
  environments.environments['ssh-one'] = { ...environments.environments['ssh-one'], status: 'offline', failure: { classification: 'offline', message: 'SSH transport disconnected.', retryable: true } };
  await assert.rejects(() => router.invoke('default', 'filesystem', 'read', {}), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'environment-unavailable' && error.environmentStatus === 'offline' && error.retryable);

  environments.environments['ssh-one'] = { ...environments.environments['ssh-one'], status: 'ready', pinnedRevision: 8 };
  await assert.rejects(() => router.invoke('default', 'terminal', 'spawn', {}), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'environment-revision-mismatch');
});

test('provider exceptions are normalized and cancellation is bounded', async () => {
  const { environments, workspace } = fixture();
  const registry = new ProjectEnvironmentRegistry();
  registry.register({
    providerId: 'sentinel-one', capabilities: ['filesystem'],
    async invoke(_capability, operation, _input, context) {
      if (operation === 'fail') throw new Error('provider secret detail');
      if (operation === 'ignore-abort') return new Promise(() => {});
      await new Promise((_resolve, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
    },
  });
  const router = new ProjectEnvironmentRouter({ serverId: 'server-a', workspaceSnapshot: () => workspace, environmentSnapshot: () => environments, registry });
  await assert.rejects(() => router.invoke('default', 'filesystem', 'fail', {}), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'provider-operation-failed' && !error.message.includes('secret'));
  await assert.rejects(() => router.invoke('default', 'filesystem', 'hang', {}, { timeoutMs: 5 }), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'operation-timeout');
  await assert.rejects(() => router.invoke('default', 'filesystem', 'ignore-abort', {}, { timeoutMs: 5 }), (error) => error instanceof ProjectEnvironmentRouteError && error.code === 'operation-timeout');
});

test('the routed service suite gates optional services and remote environment filtering removes server authorities', async () => {
  const { router } = fixture();
  const services = createEnvironmentRoutedProjectServices(router);
  await assert.rejects(() => services.agentJournal.invoke('default', 'observe', {}), ProjectEnvironmentCapabilityError);
  assert.deepEqual(filterRemoteTerminalEnvironment({
    PATH: '/remote-safe', HOME: '/server-home', TERMINAY_MCP_SOCKET: '/secret.sock',
    MCP_CONTROL_URL: 'local', SSH_AUTH_SOCK: '/agent.sock', GIT_ASKPASS: '/askpass',
    NODE_OPTIONS: '--require secret', ELECTRON_RUN_AS_NODE: '1', CUSTOM: 'safe',
  }), { CUSTOM: 'safe' });
});
