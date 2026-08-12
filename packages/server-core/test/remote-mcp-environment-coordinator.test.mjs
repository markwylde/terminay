import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteMcpBridgeAuthority, RemoteMcpEnvironmentCoordinator, RemoteMcpTargetAuthenticator } from '../dist/control/index.js';

test('coordinator pumps SSH helper frames through server authorization and revokes on exit', async () => {
  let receiveResolve; const calls = []; let response;
  const binding = { serverId: 'server-a', projectId: 'project-a', projectEnvironmentId: 'environment-a', environmentRevision: 4 };
  const service = {
    capability: 'mcp-bridge', bind: projectId => { assert.equal(projectId, 'project-a'); return binding; },
    async invokeBound(receivedBinding, operation, input) {
      assert.deepEqual(receivedBinding, binding); calls.push({ operation, input });
      if (operation === 'open' || operation === 'revoke') return {};
      if (input.action === 'receive') return new Promise(resolve => { receiveResolve = resolve; });
      if (input.action === 'respond') { response = input.frame; return { accepted: true }; }
      throw new Error('unexpected');
    },
  };
  const dispatched = [];
  const authority = new RemoteMcpBridgeAuthority({ serverInstanceId: 'server-boot-a', dispatch: async (scope, op, params) => { dispatched.push({ scope, op, params }); return { terminals: [] }; } });
  const coordinator = new RemoteMcpEnvironmentCoordinator(service, authority);
  const publicCapability = await coordinator.open('project-a', 'session-a');
  assert.equal('bootstrapSecret' in publicCapability, false);
  const bootstrap = calls.find(call => call.operation === 'open').input.capability;
  const target = new RemoteMcpTargetAuthenticator({ ...bootstrap, terminalSessionId: 'session-a', projectId: 'project-a', projectEnvironmentId: 'environment-a', environmentRevision: 4, scope: 'write' });
  receiveResolve(target.request({ requestId: 'request-a', op: 'list_terminals', params: {}, deadline: Date.now() + 5_000 }));
  for (let attempt = 0; attempt < 10 && !response; attempt += 1) await new Promise(resolve => setImmediate(resolve));
  target.verify(response);
  assert.deepEqual(dispatched[0], { scope: { terminalSessionId: 'session-a', projectId: 'project-a', projectEnvironmentId: 'environment-a', environmentRevision: 4, scope: 'write' }, op: 'list_terminals', params: {} });
  assert.equal(await coordinator.onSessionExit('session-a'), true);
  assert.equal(calls.at(-1).operation, 'revoke');
});
