import { Bell, X } from 'lucide-react';
import type { CSSProperties, RefObject } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import { activityCountDigits, formatActivityCount } from './activityCountBadge';
import {
	type TerminalActivityOverviewItem,
	type TerminalActivityOverviewState,
	terminalOverviewStateToAgentState,
} from './activityStates';

export type {
	TerminalActivityOverviewItem,
	TerminalActivityOverviewState,
	TerminalPresentationActivityState,
} from './activityStates';
export { terminalOverviewStateToAgentState } from './activityStates';

/**
 * Splits the notable terminals into what the user can act on and clear —
 * attention and finished — and what is merely in progress. Only the first is
 * a notification; a working terminal cannot be dismissed, so it is not counted.
 */
export function buildTerminalActivityOverview(
	items: TerminalActivityOverviewItem[],
) {
	const priority = (state: TerminalActivityOverviewState) => {
		const canonical = terminalOverviewStateToAgentState(state);
		if (canonical === 'blocked' || canonical === 'waiting') return 0;
		if (canonical === 'working') return 1;
		return 2;
	};
	const sortedItems = [...items].sort(
		(a, b) =>
			priority(a.state) - priority(b.state) ||
			a.projectTitle.localeCompare(b.projectTitle) ||
			a.title.localeCompare(b.title),
	);
	const isWorking = (item: TerminalActivityOverviewItem) =>
		terminalOverviewStateToAgentState(item.state) === 'working';
	const notifications = sortedItems.filter((item) => !isWorking(item));
	return {
		items: sortedItems,
		notifications,
		working: sortedItems.filter(isWorking),
		notificationCount: notifications.length,
	};
}

export function notificationsButtonLabel(count: number): string {
	if (count <= 0) return 'Notifications';
	return `Notifications, ${count} ${count === 1 ? 'notification' : 'notifications'}`;
}

function ActivityRows({
	items,
	onActivate,
	onDismiss,
}: {
	items: TerminalActivityOverviewItem[];
	onActivate: (item: TerminalActivityOverviewItem) => void;
	onDismiss?: (item: TerminalActivityOverviewItem) => void;
}) {
	return (
		<>
			{items.map((item) => {
				const state = terminalOverviewStateToAgentState(item.state);
				return (
					<div
						key={`${item.projectId}:${item.panelId}:${item.sessionId}`}
						className="terminal-activity-menu__row"
					>
						<button
							type="button"
							className="terminal-activity-menu__item"
							onClick={() => onActivate(item)}
						>
							<AgentStatusIndicator
								state={state}
								label={item.isAgentStatus ? undefined : `Terminal ${state}`}
							/>
							<span
								className="terminal-activity-menu__preview"
								style={{ '--tab-color': item.color } as CSSProperties}
							>
								<span className="terminal-activity-menu__dot" />
								<span
									className="terminal-activity-menu__emoji"
									aria-hidden="true"
								>
									{item.emoji || item.projectEmoji || '>'}
								</span>
							</span>
							<span className="terminal-activity-menu__text">
								<span className="terminal-activity-menu__title">
									{item.title}
								</span>
								<span className="terminal-activity-menu__project">
									{item.projectEmoji ? `${item.projectEmoji} ` : ''}
									{item.projectTitle}
								</span>
							</span>
						</button>
						{onDismiss ? (
							<button
								type="button"
								className="terminal-activity-menu__dismiss"
								onClick={() => onDismiss(item)}
								aria-label={`Dismiss ${item.title}`}
								title="Dismiss"
							>
								<X size={12} aria-hidden="true" />
							</button>
						) : null}
					</div>
				);
			})}
		</>
	);
}

export function TerminalActivityOverview({
	activityMenuRef,
	isOpen,
	notifications,
	onActivate,
	onDismiss,
	onDismissAll,
	onToggle,
	working,
}: {
	activityMenuRef: RefObject<HTMLDivElement | null>;
	isOpen: boolean;
	notifications: TerminalActivityOverviewItem[];
	onActivate: (item: TerminalActivityOverviewItem) => void;
	onDismiss: (item: TerminalActivityOverviewItem) => void;
	onDismissAll: () => void;
	onToggle: () => void;
	working: TerminalActivityOverviewItem[];
}) {
	const count = notifications.length;
	const countLabel = formatActivityCount(count);
	return (
		<div
			ref={activityMenuRef}
			className={`terminal-activity-status${isOpen ? ' terminal-activity-status--open' : ''}`}
		>
			<button
				type="button"
				className="terminal-activity-button"
				onClick={onToggle}
				title="Notifications"
				aria-label={notificationsButtonLabel(count)}
				aria-haspopup="menu"
				aria-expanded={isOpen}
			>
				<Bell size={15} aria-hidden="true" />
				{count > 0 ? (
					<span
						className="notifications-count"
						data-digits={activityCountDigits(countLabel)}
						aria-hidden="true"
					>
						{countLabel}
					</span>
				) : null}
			</button>
			{isOpen ? (
				<div
					className="terminal-activity-menu"
					role="menu"
					aria-label="Notifications"
				>
					<div className="terminal-activity-menu__header">
						<span className="terminal-activity-menu__section-label">
							Notifications
						</span>
						{count > 0 ? (
							<button
								type="button"
								className="terminal-activity-menu__clear-all"
								onClick={onDismissAll}
							>
								Clear all
							</button>
						) : null}
					</div>
					{count === 0 ? (
						<div className="terminal-activity-menu__empty">
							No notifications
						</div>
					) : (
						<ActivityRows
							items={notifications}
							onActivate={onActivate}
							onDismiss={onDismiss}
						/>
					)}
					{working.length > 0 ? (
						<div className="terminal-activity-menu__working">
							<div className="terminal-activity-menu__header">
								<span className="terminal-activity-menu__section-label">
									Working
								</span>
							</div>
							<ActivityRows items={working} onActivate={onActivate} />
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
