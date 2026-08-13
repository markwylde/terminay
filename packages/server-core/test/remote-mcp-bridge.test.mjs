import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteMcpBridgeAuthority, RemoteMcpBridgeError, RemoteMcpTargetAuthenticator } from '../dist/control/remoteMcpBridge.js';

const scope = Object.freeze({ terminalSessionId: 'session-a', projectId: 'project-a', projectEnvironmentId: 'environment-a', environmentRevision: 7, scope: 'write' });

function fixture(overrides = {}) {
  let now = 1_000;
  const calls = [];
  const authority = new RemoteMcpBridgeAuthority({
    now: () => now,
    ttlMs: 1_000,
    maxDeadlineMs: 100,
    serverInstanceId: 'server-boot-a',
    dispatch: async (authorized, op, params, context) => {
      calls.push({ authorized, op, params, signal: context.signal });
      return { terminals: [{ id: 'terminal-b' }] };
    },
    ...overrides,
  });
  return { authority, calls, now: () => now, advance: value => { now += value; } };
}

test('authenticated exchange exposes only immutable server-authorized implicit scope', async () => {
  const { authority, calls } = fixture();
  const capability = authority.open(scope);
  const target = new RemoteMcpTargetAuthenticator(capability);
  const request = target.request({ requestId: 'request-1', op: 'list_terminals', params: {}, deadline: 1_050 });
  const response = await authority.exchange(request, scope);
  target.verify(response);
  assert.equal(response.ok, true);
  assert.deepEqual(response.payload, { terminals: [{ id: 'terminal-b' }] });
  assert.deepEqual(calls.map(({ authorized, op, params }) => ({ authorized, op, params })), [{ authorized: scope, op: 'list_terminals', params: {} }]);
  assert.equal(JSON.stringify(response).includes(capability.bootstrapSecret), false);
});

test('forged, replayed and cross-environment requests fail before dispatch', async () => {
  const { authority, calls } = fixture();
  const capability = authority.open(scope);
  const target = new RemoteMcpTargetAuthenticator(capability);
  const request = target.request({ requestId: 'request-1', op: 'write_terminal', params: { terminal: 'terminal-b', text: 'x' }, deadline: 1_050 });
  await assert.rejects(authority.exchange({ ...request, params: { terminal: 'terminal-c', text: 'x' } }, scope), error => error instanceof RemoteMcpBridgeError && error.code === 'invalid-capability');
  await authority.exchange(request, scope);
  await assert.rejects(authority.exchange(request, scope), error => error instanceof RemoteMcpBridgeError && error.code === 'replay');
  const second = target.request({ requestId: 'request-2', op: 'list_terminals', params: {}, deadline: 1_050 });
  await assert.rejects(authority.exchange(second, { ...scope, projectEnvironmentId: 'environment-b' }), error => error instanceof RemoteMcpBridgeError && error.code === 'scope-mismatch');
  assert.equal(calls.length, 1);
});

test('rotation, reconnect, session exit and server shutdown revoke capabilities', async () => {
  const { authority } = fixture();
  const first = authority.open(scope);
  const firstTarget = new RemoteMcpTargetAuthenticator(first);
  const second = authority.rotate(first.bridgeId);
  await assert.rejects(authority.exchange(firstTarget.request({ requestId: 'old', op: 'list_terminals', params: {}, deadline: 1_050 }), scope), error => error.code === 'revoked');
  const secondTarget = new RemoteMcpTargetAuthenticator(second);
  authority.onReconnect(scope.terminalSessionId);
  await assert.rejects(authority.exchange(secondTarget.request({ requestId: 'reconnect', op: 'list_terminals', params: {}, deadline: 1_050 }), scope), error => error.code === 'revoked');
  const third = authority.open(scope); const thirdTarget = new RemoteMcpTargetAuthenticator(third);
  authority.onSessionExit(scope.terminalSessionId);
  await assert.rejects(authority.exchange(thirdTarget.request({ requestId: 'exit', op: 'list_terminals', params: {}, deadline: 1_050 }), scope), error => error.code === 'revoked');
  const fourth = authority.open(scope); const fourthTarget = new RemoteMcpTargetAuthenticator(fourth);
  authority.shutdown();
  await assert.rejects(authority.exchange(fourthTarget.request({ requestId: 'shutdown', op: 'list_terminals', params: {}, deadline: 1_050 }), scope), error => error.code === 'revoked');
});

test('expiry, bounded frames, deadlines, concurrency and revocation abort fail closed', async () => {
  const pending = [];
  const { authority, advance } = fixture({ maxFrameBytes: 300, maxResponseBytes: 300, maxInFlight: 1, dispatch: (_scope, _op, _params, { signal }) => new Promise((resolve, reject) => { pending.push({ resolve, reject, signal }); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) });
  const capability = authority.open(scope); const target = new RemoteMcpTargetAuthenticator(capability);
  await assert.rejects(authority.exchange(target.request({ requestId: 'late', op: 'list_terminals', params: {}, deadline: 2_000 }), scope), error => error.code === 'deadline');
  const active = authority.exchange(target.request({ requestId: 'active', op: 'list_terminals', params: {}, deadline: 1_050 }), scope);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(authority.exchange(target.request({ requestId: 'busy', op: 'list_terminals', params: {}, deadline: 1_050 }), scope), error => error.code === 'limit-exceeded');
  authority.revoke(capability.bridgeId);
  await assert.rejects(active, error => error.code === 'revoked');
  assert.equal(pending[0].signal.aborted, true);
  const expiring = authority.open(scope); const expiringTarget = new RemoteMcpTargetAuthenticator(expiring); advance(1_001);
  await assert.rejects(authority.exchange(expiringTarget.request({ requestId: 'expired', op: 'list_terminals', params: {}, deadline: 2_050 }), scope), error => error.code === 'expired');
  const bounded = authority.open(scope); const boundedTarget = new RemoteMcpTargetAuthenticator(bounded);
  assert.throws(() => boundedTarget.request({ requestId: 'huge', op: 'run_command', params: { command: 'x'.repeat(70_000) }, deadline: 2_050 }), error => error.code === 'bad-frame');
});

test('target rejects forged server responses and boot identities derive different keys', async () => {
  const { authority } = fixture(); const capability = authority.open(scope); const target = new RemoteMcpTargetAuthenticator(capability);
  const response = await authority.exchange(target.request({ requestId: 'request-1', op: 'list_terminals', params: {}, deadline: 1_050 }), scope);
  target.verify(response);
  assert.throws(() => target.verify({ ...response, payload: { terminals: [] } }), error => error.code === 'invalid-capability');
  const wrongBoot = new RemoteMcpTargetAuthenticator({ ...capability, serverInstanceId: 'server-boot-b' });
  assert.throws(() => wrongBoot.verify(response), error => error.code === 'invalid-capability');
});
