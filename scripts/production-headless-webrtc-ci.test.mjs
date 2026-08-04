import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
const job = workflow.slice(
	workflow.indexOf('  production-headless-webrtc:'),
	workflow.indexOf('  e2e-test:'),
);

test('mock WebRTC compatibility proof cannot silently skip on PRs or main', () => {
	assert.match(
		workflow,
		/on:\n {2}pull_request:\n {2}push:\n {4}branches:\n {6}- main/u,
	);
	assert.doesNotMatch(job, /^\s+if:/mu);
	assert.match(job, /name: Headless WebRTC Mock Compatibility \(\$\{\{ matrix\.arch \}\}\)/u);
	assert.match(job, /node scripts\/webrtc-compatibility-proof\.mjs/u);
	assert.match(job, /--mock/u);
	assert.match(job, /--expected-arch=\$\{\{ matrix\.arch \}\}/u);
	assert.doesNotMatch(job, /production-headless-webrtc-secure-werift\.test\.mjs/u);
	assert.doesNotMatch(job, /TERMINAY_RUN_SIBLING_WEBRTC_BRIDGE_PROOF/u);
	assert.doesNotMatch(job, /terminay\.com|HOSTED_(?:GITHUB|GITEA)|secrets\./u);
	assert.deepEqual(
		[...job.matchAll(/^\s+- arch: (x64|arm64)$/gmu)].map((match) => match[1]),
		['x64', 'arm64'],
	);
});
