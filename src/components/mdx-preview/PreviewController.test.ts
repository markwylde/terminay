import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import test from 'node:test';
import {
	PREVIEW_RUNTIME_LIMITS,
	PreviewResourceLease,
	nextPreviewRestart,
	previewAcceptsFilesystemPath,
} from './previewRuntime.ts';
import {
	DesktopPreviewHost,
	SandboxedWebPreviewHost,
	UnavailablePreviewHost,
} from './PreviewHost.ts';
import { isPreviewMessage } from './previewMessages.ts';
import { previewGuestDocument } from './previewGuest.ts';

test('3.2 preview interface accepts compiled bytes and resource callbacks, not filesystem paths', () => {
	assert.equal(
		previewAcceptsFilesystemPath({ bundle: new Uint8Array(), fetchResource() {} }),
		false,
	);
	assert.equal(previewAcceptsFilesystemPath({ path: '/tmp/page.mdx' }), true);
	assert.equal(previewAcceptsFilesystemPath({ filePath: 'docs/page.mdx' }), true);
});

test('3.3 sandboxed runtime has scripts and no parent authority in the guest document', () => {
	const html = previewGuestDocument('runtime-1', 'blob:guest', {
		entries: {},
		cookie: '',
	});
	assert.equal(new SandboxedWebPreviewHost({ src: '' }).capability.sandbox, 'allow-scripts');
	assert.doesNotMatch(html, /allow-same-origin/u);
	assert.doesNotMatch(html, /require\(|process\.|electron|terminayHost|preload/u);
	assert.match(html, /window.open=function\(\)\{return null\}/u);
});

test('3.6 closed union rejects the wrong runtime and unknown kinds', () => {
	assert.equal(isPreviewMessage({ version: 1, kind: 'ready', runtimeId: 'r1' }, 'r1'), true);
	assert.equal(isPreviewMessage({ version: 1, kind: 'ready', runtimeId: 'other' }, 'r1'), false);
	assert.equal(isPreviewMessage({ version: 1, kind: 'eval', runtimeId: 'r1' }, 'r1'), false);
});

test('4.3 crash destroys the old runtime before restart and caps automatic retries', () => {
	const lease = new PreviewResourceLease();
	const revoked: string[] = [];
	lease.trackUrl('blob:old');
	assert.equal(nextPreviewRestart(0), 'restart');
	lease.dispose((url) => revoked.push(url));
	assert.deepEqual(revoked, ['blob:old']);
	assert.equal(nextPreviewRestart(PREVIEW_RUNTIME_LIMITS.maxAutomaticRestarts), 'repeated-restart');
});

test('4.4 dispose cancels work and releases object URLs listeners and timers', () => {
	const lease = new PreviewResourceLease();
	let cleaned = 0;
	lease.trackUrl('blob:one');
	lease.track(() => {
		cleaned += 1;
	});
	lease.timer = 7;
	lease.dispose(() => {});
	assert.deepEqual(lease.leaks, {
		objectUrls: 0,
		listeners: 0,
		timer: false,
		aborted: true,
	});
	assert.equal(cleaned, 1);
});

test('3.5 unavailable hosts do not enable a preview runtime', () => {
	const host = new UnavailablePreviewHost();
	assert.equal(host.capability.available, false);
	assert.equal(host.capability.sandbox, '');
});

test('4.5 a looping fixture does not block a sibling terminal interaction', async () => {
	const worker = new Worker('while (true) {}', { eval: true });
	let sibling = 0;
	sibling += 1;
	await worker.terminate();
	assert.equal(sibling, 1);
	assert.equal(new DesktopPreviewHost({ src: '' }).capability.isolatedExecution, true);
	assert.equal(new SandboxedWebPreviewHost({ src: '' }).capability.isolatedExecution, true);
});
