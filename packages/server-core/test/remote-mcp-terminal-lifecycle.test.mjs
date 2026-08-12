import assert from 'node:assert/strict';
import test from 'node:test';
import { composeRemoteMcpTerminalLifecycle } from '../dist/control/index.js';

test('remote MCP lifecycle preserves host hooks and binds exact terminal identity', async () => {
  const calls = []; const failures = [];
  const remote = { open: async (...args) => calls.push(['open', ...args]), onSessionExit: async (...args) => calls.push(['exit', ...args]) };
  const base = {
    prepareTerminalSession: identity => { calls.push(['prepare', identity]); return { HOST_TOKEN: 'preserved' }; },
    terminalStarted: (identity, pid) => calls.push(['base-start', identity, pid]),
    terminalExited: (identity, exit) => calls.push(['base-exit', identity, exit]),
    terminalInput: identity => calls.push(['input', identity]),
  };
  const lifecycle = composeRemoteMcpTerminalLifecycle(() => remote, base, (_identity, error) => failures.push(error));
  const identity = { serverId: 'server-a', projectId: 'project-a', sessionId: 'session-a' };
  assert.deepEqual(lifecycle.prepareTerminalSession(identity), { HOST_TOKEN: 'preserved' });
  lifecycle.terminalStarted(identity, 42); lifecycle.terminalInput(identity); lifecycle.terminalExited(identity, { exitCode: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['prepare', identity], ['base-start', identity, 42], ['open', 'project-a', 'session-a'], ['input', identity], ['base-exit', identity, { exitCode: 0 }], ['exit', 'session-a']]);
  assert.deepEqual(failures, []);
});

test('bridge setup failure is reported unavailable without rejecting terminal lifecycle', async () => {
  const failures = [];
  const lifecycle = composeRemoteMcpTerminalLifecycle(() => ({ open: async () => { throw new Error('helper absent'); }, onSessionExit: async () => false }), undefined, (identity, error) => failures.push([identity.sessionId, error.message]));
  const identity = { serverId: 'server-a', projectId: 'project-a', sessionId: 'session-a' };
  assert.doesNotThrow(() => lifecycle.terminalStarted(identity, 42));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(failures, [['session-a', 'helper absent']]);
});
