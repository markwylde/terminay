import assert from 'node:assert/strict';
import test from 'node:test';
import { isPreviewMessage } from './previewMessages.ts';

test('3.6 accepts the closed message union and ignores everything else', () => {
	assert.equal(isPreviewMessage({ version: 1, kind: 'ready', runtimeId: 'r1' }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'resize', runtimeId: 'r1', height: 40 }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'diagnostic', runtimeId: 'r1', message: 'boom' }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'open-document', runtimeId: 'r1', path: 'docs/guide.mdx' }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'download', runtimeId: 'r1', url: 'https://example.com/a.png' }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'ready', runtimeId: 'other' }, 'r1'), false);
	assert.equal(isPreviewMessage({ version: 2, kind: 'ready', runtimeId: 'r1' }, 'r1'), false);
	assert.equal(isPreviewMessage({ version: 1, kind: 'eval', runtimeId: 'r1', code: 'alert(1)' }, 'r1'), false);
	assert.equal(isPreviewMessage({ version: 1, kind: 'open-document', runtimeId: 'r1', path: '/etc/passwd' }, 'r1'), false);
	assert.equal(isPreviewMessage({ version: 1, kind: 'download', runtimeId: 'r1', url: 'file:///tmp/a' }, 'r1'), false);
});
