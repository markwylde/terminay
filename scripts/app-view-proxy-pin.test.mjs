import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * The sandbox proxy is also served by terminay.com for hosted sessions, from a
 * copy of this file (`app/src/app-view.html` there). The two ship separately,
 * so nothing else would notice them drifting apart. terminay.com pins the same
 * digest in `specs/appView.test.mjs`. Change the proxy, copy it there, and
 * update both digests together.
 */
const PROXY_SHA256 = '792f5f123a822abeda062d658ab28a937a6750d94216425ac6eef6f96308162d';

test('the sandbox proxy is the one terminay.com serves', async () => {
	const html = await readFile(new URL('../public/app-view.html', import.meta.url));
	assert.equal(
		createHash('sha256').update(html).digest('hex'),
		PROXY_SHA256,
		'public/app-view.html changed: copy it to terminay.com and update the digest in both repositories',
	);
});
