import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_WORKSPACE_IDENTITIES,
  createFreshWorkspaceState,
  openCanonicalWorkspace,
  resolveWorkspaceHydration,
  WorkspaceRepository,
} from '../dist/index.js';

function memoryBackend(initial) {
  let persisted = initial === undefined ? undefined : structuredClone(initial);
  let commits = 0;
  return {
    backend: {
      async load() { return persisted === undefined ? undefined : structuredClone(persisted); },
      async commit(state) { commits += 1; persisted = structuredClone(state); },
      commitSync(state) { commits += 1; persisted = structuredClone(state); },
    },
    state: () => persisted === undefined ? undefined : structuredClone(persisted),
    commits: () => commits,
  };
}

test('fresh canonical workspace is committed once with a complete active projection', async () => {
  const memory = memoryBackend();
  const repository = await openCanonicalWorkspace({ backend: memory.backend, serverId: 'server-a', defaultProjectRoot: '/home/a', now: 42 });
  assert.equal(repository.wasCreated, true);
  assert.equal(memory.commits(), 1);
  assert.deepEqual(resolveWorkspaceHydration(repository.state), {
    state: 'ready', viewId: 'server-a:view:default',
    projectId: DEFAULT_WORKSPACE_IDENTITIES.projectId,
    panelId: DEFAULT_WORKSPACE_IDENTITIES.panelId,
    sessionId: DEFAULT_WORKSPACE_IDENTITIES.sessionId,
    projectEnvironmentId: 'terminay:this-server',
  });
  assert.equal(repository.state.projects.default.root, '/home/a');
  assert.equal(repository.state.terminalSessions.default.status, 'running');
});

test('concurrent initial clients share one initialization transaction', async () => {
  const memory = memoryBackend();
  const repository = new WorkspaceRepository(memory.backend, 'server-a', () =>
    createFreshWorkspaceState('server-a', '/home/a', 42));
  const [a, b, c] = await Promise.all([repository.load(), repository.load(), repository.load()]);
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
  assert.equal(memory.commits(), 1);
});

test('restart restores identities exactly once and interrupts a non-reattachable live session', async () => {
  const memory = memoryBackend();
  const first = await openCanonicalWorkspace({ backend: memory.backend, serverId: 'server-a', defaultProjectRoot: '/home/a', now: 42 });
  const original = resolveWorkspaceHydration(first.state);
  const second = await openCanonicalWorkspace({ backend: memory.backend, serverId: 'server-a', defaultProjectRoot: '/ignored', now: 99 });
  assert.equal(second.wasCreated, false);
  assert.deepEqual(resolveWorkspaceHydration(second.state), original);
  assert.equal(Object.keys(second.state.projects).length, 1);
  assert.equal(Object.keys(second.state.panels).length, 1);
  assert.equal(Object.keys(second.state.terminalSessions).length, 1);
  assert.equal(second.state.terminalSessions.default.status, 'interrupted');
  const revisionAfterRecovery = second.state.revision;
  const third = await openCanonicalWorkspace({ backend: memory.backend, serverId: 'server-a', defaultProjectRoot: '/ignored-again' });
  assert.equal(third.state.revision, revisionAfterRecovery);
});

test('a failed durable transaction never publishes the proposed workspace revision', async () => {
  const memory = memoryBackend();
  const repository = await openCanonicalWorkspace({ backend: memory.backend, serverId: 'server-a', defaultProjectRoot: '/home/a' });
  const before = repository.state;
  memory.backend.commitSync = () => { throw new Error('disk unavailable'); };
  assert.throws(() => repository.workspace.apply({
    commandId: 'rename', expectedRevision: before.revision,
    command: { type: 'view.rename', viewId: before.viewOrder[0], name: 'Changed' },
  }), /disk unavailable/);
  assert.deepEqual(repository.state, before);
});

test('repository conflict semantics remain explicit with an async-only backend', async () => {
  const memory = memoryBackend();
  delete memory.backend.commitSync;
  const repository = new WorkspaceRepository(memory.backend, 'server-a');
  const state = await repository.load();
  const viewId = state.viewOrder[0];
  const first = await repository.apply({ commandId: 'rename', expectedRevision: 0, command: { type: 'view.rename', viewId, name: 'A' } });
  assert.equal(first.ok, true);
  const stale = await repository.apply({ commandId: 'stale', expectedRevision: 0, command: { type: 'view.rename', viewId, name: 'B' } });
  assert.equal(stale.ok, false);
});
