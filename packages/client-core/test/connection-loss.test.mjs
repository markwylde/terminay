import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientError, ClientDisconnectedError, CommandOutcomeUnknownError, RequestNotSentError, isClientConnectionLoss } from '../dist/index.js';

test('shared connection-loss classification follows bounded causes without swallowing generic refusals', () => {
 for (const error of [new ClientDisconnectedError(), new CommandOutcomeUnknownError('command-1'), new RequestNotSentError()]) {
  assert.equal(isClientConnectionLoss(error), true);
  assert.equal(isClientConnectionLoss(new Error('feature wrapper', { cause: error })), true);
 }
 for (const error of [new ClientError('unavailable', 'service unavailable'), new ClientError('forbidden', 'no'), null, 'disconnected']) assert.equal(isClientConnectionLoss(error), false);
 const cyclic = new Error('cycle'); cyclic.cause = cyclic;
 assert.equal(isClientConnectionLoss(cyclic), false);
});
