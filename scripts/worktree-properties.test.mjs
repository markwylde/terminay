import assert from 'node:assert/strict';
import test from 'node:test';
import {
	parseWorktreeProperties,
	parseWorktreeSignInPrompt,
} from '../src/services/git/worktreeProperties.ts';
import {
	checksAccessibleName,
	checksTone,
	hasWorktreeProperties,
	orderedCheckItems,
	pullRequestAccessibleName,
} from '../src/components/git-panel/worktreePropertyPresentation.ts';

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

test('the checks tone is failed, then pending, then passed', () => {
	assert.equal(checksTone(checks), 'failed');
	assert.equal(checksTone({ ...checks, failed: 0 }), 'pending');
	assert.equal(checksTone({ ...checks, failed: 0, pending: 0 }), 'passed');
});

test('chips expose accessible names with the pull request number and counts', () => {
	assert.equal(
		checksAccessibleName(checks),
		'Checks: 2 failed, 12 passed, 2 pending. Show checks',
	);
	assert.match(
		pullRequestAccessibleName({ number: 285, title: 'About window', url: 'https://x.example/p/285', state: 'open' }),
		/^Pull request #285, open: About window/,
	);
});

test('check items list failures first', () => {
	assert.deepEqual(
		orderedCheckItems(checks).map((item) => item.state),
		['failed', 'pending', 'passed'],
	);
});

test('rows without properties show nothing', () => {
	assert.equal(hasWorktreeProperties(undefined), false);
	assert.equal(hasWorktreeProperties({}), false);
	assert.equal(hasWorktreeProperties({ checks }), true);
});

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
