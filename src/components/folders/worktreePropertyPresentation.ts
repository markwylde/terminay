import type {
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';

type Checks = NonNullable<WorktreeProperties['checks']>;
/** The counts a row carries; the items arrive only when its list is opened. */
type CheckCounts = Pick<Checks, 'failed' | 'pending' | 'passed' | 'skipped'>;
/** A pull request as a folder row knows it. The state is the forge's word. */
type PullRequest = {
	number: number;
	title: string;
	state: string;
	mergeable?: boolean;
};

export type ChecksTone = 'failed' | 'pending' | 'passed';

/** Failed wins over pending, which wins over passed. */
export function checksTone(
	checks: Pick<CheckCounts, 'failed' | 'pending'>,
): ChecksTone {
	if (checks.failed > 0) return 'failed';
	if (checks.pending > 0) return 'pending';
	return 'passed';
}

/** The number a row shows for its checks: failures first, then running, then
 * passed. */
export function checksHeadline(checks: CheckCounts): number {
	return checks.failed || checks.pending || checks.passed;
}

export function checksAccessibleName(checks: CheckCounts): string {
	const parts = [
		`${checks.failed} failed`,
		`${checks.passed} passed`,
		`${checks.pending} pending`,
	];
	if (checks.skipped > 0) parts.push(`${checks.skipped} skipped`);
	return `Checks: ${parts.join(', ')}. Show checks`;
}

const PULL_REQUEST_STATE_LABELS: Readonly<Record<string, string>> = {
	open: 'open',
	draft: 'draft',
	merged: 'merged',
	closed: 'closed',
};

function pullRequestStateLabel(pullRequest: PullRequest): string {
	return PULL_REQUEST_STATE_LABELS[pullRequest.state] ?? pullRequest.state;
}

export function pullRequestAccessibleName(pullRequest: PullRequest): string {
	return `Pull request #${pullRequest.number}, ${pullRequestStateLabel(pullRequest)}: ${pullRequest.title}. Open in browser`;
}

export function pullRequestTitle(pullRequest: PullRequest): string {
	const mergeable =
		pullRequest.mergeable === false ? '\nHas merge conflicts' : '';
	return `#${pullRequest.number} ${pullRequest.title}\n${pullRequestStateLabel(pullRequest)}${mergeable}`;
}

const CHECK_ORDER: Readonly<Record<WorktreeCheckState, number>> = {
	failed: 0,
	pending: 1,
	passed: 2,
	skipped: 3,
};

/** Failures first, then pending, then the rest; names break ties. */
export function orderedCheckItems(
	checks: Pick<Checks, 'items'>,
): Checks['items'] {
	return [...checks.items].sort(
		(left, right) =>
			CHECK_ORDER[left.state] - CHECK_ORDER[right.state] ||
			left.name.localeCompare(right.name),
	);
}

/** Checks listed before the rest are collapsed into a "+ N more" line. */
export const CHECK_LIST_LIMIT = 6;

/**
 * The checks a list shows and how many it leaves out. Everything that needs
 * attention is listed; passes fill what room is left.
 */
export function shownCheckItems(checks: Checks): {
	shown: Checks['items'];
	hidden: number;
} {
	const items = orderedCheckItems(checks);
	const attention = items.filter((item) => item.state !== 'passed');
	const passed = items.filter((item) => item.state === 'passed');
	const shown = [
		...attention,
		...passed.slice(0, Math.max(0, CHECK_LIST_LIMIT - attention.length)),
	];
	return { shown, hidden: Math.max(0, checks.total - shown.length) };
}

export function hasWorktreeProperties(
	properties: WorktreeProperties | undefined,
): properties is WorktreeProperties {
	return (
		properties !== undefined &&
		(properties.pullRequest !== undefined || properties.checks !== undefined)
	);
}
