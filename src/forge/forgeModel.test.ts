import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createForgeClickIntent,
	defaultIssueBranch,
	FORGE_DOUBLE_CLICK_MS,
	forgeItemPlaceholderTitle,
	forgeItemTabTitle,
	emptyReason,
	groupByRepository,
	linkify,
	orderedChecks,
	projectPullRequestGroups,
	pullRequestActions,
	readForgeItemTarget,
	readGitPaneLayout,
	readPreferences,
	reviewPrompt,
	startWorkAvailability,
	startWorkPrompt,
	worktreeChipLabel,
} from './forgeModel.ts';

const ORIGIN = 'https://git.example.net';

function entry(number: number, updatedAt: string, extra: Record<string, unknown> = {}, repo = 'app') {
	return {
		sourceId: 'com.terminay.gitea/forge',
		item: {
			reference: { kind: 'pullRequest' as const, origin: ORIGIN, owner: 'acme', name: repo, number },
			title: `PR ${number}`,
			url: `${ORIGIN}/acme/${repo}/pulls/${number}`,
			state: 'open' as const,
			author: 'octo',
			labels: [],
			comments: 0,
			createdAt: updatedAt,
			updatedAt,
			pullRequest: { headBranch: `b${number}`, baseBranch: 'main', headOwner: 'acme', headName: repo },
			...extra,
		},
		worktrees: [],
	};
}

test('a first visit selects Needs my review, open, grouped by repository', () => {
	assert.deepEqual(readPreferences('pullRequest', null), { scope: 'reviewRequested', state: 'open', group: 'repo' });
	assert.deepEqual(readPreferences('issue', 'not json'), { scope: 'assigned', state: 'open', group: 'repo' });
	assert.deepEqual(readPreferences('issue', '{"scope":"mentioned","state":"closed","group":"none"}'), { scope: 'mentioned', state: 'closed', group: 'none' });
	assert.equal(readPreferences('issue', '{"state":"merged"}').state, 'open', 'issues have no merged state');
});

test('groups are repositories in the order of their newest item', () => {
	const groups = groupByRepository([
		entry(1, '2026-11-01T00:00:00Z'),
		entry(2, '2026-11-03T00:00:00Z', {}, 'site'),
		entry(3, '2026-11-02T00:00:00Z'),
	]);
	assert.deepEqual(groups.map((group) => [group.name, group.items.map((item) => item.item.reference.number)]), [
		['site', [2]],
		['app', [3, 1]],
	]);
});

test('the worktree chip names the first project and how many more', () => {
	const title = (id: string) => ({ a: 'Forum', b: 'Forum Review' })[id];
	const matches = [
		{ projectId: 'b', worktreeId: 'w2', branch: 'x' },
		{ projectId: 'a', worktreeId: 'w1', branch: 'x' },
	];
	assert.equal(worktreeChipLabel(matches, title, ['a', 'b']), 'Forum +1');
	assert.equal(worktreeChipLabel(matches.slice(0, 1), title, ['a', 'b']), 'Forum Review');
	assert.equal(worktreeChipLabel([], title, []), undefined);
});

test('the default branch for an issue is a 64-character slug', () => {
	assert.equal(
		defaultIssueBranch(541, 'Home sidebar: Pull Requests and Issues sections'),
		'issue-541-home-sidebar-pull-requests-and-issues-sections',
	);
	const long = defaultIssueBranch(7, 'A very long title that goes on and on and on past the limit of characters');
	assert.ok(long.length <= 64);
	assert.ok(!long.endsWith('-'));
	assert.equal(defaultIssueBranch(9, '!!!'), 'issue-9');
	assert.equal(defaultIssueBranch(3, 'Café crème'), 'issue-3-cafe-creme');
});

