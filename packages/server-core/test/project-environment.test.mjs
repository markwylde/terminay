import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectEnvironmentCapabilityError,
  ProjectEnvironmentConflictError,
  ProjectEnvironmentRegistry,
  ProjectEnvironmentRepository,
  THIS_SERVER_ENVIRONMENT_ID,
  ThisServerEnvironmentRuntime,
  createInitialProjectEnvironmentState,
  migrateProjectEnvironmentState,
  toProjectEnvironmentSummary,
} from '../dist/index.js';

test('fresh registry persists one undeletable built-in This server environment', async () => {
  const commits = [];
  const repository = new ProjectEnvironmentRepository({ async load() {}, async commit(state) { commits.push(structuredClone(state)); } }, 'server-a');
  const state = await repository.load();
  assert.deepEqual(Object.keys(state.environments), [THIS_SERVER_ENVIRONMENT_ID]);
  assert.equal(state.environments[THIS_SERVER_ENVIRONMENT_ID].name, 'This server');
  assert.equal(state.environments[THIS_SERVER_ENVIRONMENT_ID].status, 'ready');
  assert.equal(state.environments[THIS_SERVER_ENVIRONMENT_ID].builtIn, true);
  assert.equal(commits.length, 1);
});

test('v1 environment registries migrate provider state and operation storage idempotently', () => {
  const current=createInitialProjectEnvironmentState('server-a');
  const legacy={...current,schemaVersion:1,environments:Object.fromEntries(Object.entries(current.environments).map(([id,{providerState,providerRevision,...environment}])=>[id,environment]))};
  const migrated=migrateProjectEnvironmentState(legacy,'server-a');
  assert.equal(migrated.schemaVersion,2);
  assert.equal(migrated.environments['terminay:this-server'].providerState,null);
  assert.equal(migrated.environments['terminay:this-server'].providerRevision,1);
  assert.deepEqual(migrated.operations,{});
  assert.deepEqual(migrateProjectEnvironmentState(migrated,'server-a'),migrated);
});

test('registry repository rejects stale revisions and corrupt reserved environment', async () => {
  let persisted = createInitialProjectEnvironmentState('server-a');
  const repository = new ProjectEnvironmentRepository({ async load() { return persisted; }, async commit(state) { persisted = structuredClone(state); } }, 'server-a');
  await repository.load();
  await repository.commit(0, (state) => state);
  await assert.rejects(() => repository.commit(0, (state) => state), ProjectEnvironmentConflictError);
  const corrupt = new ProjectEnvironmentRepository({ async load() { return { ...persisted, environments: {} }; }, async commit() {} }, 'server-a');
  await assert.rejects(() => corrupt.load(), /reserved This server environment/);
});

test('safe summaries exclude configuration, secret references, and operations', () => {
  const environment = createInitialProjectEnvironmentState('server-a').environments[THIS_SERVER_ENVIRONMENT_ID];
  const summary = toProjectEnvironmentSummary({ ...environment, operationReferences: ['job-secretish'] });
  assert.equal(summary.name, 'This server');
  assert.equal('operationReferences' in summary, false);
  assert.equal('secretReferences' in summary, false);
  assert.equal('configuration' in summary, false);
});

test('This server runtime delegates to existing services and enforces binding/capability', async () => {
  const calls = [];
  const runtime = new ThisServerEnvironmentRuntime({ capabilities: { terminal: async (...args) => { calls.push(args); return 'ok'; } } });
  const registry = new ProjectEnvironmentRegistry();
  registry.register(runtime);
  const environment = createInitialProjectEnvironmentState('server-a').environments[THIS_SERVER_ENVIRONMENT_ID];
  assert.equal(registry.resolve(environment, 'terminal'), runtime);
  assert.throws(() => registry.resolve(environment, 'filesystem'), ProjectEnvironmentCapabilityError);
  const context = { serverId: 'server-a', projectId: 'project-a', projectEnvironmentId: THIS_SERVER_ENVIRONMENT_ID, environmentRevision: 1, deadline: Date.now() + 1000, signal: new AbortController().signal };
  assert.equal(await runtime.invoke('terminal', 'create', {}, context), 'ok');
  await assert.rejects(() => runtime.invoke('terminal', 'create', {}, { ...context, projectEnvironmentId: 'ssh:other' }), /invalid environment binding/);
  assert.equal(calls.length, 1);
});
