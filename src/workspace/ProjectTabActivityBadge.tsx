import {
	type ActivityCountBadge,
	activityBadgeAriaLabel,
	activityCountDigits,
	formatActivityCount,
} from './activityCountBadge';

export function ProjectTabActivityBadge({
	badge,
}: {
	badge: ActivityCountBadge | undefined;
}) {
	if (!badge || badge.count <= 0) return null;
	const label = formatActivityCount(badge.count);
	return (
		<span
			className={`project-tab-activity-badge project-tab-activity-badge--${badge.state}`}
			data-digits={activityCountDigits(label)}
			role="img"
			aria-label={activityBadgeAriaLabel(badge)}
		>
			{label}
		</span>
	);
}
