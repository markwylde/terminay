/**
 * The header Notifications list, as the server publishes it.
 *
 * The server's notification manager decides what a notification is and when
 * clients hear of it. This module only dresses each published record with the
 * terminal or bot it belongs to, so the list can name it, and orders the rows.
 * A record whose terminal or bot this window does not know is not listed.
 */

import type {
	BotNotificationRecord,
	NotificationKind,
	NotificationRecord,
	NotificationSnapshot,
	TerminalNotificationRecord,
} from '@terminay/client-core';
import type {
	TerminalActivityOverviewItem,
	TerminalActivityOverviewState,
} from './activityStates';

/** What a bot row needs to name its bot. */
export type NotificationBotProfile = Readonly<{
	name: string;
	avatar: string;
	colour: string;
}>;

/** The bots of the server that published the snapshot. */
export type NotificationBots = Readonly<{
	serverId: string;
	bots: ReadonlyMap<string, NotificationBotProfile>;
}>;
import type { WorkspaceInventoryEntry } from './workspaceInventory';

const KIND_STATES: Record<NotificationKind, TerminalActivityOverviewState> = {
	'agent-blocked': 'blocked',
	'agent-finished': 'done',
	'agent-waiting': 'waiting',
	attention: 'attention',
	'command-finished': 'unviewed',
	// A process asking for the user reads as attention, like a bell does.
	message: 'attention',
	// So does a bot that has something to say.
	'bot-message': 'attention',
};

/** Attention rows come before finished ones. */
function isAttention(kind: NotificationKind): boolean {
	return kind !== 'agent-finished' && kind !== 'command-finished';
}

/**
 * A terminal's own appearance settings can hide its activity indicator. They
 * hide its activity notification with it; what a process sent is not an
 * activity indicator and is always listed. An untracked terminal raises no
 * activity record on the server; this only covers the moment before the
 * server's withdrawal arrives.
 */
function isHiddenBySettings(
	record: TerminalNotificationRecord,
	entry: WorkspaceInventoryEntry,
): boolean {
	if (record.source !== 'activity') return false;
	if (entry.untracked) return true;
	return (
		entry.status !== 'idle' &&
		entry.indicatorsSuppressed === true
	);
}

function botItem(
	record: BotNotificationRecord,
	bots: NotificationBots | undefined,
): TerminalActivityOverviewItem | undefined {
	const bot = bots?.bots.get(record.botId);
	if (bots === undefined || bot === undefined) return undefined;
	return {
		bot: {
			serverId: bots.serverId,
			botId: record.botId,
			name: bot.name,
			avatar: bot.avatar,
			colour: bot.colour,
			count: record.count,
			throughSequence: record.throughSequence,
			excerpt: record.body,
		},
		color: bot.colour,
		emoji: '',
		isAgentStatus: false,
		notificationId: record.id,
		panelId: '',
		projectEmoji: '',
		projectId: '',
		projectTitle: '',
		sessionId: '',
		since: record.raisedAt,
		state: KIND_STATES[record.kind],
		title: bot.name,
	};
}

/** A bot row's headline: how many posts are waiting. */
export function botNotificationHeadline(count: number): string {
	return count <= 1 ? 'New message' : `${count} new messages`;
}

export function publishedNotificationItems(
	snapshot: NotificationSnapshot,
	entries: readonly WorkspaceInventoryEntry[],
	bots?: NotificationBots,
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
		if (record.owner === 'bot') {
			// The **Show indicator** settings are about terminal tabs; a bot's
			// notification is not one, and is always listed.
			const item = botItem(record, bots);
			if (item !== undefined) rows.push({ record, item });
			continue;
		}
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
