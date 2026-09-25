import type {
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';

type Checks = NonNullable<WorktreeProperties['checks']>;
type PullRequest = NonNullable<WorktreeProperties['pullRequest']>;

export type ChecksTone = 'failed' | 'pending' | 'passed';

/** Failed wins over pending, which wins over passed. */
export function checksTone(checks: Checks): ChecksTone {
	if (checks.failed > 0) return 'failed';
	if (checks.pending > 0) return 'pending';
	return 'passed';
}

export function checksAccessibleName(checks: Checks): string {
	const parts = [
		`${checks.failed} failed`,
		`${checks.passed} passed`,
		`${checks.pending} pending`,
	];
	if (checks.skipped > 0) parts.push(`${checks.skipped} skipped`);
	return `Checks: ${parts.join(', ')}. Show checks`;
}

const PULL_REQUEST_STATE_LABELS: Readonly<
	Record<PullRequest['state'], string>
> = {
	open: 'open',
	draft: 'draft',
	merged: 'merged',
	closed: 'closed',
};

export function pullRequestAccessibleName(pullRequest: PullRequest): string {
	return `Pull request #${pullRequest.number}, ${PULL_REQUEST_STATE_LABELS[pullRequest.state]}: ${pullRequest.title}. Open in browser`;
}

export function pullRequestTitle(pullRequest: PullRequest): string {
	const mergeable =
		pullRequest.mergeable === false ? '\nHas merge conflicts' : '';
	return `#${pullRequest.number} ${pullRequest.title}\n${PULL_REQUEST_STATE_LABELS[pullRequest.state]}${mergeable}`;
}

const CHECK_ORDER: Readonly<Record<WorktreeCheckState, number>> = {
	failed: 0,
	pending: 1,
	passed: 2,
	skipped: 3,
};

/** Failures first, then pending, then the rest; names break ties. */
export function orderedCheckItems(checks: Checks): Checks['items'] {
	return [...checks.items].sort(
		(left, right) =>
			CHECK_ORDER[left.state] - CHECK_ORDER[right.state] ||
			left.name.localeCompare(right.name),
	);
}

export function hasWorktreeProperties(
	properties: WorktreeProperties | undefined,
): properties is WorktreeProperties {
	return (
		properties !== undefined &&
		(properties.pullRequest !== undefined || properties.checks !== undefined)
	);
}
