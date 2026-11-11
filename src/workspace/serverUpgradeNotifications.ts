/**
 * How an upgrade this window followed ended, as rows of the header
 * Notifications list.
 *
 * The header's warning leaves when an upgrade succeeds, so the outcome is
 * listed and counted with every other notification rather than drawn over the
 * workspace. It lives in this window only: the server never published it, so
 * dismissing it tells no server anything.
 */

import type { TerminalActivityOverviewItem } from './activityStates';
import type { ServerUpgradeNotice } from './serverUpgradeModel';

export const SERVER_UPGRADE_NOTIFICATION_SOURCE = 'Server upgrade';

export function serverUpgradeNotificationItem(
	notice: ServerUpgradeNotice,
): TerminalActivityOverviewItem {
	return {
		color: '',
		emoji: '',
		isAgentStatus: false,
		notificationId: notice.id,
		panelId: '',
		projectEmoji: '',
		projectId: '',
		projectTitle: '',
		sessionId: '',
		sent: { body: notice.text },
		serverUpgrade: notice,
		since: notice.raisedAt,
		// A failure is something to act on; a success is finished news.
		state: notice.tone === 'failure' ? 'attention' : 'unviewed',
		title: SERVER_UPGRADE_NOTIFICATION_SOURCE,
	};
}

/** The list with this window's upgrade outcomes first, newest first. */
export function withServerUpgradeNotifications<
	T extends Readonly<{
		items: TerminalActivityOverviewItem[];
		notifications: TerminalActivityOverviewItem[];
		notificationCount: number;
	}>,
>(overview: T, notices: readonly ServerUpgradeNotice[]): T {
	if (notices.length === 0) return overview;
	const upgrades = [...notices]
		.sort((a, b) => b.raisedAt - a.raisedAt)
		.map(serverUpgradeNotificationItem);
	const notifications = [...upgrades, ...overview.notifications];
	return {
		...overview,
		items: [...upgrades, ...overview.items],
		notifications,
		notificationCount: notifications.length,
	};
}
