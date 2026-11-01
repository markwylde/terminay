import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestAdmission } from '../dist/requestAdmission.js';
import { RequestNotSentError } from '../dist/index.js';

for (const reason of ['custom', null, 123, new Error('custom')]) {
 test(`admission normalizes cancellation consistently: ${String(reason)}`, async () => {
  const admission = new RequestAdmission(() => 1);
  const release = admission.acquire(1);
  const controller = new AbortController();
  const pending = admission.acquire(1, controller.signal);
  controller.abort(reason);
  const check = error => reason instanceof Error ? error === reason : error instanceof Error && error.name === 'AbortError';
  await assert.rejects(pending, check);
  await assert.rejects(admission.acquire(1, controller.signal), check);
  assert.equal(admission.waiting.length, 0);
  release();
 });
}
test('admission clear distinguishes unsent requests and releases accounting', async () => {
 const admission = new RequestAdmission(() => 1);
 const release = admission.acquire(1);
 const pending = admission.acquire(1);
 admission.clear();
 await assert.rejects(pending, error => error instanceof RequestNotSentError && error.sent === false && error.code === 'unavailable');
 release();
 const next = admission.acquire(1); assert.equal(typeof next, 'function'); next();
});
