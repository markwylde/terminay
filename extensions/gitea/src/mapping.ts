import type {
	RepositoryWorktree,
	WorktreeCheckItem,
	WorktreeCheckState,
	WorktreeChecks,
	WorktreeProperties,
	WorktreePullRequest,
} from '@terminay/extension-api';
import { isSafeHttpsUrl } from './https.js';

export const MAX_CHECK_ITEMS = 100;

/** The fields read from Gitea's `GET /repos/{owner}/{repo}/pulls`. */
export interface GiteaPullRequest {
	number?: unknown;
	title?: unknown;
	html_url?: unknown;
	draft?: unknown;
	mergeable?: unknown;
	head?: {
		ref?: unknown;
		sha?: unknown;
		repo?: { full_name?: unknown } | null;
	} | null;
}

/** The fields read from Gitea's combined commit status. */
export interface GiteaCommitStatus {
	context?: unknown;
	status?: unknown;
	state?: unknown;
	target_url?: unknown;
}

/**
 * The open pull request whose head is this worktree's upstream branch in
 * this repository. A fork's pull request with the same branch name is not it.
 */
export function matchPullRequest(
	pulls: readonly GiteaPullRequest[],
	worktree: RepositoryWorktree,
	owner: string,
	repo: string,
): GiteaPullRequest | undefined {
	const branch = worktree.upstream?.branch;
	if (branch === undefined) return undefined;
	const fullName = `${owner}/${repo}`.toLowerCase();
	return pulls.find((pull) => {
		if (pull.head?.ref !== branch) return false;
		const headRepo = pull.head.repo?.full_name;
		return typeof headRepo !== 'string' || headRepo.toLowerCase() === fullName;
	});
}

const WIP_TITLE = /^\s*(\[wip\]|wip:)/i;

export function toPullRequest(
	pull: GiteaPullRequest,
): WorktreePullRequest | undefined {
	if (
		!Number.isSafeInteger(pull.number) ||
		(pull.number as number) < 1 ||
		typeof pull.title !== 'string' ||
		pull.title.trim().length === 0 ||
		!isSafeHttpsUrl(pull.html_url)
	)
		return undefined;
	const draft = pull.draft === true || WIP_TITLE.test(pull.title);
	return {
		number: pull.number as number,
		title: pull.title.slice(0, 512),
		url: pull.html_url,
		state: draft ? 'draft' : 'open',
		...(typeof pull.mergeable === 'boolean'
			? { mergeable: pull.mergeable }
			: {}),
	};
}

export function checkState(value: unknown): WorktreeCheckState {
	switch (value) {
		case 'success':
			return 'passed';
		case 'failure':
		case 'error':
			return 'failed';
		case 'skipped':
		case 'warning':
			return 'skipped';
		default:
			return 'pending';
	}
}

const TRUNCATION_ORDER: Record<WorktreeCheckState, number> = {
	failed: 0,
	pending: 1,
	passed: 2,
	skipped: 3,
};

/**
 * Commit statuses as a checks summary. Counts cover every status; when items
 * must be truncated, failed and pending ones are kept first because they are
 * the ones a person opens the list to find.
 */
export function toChecks(
	statuses: readonly GiteaCommitStatus[],
	origin?: string,
): WorktreeChecks | undefined {
	const all: WorktreeCheckItem[] = [];
	for (const status of statuses) {
		if (typeof status.context !== 'string' || status.context.trim() === '')
			continue;
		all.push({
			name: status.context.slice(0, 256),
			state: checkState(status.status ?? status.state),
			...targetUrl(status.target_url, origin),
		});
	}
	if (all.length === 0) return undefined;
	const count = (state: WorktreeCheckState) =>
		all.filter((item) => item.state === state).length;
	const items =
		all.length <= MAX_CHECK_ITEMS
			? all
			: all
					.map((item, index) => ({ item, index }))
					.sort(
						(left, right) =>
							TRUNCATION_ORDER[left.item.state] -
								TRUNCATION_ORDER[right.item.state] || left.index - right.index,
					)
					.slice(0, MAX_CHECK_ITEMS)
					.map(({ item }) => item);
	return {
		passed: count('passed'),
		failed: count('failed'),
		pending: count('pending'),
		skipped: count('skipped'),
		total: all.length,
		items,
	};
}

/**
 * Gitea Actions reports a status's target as a path on the server, such as
 * `/owner/repo/actions/runs/1/jobs/0`; other CI reports absolute URLs.
 */
function targetUrl(value: unknown, origin?: string): { url?: string } {
	if (typeof value !== 'string' || value.length === 0) return {};
	let url: string = value;
	if (origin !== undefined && value.startsWith('/') && !value.startsWith('//')) {
		try {
			url = new URL(value, origin).href;
		} catch {
			return {};
		}
	}
	return isSafeHttpsUrl(url) ? { url } : {};
}

export function toProperties(
	pull: GiteaPullRequest | undefined,
	statuses: readonly GiteaCommitStatus[],
	origin?: string,
): WorktreeProperties | null {
	const pullRequest = pull === undefined ? undefined : toPullRequest(pull);
	const checks = toChecks(statuses, origin);
	if (pullRequest === undefined && checks === undefined) return null;
	return {
		...(pullRequest === undefined ? {} : { pullRequest }),
		...(checks === undefined ? {} : { checks }),
	};
}
