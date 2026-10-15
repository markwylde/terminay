/**
 * The header Notifications list, as the server publishes it.
 *
 * The server's notification manager decides what a notification is and when
 * clients hear of it. This module only dresses each published record with the
 * terminal it belongs to, so the list can name it, and orders the rows. A
 * record whose terminal this window does not show is not listed.
 */

import type {
	NotificationKind,
	NotificationRecord,
	NotificationSnapshot,
} from '@terminay/client-core';
import type {
	TerminalActivityOverviewItem,
	TerminalActivityOverviewState,
} from './activityStates';
import type { WorkspaceInventoryEntry } from './workspaceInventory';

const KIND_STATES: Record<NotificationKind, TerminalActivityOverviewState> = {
	'agent-blocked': 'blocked',
	'agent-finished': 'done',
	'agent-waiting': 'waiting',
	attention: 'attention',
	'command-finished': 'unviewed',
	// A process asking for the user reads as attention, like a bell does.
	message: 'attention',
};

/** Attention rows come before finished ones. */
function isAttention(kind: NotificationKind): boolean {
	return kind !== 'agent-finished' && kind !== 'command-finished';
}

/**
 * A terminal's own appearance settings can hide its activity indicator. They
 * hide its activity notification with it; what a process sent is not an
 * activity indicator and is always listed.
 */
function isHiddenBySettings(
	record: NotificationRecord,
	entry: WorkspaceInventoryEntry,
): boolean {
	return (
		record.source === 'activity' &&
		entry.status !== 'idle' &&
		entry.indicatorsSuppressed === true
	);
}

export function publishedNotificationItems(
	snapshot: NotificationSnapshot,
	entries: readonly WorkspaceInventoryEntry[],
): TerminalActivityOverviewItem[] {
	const bySession = new Map<string, WorkspaceInventoryEntry>();
	for (const entry of entries) {
		if (entry.kind === 'terminal' && entry.sessionId !== undefined)
			bySession.set(`${entry.projectId}\n${entry.sessionId}`, entry);
	}
	const rows: Array<{
		item: TerminalActivityOverviewItem;
		record: NotificationRecord;
	}> = [];
	for (const record of Object.values(snapshot.notifications)) {
		const entry = bySession.get(`${record.projectId}\n${record.sessionId}`);
		if (entry === undefined || isHiddenBySettings(record, entry)) continue;
		rows.push({
			record,
			item: {
				color: entry.color,
				emoji: entry.emoji,
				isAgentStatus: record.kind.startsWith('agent-'),
				notificationId: record.id,
				panelId: entry.panelId,
				projectEmoji: entry.projectEmoji,
				projectId: entry.projectId,
				projectTitle: entry.projectTitle,
				sessionId: record.sessionId,
				since: record.raisedAt,
				state: KIND_STATES[record.kind],
				title: entry.title,
				...(record.source === 'message'
					? {
							sent: {
								...(record.title === undefined ? {} : { title: record.title }),
								body: record.body ?? '',
							},
						}
					: {}),
			},
		});
	}
	rows.sort(
		(a, b) =>
			Number(isAttention(b.record.kind)) - Number(isAttention(a.record.kind)) ||
			// Newest first, so the list reads like a feed.
			b.record.raisedAt - a.record.raisedAt ||
			a.item.projectTitle.localeCompare(b.item.projectTitle) ||
			a.item.title.localeCompare(b.item.title) ||
			a.record.id.localeCompare(b.record.id),
	);
	return rows.map((row) => row.item);
}
