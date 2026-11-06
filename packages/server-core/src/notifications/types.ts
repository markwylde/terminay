/**
 * Transport-neutral notification protocol.
 *
 * A notification is a record the server holds for one owner: a terminal or a
 * bot (ADR-0100). Terminal activity and processes in a terminal add and remove
 * a terminal's records; the bot service alone adds and removes a bot's. The
 * manager alone decides when a record is published to clients.
 */

export type NotificationSource = 'activity' | 'message' | 'bot';

export const ACTIVITY_NOTIFICATION_KINDS = [
	'agent-finished',
	'agent-waiting',
	'agent-blocked',
	'command-finished',
	'attention',
] as const;
export type ActivityNotificationKind =
	(typeof ACTIVITY_NOTIFICATION_KINDS)[number];

export type NotificationKind =
	| ActivityNotificationKind
	| 'message'
	| 'bot-message';

export type NotificationOwnerKind = 'terminal' | 'bot';

export const MAX_NOTIFICATION_TITLE_CHARS = 80;
export const MAX_NOTIFICATION_BODY_CHARS = 280;
/** Notifications a process sent that one terminal may hold at once. */
export const MAX_SENT_NOTIFICATIONS_PER_TERMINAL = 8;
/** How long a notification must stay present before clients are told of it. */
export const NOTIFICATION_SETTLE_MS = 5_000;

export interface NotificationOwner {
	readonly projectId: string;
	readonly sessionId: string;
}

export interface TerminalNotificationRecord {
	/** Opaque and unique on this server. */
	readonly id: string;
	readonly owner: 'terminal';
	readonly projectId: string;
	readonly sessionId: string;
	readonly source: 'activity' | 'message';
	readonly kind: ActivityNotificationKind | 'message';
	/** Present only on a notification a process sent. */
	readonly title?: string;
	readonly body?: string;
	/** When the notification, or its current kind, arose. */
	readonly raisedAt: number;
}

/** One bot's unacknowledged posts. Visible only behind bot authority. */
export interface BotNotificationRecord {
	readonly id: string;
	readonly owner: 'bot';
	readonly botId: string;
	readonly source: 'bot';
	readonly kind: 'bot-message';
	/** Bounded plain-text excerpt of the latest unacknowledged post. */
	readonly body: string;
	/** Unacknowledged bot posts this record covers. */
	readonly count: number;
	/** Message sequence of the latest covered post. */
	readonly throughSequence: number;
	/** When the latest covered post was made. */
	readonly raisedAt: number;
}

export type NotificationRecord =
	| TerminalNotificationRecord
	| BotNotificationRecord;

/** What the bot service says about one bot's unacknowledged posts. */
export interface BotNotificationState {
	readonly count: number;
	readonly body: string;
	readonly raisedAt: number;
	readonly throughSequence: number;
}

/** Which records a reader may see. */
export interface NotificationVisibility {
	/** Narrow to one project; bot records are then never visible. */
	readonly projectId?: string;
	/** Whether the reader holds bot authority. */
	readonly bots: boolean;
}

export interface NotificationSnapshot {
	readonly revision: number;
	readonly cursor: string;
	readonly notifications: Readonly<Record<string, NotificationRecord>>;
}

export type NotificationEventType =
	| 'notification.published'
	| 'notification.changed'
	| 'notification.removed';

interface NotificationEventBase {
	readonly revision: number;
	readonly cursor: string;
	readonly type: NotificationEventType;
	readonly id: string;
}

/** Owner identity is carried on every event, removals included, so a reader
 * is scoped without the record body. */
export interface TerminalNotificationEvent extends NotificationEventBase {
	readonly owner: 'terminal';
	readonly projectId: string;
	readonly sessionId: string;
	readonly notification?: TerminalNotificationRecord;
}

export interface BotNotificationEvent extends NotificationEventBase {
	readonly owner: 'bot';
	readonly botId: string;
	readonly notification?: BotNotificationRecord;
}

export type NotificationEvent = TerminalNotificationEvent | BotNotificationEvent;

export interface NotificationReplay {
	readonly kind: 'events' | 'resync';
	readonly events: readonly NotificationEvent[];
	readonly snapshot?: NotificationSnapshot;
}

export type NotificationListener = (
	event: NotificationEvent,
	snapshot: NotificationSnapshot,
) => void;

export interface SentNotificationText {
	readonly title?: string;
	readonly body: string;
}
