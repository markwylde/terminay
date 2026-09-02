/**
 * Shared formatting for the fixed-size circular activity count badges shown
 * on the header activity dropdown and on each project tab.
 */

export type ActivityBadgeState = 'attention' | 'recent' | 'unviewed';

export type ActivityCountBadge = {
	count: number;
	state: ActivityBadgeState;
};

export type ActivityBadgeSourceState =
	| ActivityBadgeState
	| 'working'
	| 'waiting'
	| 'blocked'
	| 'done';

export const ACTIVITY_COUNT_BADGE_MAX = 99;

const BADGE_STATE_PRIORITY: Record<ActivityBadgeState, number> = {
	attention: 0,
	recent: 1,
	unviewed: 2,
};

export function formatActivityCount(count: number): string {
	if (!Number.isFinite(count) || count <= 0) return '0';
	if (count > ACTIVITY_COUNT_BADGE_MAX) return `${ACTIVITY_COUNT_BADGE_MAX}+`;
	return String(Math.floor(count));
}

export function activityCountDigits(label: string): 1 | 2 | 3 {
	if (label.length <= 1) return 1;
	if (label.length === 2) return 2;
	return 3;
}

export function activityBadgeStateForSource(
	state: ActivityBadgeSourceState,
): ActivityBadgeState {
	if (state === 'attention' || state === 'waiting' || state === 'blocked')
		return 'attention';
	if (state === 'recent' || state === 'working') return 'recent';
	return 'unviewed';
}

export function summarizeActivityBadge(
	states: readonly ActivityBadgeSourceState[],
): ActivityCountBadge | null {
	if (states.length === 0) return null;
	let highest: ActivityBadgeState = 'unviewed';
	for (const source of states) {
		const state = activityBadgeStateForSource(source);
		if (BADGE_STATE_PRIORITY[state] < BADGE_STATE_PRIORITY[highest])
			highest = state;
	}
	return { count: states.length, state: highest };
}

export function activityBadgeStateLabel(state: ActivityBadgeState): string {
	if (state === 'attention') return 'needs attention';
	if (state === 'recent') return 'working';
	return 'finished';
}

export function activityBadgeAriaLabel(badge: ActivityCountBadge): string {
	const noun = badge.count === 1 ? 'terminal' : 'terminals';
	return `${badge.count} ${noun}, ${activityBadgeStateLabel(badge.state)}`;
}
