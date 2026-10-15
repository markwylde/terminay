import type {
	RepositoryWorktree,
	WorktreeCheckItem,
	WorktreeCheckState,
	WorktreeChecks,
	WorktreeProperties,
	WorktreePullRequest,
} from '@terminay/extension-api';
import { isSafeHttpsUrl } from './https.js';
import { MAX_CHECK_ITEMS } from './query.js';

/** The fields read from a `CheckRun` or `StatusContext` rollup node. */
export interface GitHubCheckNode {
	__typename?: unknown;
	name?: unknown;
	status?: unknown;
	conclusion?: unknown;
	detailsUrl?: unknown;
	context?: unknown;
	state?: unknown;
	targetUrl?: unknown;
}

interface StateCount {
	state?: unknown;
	count?: unknown;
}

export interface GitHubCommit {
	statusCheckRollup?: {
		contexts?: {
			totalCount?: unknown;
			checkRunCountsByState?: readonly StateCount[] | null;
			statusContextCountsByState?: readonly StateCount[] | null;
			nodes?: readonly (GitHubCheckNode | null)[] | null;
		} | null;
	} | null;
}

export interface GitHubPullRequest {
	number?: unknown;
	title?: unknown;
	url?: unknown;
	isDraft?: unknown;
	mergeable?: unknown;
	headRefName?: unknown;
	headRepository?: { nameWithOwner?: unknown } | null;
	commits?: {
		nodes?: readonly ({ commit?: GitHubCommit | null } | null)[] | null;
	} | null;
}

/** One aliased `ref` from the query. */
export interface GitHubRef {
	target?: GitHubCommit | null;
	associatedPullRequests?: {
		nodes?: readonly (GitHubPullRequest | null)[] | null;
	} | null;
}

/**
 * The remote branch a worktree follows: its configured upstream, else the
 * same-named branch, as a pull without an upstream does. A detached worktree
 * follows nothing.
 */
export function trackedBranch(
	worktree: RepositoryWorktree,
): string | undefined {
	return worktree.upstream?.branch ?? worktree.branch ?? undefined;
}

/**
 * The open pull request whose head is this branch in this repository. A
 * fork's pull request with the same branch name is not it.
 */
export function matchPullRequest(
	ref: GitHubRef | null | undefined,
	branch: string,
	owner: string,
	repo: string,
): GitHubPullRequest | undefined {
	const fullName = `${owner}/${repo}`.toLowerCase();
	return (ref?.associatedPullRequests?.nodes ?? []).find(
		(pull): pull is GitHubPullRequest =>
			pull !== null &&
			pull.headRefName === branch &&
			typeof pull.headRepository?.nameWithOwner === 'string' &&
			pull.headRepository.nameWithOwner.toLowerCase() === fullName,
	);
}

export function toPullRequest(
	pull: GitHubPullRequest,
): WorktreePullRequest | undefined {
	if (
		!Number.isSafeInteger(pull.number) ||
		(pull.number as number) < 1 ||
		typeof pull.title !== 'string' ||
		pull.title.trim().length === 0 ||
		!isSafeHttpsUrl(pull.url)
	)
		return undefined;
	return {
		number: pull.number as number,
		title: pull.title.slice(0, 512),
		url: pull.url,
		state: pull.isDraft === true ? 'draft' : 'open',
		...(pull.mergeable === 'MERGEABLE'
			? { mergeable: true }
			: pull.mergeable === 'CONFLICTING'
				? { mergeable: false }
				: {}),
	};
}

/** A `CheckRunState` or check-run conclusion as a check state. */
export function checkRunState(value: unknown): WorktreeCheckState {
	switch (value) {
		case 'SUCCESS':
			return 'passed';
		case 'FAILURE':
		case 'TIMED_OUT':
		case 'CANCELLED':
		case 'STARTUP_FAILURE':
		case 'ACTION_REQUIRED':
			return 'failed';
		case 'NEUTRAL':
		case 'SKIPPED':
		case 'STALE':
			return 'skipped';
		default:
			return 'pending';
	}
}

