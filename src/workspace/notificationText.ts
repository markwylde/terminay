/**
 * The words a row in the header Notifications list uses: what happened, and
 * how long ago. Kept apart from the component so the wording has one home.
 */

import type { AgentState } from '../types/agentStatus';

type ListedState = Exclude<AgentState, 'idle' | 'working'>;

const AGENT_HEADLINES: Record<ListedState, string> = {
	blocked: 'Agent is blocked',
	done: 'Agent finished',
	waiting: 'Agent is waiting for you',
};

const TERMINAL_HEADLINES: Record<ListedState, string> = {
	blocked: 'Terminal needs attention',
	done: 'Command finished',
	waiting: 'Terminal needs attention',
};

export function notificationHeadline(
	state: ListedState,
	isAgentStatus: boolean,
): string {
	return (isAgentStatus ? AGENT_HEADLINES : TERMINAL_HEADLINES)[state];
}

function plural(count: number, unit: string): string {
	return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

export function formatNotificationAge(
	since: number | undefined,
	now: number,
): string | null {
	if (since === undefined || !Number.isFinite(since)) return null;
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	if (seconds < 5) return 'Just now';
	if (seconds < 60) return plural(seconds, 'second');
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return plural(minutes, 'minute');
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return plural(hours, 'hour');
	return plural(Math.floor(hours / 24), 'day');
}