test('prompts name the number, title, and URL', () => {
	const item = entry(88, '2026-11-01T00:00:00Z').item;
	assert.match(reviewPrompt(item), /#88, "PR 88" \(https:\/\/git\.example\.net\/acme\/app\/pulls\/88\)/u);
	const prompt = startWorkPrompt({ ...item, reference: { ...item.reference, kind: 'issue' } }, 'The   sidebar\nshould list them.');
	assert.match(prompt, /issue #88/u);
	assert.match(prompt, /"The sidebar should list them\."/u);
	assert.ok(!prompt.startsWith('-'));
});

test('pull request actions say why they are unavailable', () => {
	const projects = [{ projectId: 'p', title: 'App' }];
	const fork = { ...entry(1, 'x'), item: { ...entry(1, 'x').item, pullRequest: { headBranch: 'main', baseBranch: 'main', headOwner: 'forker', headName: 'app' } } };
	const forkActions = pullRequestActions(fork, projects, true, true);
	assert.equal(forkActions.checkOut.enabled, false);
	assert.match(forkActions.checkOut.reason ?? '', /forks/u);
	assert.equal(forkActions.review.enabled, false);
	assert.match(pullRequestActions(entry(1, 'x'), [], true, true).checkOut.reason ?? '', /Open this repository/u);
	const matched = { ...entry(1, 'x'), worktrees: [{ projectId: 'p', worktreeId: 'w', branch: 'b1' }] };
	const actions = pullRequestActions(matched, projects, true, true);
	assert.deepEqual([actions.openWorktree.enabled, actions.checkOut.enabled, actions.review.enabled], [true, false, true]);
	assert.equal(pullRequestActions(entry(1, 'x'), projects, true, true).checkOut.enabled, true);
	assert.equal(pullRequestActions(entry(1, 'x'), projects, false, true).checkOut.enabled, false);
	assert.equal(startWorkAvailability([], true).enabled, false);
});

test('failed and pending checks come first', () => {
	const checks = { passed: 1, failed: 2, pending: 1, skipped: 0, total: 4, items: [
		{ name: 'lint', state: 'passed' as const },
		{ name: 'e2e', state: 'failed' as const },
		{ name: 'unit', state: 'pending' as const },
		{ name: 'build', state: 'failed' as const },
	] };
	assert.deepEqual(orderedChecks(checks).map((check) => check.name), ['e2e', 'build', 'unit', 'lint']);
});

test('an empty list says why', () => {
	assert.deepEqual(emptyReason(0, 0, []), { kind: 'noAccounts' });
	assert.deepEqual(emptyReason(0, 1, []), { kind: 'noMatches' });
	const failed = [{ sourceId: 's', state: 'failed' as const, error: 'timeout' }];
	assert.deepEqual(emptyReason(0, 1, failed), { kind: 'failed', sources: failed });
	assert.deepEqual(emptyReason(3, 1, failed), { kind: 'failed', sources: failed }, 'items from others still show');
	assert.equal(emptyReason(3, 1, []), undefined);
});

test('bodies are text with links, never markup', () => {
	assert.deepEqual(linkify('<script>x</script> see https://example.com/a.'), [
		{ text: '<script>x</script> see ' },
		{ text: 'https://example.com/a', url: 'https://example.com/a' },
		{ text: '.' },
	]);
	assert.deepEqual(linkify('javascript:alert(1)'), [{ text: 'javascript:alert(1)' }]);
});

test('the project tab lists this worktree first and at most five merged', () => {
	const mine = { ...entry(535, '2026-11-01T00:00:00Z'), worktrees: [{ projectId: 'p', worktreeId: 'w', branch: 'b' }] };
	const merged = Array.from({ length: 7 }, (_, index) => entry(100 + index, `2026-10-0${index + 1}T00:00:00Z`, { state: 'merged' }));
	const groups = projectPullRequestGroups([entry(1, '2026-11-05T00:00:00Z'), mine], merged, 'w');
	assert.deepEqual(groups.map((group) => [group.id, group.items.length]), [['thisWorktree', 1], ['open', 1], ['merged', 5]]);
	assert.equal(groups[0]?.items[0]?.item.reference.number, 535);
});

test('the Git tab layout defaults to Issues then Pull Requests, and keeps what it can of a stored one', () => {
	const fresh = readGitPaneLayout(null);
	assert.deepEqual(fresh.order, ['issues', 'pullRequests']);
	assert.deepEqual(fresh.collapsed, { issues: false, pullRequests: false });
	assert.deepEqual(readGitPaneLayout('not json').order, ['issues', 'pullRequests']);
	const stored = readGitPaneLayout(
		JSON.stringify({
			order: ['pullRequests', 'bogus'],
			collapsed: { pullRequests: true },
			heights: { issues: 90, pullRequests: -1 },
		}),
	);
	assert.deepEqual(stored.order, ['pullRequests', 'issues']);
	assert.deepEqual(stored.collapsed, { issues: false, pullRequests: true });
	assert.equal(stored.heights.issues, 90);
	assert.equal(stored.heights.pullRequests, fresh.heights.pullRequests);
});

function fakeTimers() {
	const pending = new Map<number, () => void>();
	let next = 0;
	const delays: number[] = [];
	return {
		delays,
		pending,
		timers: {
			set: (run: () => void, delayMs: number) => {
				next += 1;
				pending.set(next, run);
				delays.push(delayMs);
				return next;
			},
			clear: (handle: unknown) => {
				pending.delete(handle as number);
			},
		},
		flush: () => {
			const runs = [...pending.values()];
			pending.clear();
			for (const run of runs) run();
		},
	};
}

test('a row that leaves the list waits out a single click and drops it for a double click', () => {
	const calls: string[] = [];
	const clock = fakeTimers();
	const intent = createForgeClickIntent(
		() => calls.push('single'),
		() => calls.push('double'),
		clock.timers,
	);
	intent.click(1);
	assert.deepEqual(calls, []);
	assert.deepEqual(clock.delays, [FORGE_DOUBLE_CLICK_MS]);
	clock.flush();
	assert.deepEqual(calls, ['single']);

	calls.length = 0;
	intent.click(1);
	intent.click(2);
	clock.flush();
	assert.deepEqual(calls, ['double']);

	calls.length = 0;
	intent.click(1);
	intent.click(2);
	intent.click(3);
	clock.flush();
	assert.deepEqual(calls, ['double'], 'a third click opens nothing more');
});

test('a keyboard activation of a row acts at once', () => {
	const calls: string[] = [];
	const clock = fakeTimers();
	const intent = createForgeClickIntent(
		() => calls.push('single'),
		() => calls.push('double'),
		clock.timers,
	);
	intent.click(0);
	assert.deepEqual(calls, ['single']);
	assert.equal(clock.pending.size, 0);
});

test('a row that goes away drops its waiting single click', () => {
	const calls: string[] = [];
	const clock = fakeTimers();
	const intent = createForgeClickIntent(
		() => calls.push('single'),
		() => calls.push('double'),
		clock.timers,
	);
	intent.click(1);
	intent.cancel();
	clock.flush();
	assert.deepEqual(calls, []);
});

test('an item tab is titled by repository and number until it loads, then by number and title', () => {
	const reference = { kind: 'issue' as const, origin: ORIGIN, owner: 'acme', name: 'app', number: 540 };
	assert.equal(forgeItemPlaceholderTitle(reference), 'app#540');
	assert.equal(forgeItemTabTitle(reference, ' Open issues in a new tab '), '#540 Open issues in a new tab');
	assert.equal(forgeItemTabTitle(reference, '   '), 'app#540');
});

test('an item tab reads only a well-formed target from its parameters', () => {
	const target = {
		sourceId: 'com.terminay.gitea/forge',
		reference: { kind: 'pullRequest', origin: ORIGIN, owner: 'acme', name: 'app', number: 7 },
	};
	assert.deepEqual(readForgeItemTarget(target), target);
	assert.equal(readForgeItemTarget(undefined), undefined);
	assert.equal(readForgeItemTarget({ ...target, sourceId: '' }), undefined);
	assert.equal(readForgeItemTarget({ ...target, reference: { ...target.reference, kind: 'commit' } }), undefined);
	assert.equal(readForgeItemTarget({ ...target, reference: { ...target.reference, number: 0 } }), undefined);
	assert.equal(readForgeItemTarget({ ...target, reference: { ...target.reference, number: 1.5 } }), undefined);
	assert.equal(readForgeItemTarget({ ...target, reference: { ...target.reference, owner: '' } }), undefined);
	assert.deepEqual(
		readForgeItemTarget({ ...target, extra: true, reference: { ...target.reference, extra: true } }),
		target,
		'only the fields a tab needs are kept',
	);
});
