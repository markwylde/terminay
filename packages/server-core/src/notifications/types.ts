/**
 * Transport-neutral notification protocol.
 *
 * A notification is a record the server holds for one terminal. Terminal
 * activity and processes in that terminal add and remove records; the manager
 * alone decides when a record is published to clients.
 */

export type NotificationSource = 'activity' | 'message';

export const ACTIVITY_NOTIFICATION_KINDS = [
	'agent-finished',
	'agent-waiting',
	'agent-blocked',
	'command-finished',
	'attention',
] as const;
export type ActivityNotificationKind =
	(typeof ACTIVITY_NOTIFICATION_KINDS)[number];

export type NotificationKind = ActivityNotificationKind | 'message';

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

export interface NotificationRecord {
	/** Opaque and unique on this server. */
	readonly id: string;
	readonly projectId: string;
	readonly sessionId: string;
	readonly source: NotificationSource;
	readonly kind: NotificationKind;
	/** Present only on a notification a process sent. */
	readonly title?: string;
	readonly body?: string;
	/** When the notification, or its current kind, arose. */
	readonly raisedAt: number;
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

export interface NotificationEvent {
	readonly revision: number;
	readonly cursor: string;
	readonly type: NotificationEventType;
	readonly id: string;
	/** Carried on every event so a removal can still be scoped by project. */
	readonly projectId: string;
	readonly sessionId: string;
	readonly notification?: NotificationRecord;
}

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
