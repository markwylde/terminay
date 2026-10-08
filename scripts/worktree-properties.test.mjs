import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parseWorktreeProperties,
	parseWorktreeSignInPrompt,
} from '../src/services/git/worktreeProperties.ts';

const checks = {
	passed: 12,
	failed: 2,
	pending: 2,
	skipped: 0,
	total: 16,
	items: [
		{ name: 'CI / Lint', state: 'passed'  },
		{ name: 'CI / E2E (2/10)', state: 'pending'  },
		{ name: 'CI / Build', state: 'failed' , url: 'https://git.example.net/r/1' },
	],
};

test('the listing parser keeps valid properties and drops unsafe links', () => {
	const parsed = parseWorktreeProperties({
		pullRequest: { number: 7, title: 'x', url: 'https://a:b@evil.example/', state: 'open' },
		checks: { ...checks, url: 'javascript:alert(1)', items: [{ name: 'a', state: 'failed', url: 'http://plain.example/' }] },
	});
	assert.equal(parsed?.pullRequest, undefined);
	assert.equal(parsed?.checks?.url, undefined);
	assert.deepEqual(parsed?.checks?.items, [{ name: 'a', state: 'failed' }]);
	assert.equal(parseWorktreeProperties('nonsense'), undefined);
});

test('the sign-in prompt parser requires an HTTPS origin', () => {
	assert.deepEqual(
		parseWorktreeSignInPrompt({ extensionId: 'com.terminay.gitea', origin: 'https://git.example.net', provider: 'Gitea' }),
		{ extensionId: 'com.terminay.gitea', origin: 'https://git.example.net', provider: 'Gitea' },
	);
	assert.equal(
		parseWorktreeSignInPrompt({ extensionId: 'x', origin: 'http://git.example.net', provider: 'Gitea' }),
		undefined,
	);
});
