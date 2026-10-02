import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import type { AgentState } from '../types/agentStatus';
import {
	type ActivityBadgeState,
	type ActivityCountBadge,
	activityBadgeAriaLabel,
} from './activityCountBadge';

const DOT_STATE: Record<ActivityBadgeState, AgentState> = {
	attention: 'blocked',
	recent: 'working',
	unviewed: 'done',
};

/**
 * A project's activity, shown as the same dot a terminal tab shows for itself.
 * It keeps its own class so it can be located apart from the terminal dots.
 */
export function ProjectTabActivityDot({
	badge,
}: {
	badge: ActivityCountBadge | undefined;
}) {
	if (!badge || badge.count <= 0) return null;
	return (
		<AgentStatusIndicator
			className={`project-tab-activity-dot project-tab-activity-dot--${badge.state}`}
			state={DOT_STATE[badge.state]}
			label={activityBadgeAriaLabel(badge)}
		/>
	);
}