/** A commit `StatusState` as a check state. */
export function statusState(value: unknown): WorktreeCheckState {
	switch (value) {
		case 'SUCCESS':
			return 'passed';
		case 'FAILURE':
		case 'ERROR':
			return 'failed';
		default:
			return 'pending';
	}
}

function nodeItem(node: GitHubCheckNode): WorktreeCheckItem | undefined {
	if (node.__typename === 'CheckRun') {
		if (typeof node.name !== 'string' || node.name.trim() === '')
			return undefined;
		const state =
			node.status === 'COMPLETED' ? checkRunState(node.conclusion) : 'pending';
		return {
			name: node.name.slice(0, 256),
			state,
			...(isSafeHttpsUrl(node.detailsUrl) ? { url: node.detailsUrl } : {}),
		};
	}
	if (node.__typename === 'StatusContext') {
		if (typeof node.context !== 'string' || node.context.trim() === '')
			return undefined;
		return {
			name: node.context.slice(0, 256),
			state: statusState(node.state),
			...(isSafeHttpsUrl(node.targetUrl) ? { url: node.targetUrl } : {}),
		};
	}
	return undefined;
}

const TRUNCATION_ORDER: Record<WorktreeCheckState, number> = {
	failed: 0,
	pending: 1,
	passed: 2,
	skipped: 3,
};

/**
 * A commit's check rollup as a checks summary. Counts come from GitHub's
 * per-state totals, so they cover every check even past the 100 listed;
 * a server without those totals is counted from the listed items. Failed and
 * pending items come first, because they are the ones a person opens the
 * list to find.
 */
export function toChecks(
	commit: GitHubCommit | null | undefined,
): WorktreeChecks | undefined {
	const contexts = commit?.statusCheckRollup?.contexts;
	if (contexts === undefined || contexts === null) return undefined;
	const items: WorktreeCheckItem[] = [];
	for (const node of contexts.nodes ?? []) {
		if (node === null) continue;
		const item = nodeItem(node);
		if (item !== undefined) items.push(item);
	}
	const counts: Record<WorktreeCheckState, number> = {
		passed: 0,
		failed: 0,
		pending: 0,
		skipped: 0,
	};
	const runCounts = contexts.checkRunCountsByState;
	const statusCounts = contexts.statusContextCountsByState;
	if (Array.isArray(runCounts) && Array.isArray(statusCounts)) {
		for (const entry of runCounts)
			add(counts, checkRunState(entry.state), entry.count);
		for (const entry of statusCounts)
			add(counts, statusState(entry.state), entry.count);
	} else for (const item of items) counts[item.state] += 1;
	const total = counts.passed + counts.failed + counts.pending + counts.skipped;
	if (total === 0) return undefined;
	const ordered = items
		.map((item, index) => ({ item, index }))
		.sort(
			(left, right) =>
				TRUNCATION_ORDER[left.item.state] -
					TRUNCATION_ORDER[right.item.state] || left.index - right.index,
		)
		.slice(0, Math.min(MAX_CHECK_ITEMS, total))
		.map(({ item }) => item);
	return { ...counts, total, items: ordered };
}

function add(
	counts: Record<WorktreeCheckState, number>,
	state: WorktreeCheckState,
	count: unknown,
): void {
	if (Number.isSafeInteger(count) && (count as number) > 0)
		counts[state] += count as number;
}

/**
 * A branch's properties: its pull request, and the checks of the pull
 * request's head commit, else of the branch's head commit.
 */
export function toProperties(
	ref: GitHubRef | null | undefined,
	branch: string,
	owner: string,
	repo: string,
): WorktreeProperties | null {
	if (ref === null || ref === undefined) return null;
	const pull = matchPullRequest(ref, branch, owner, repo);
	const pullRequest = pull === undefined ? undefined : toPullRequest(pull);
	const head = pull?.commits?.nodes?.at(-1)?.commit;
	const checks = toChecks(head ?? ref.target);
	if (pullRequest === undefined && checks === undefined) return null;
	return {
		...(pullRequest === undefined ? {} : { pullRequest }),
		...(checks === undefined ? {} : { checks }),
	};
}
