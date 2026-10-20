import {
	type McpApprovalDetail,
	type NotificationManager,
	type NotificationManagerError,
	type NotificationRecord,
	plainText,
} from '@terminay/server-core';
import type {
	ControlOperation,
	ControlRequestContext,
} from './controlEndpoint.js';
import {
	type NotificationControlAdapter,
	notificationFailure as failure,
} from './notificationTools.js';

/**
 * Binds the notification tools to the server's notification manager. Kept
 * apart from notificationTools.ts because it loads server-core.
 */

export interface NotificationControlAdapterOptions {
	/** Structural, so a host may compose the manager from source or from dist. */
	readonly notifications: Pick<
		NotificationManager,
		'send' | 'dismissSent' | 'snapshot'
	>;
	/**
	 * Dismiss a published notification exactly as a user's dismissal from the
	 * Notifications list does: an activity notification acknowledges its
	 * terminal. Absent, only notifications the calling terminal sent can be
	 * dismissed.
	 */
	readonly dismiss?: (record: NotificationRecord) => boolean | Promise<boolean>;
	/** Whether the caller can address this terminal of this project. */
	readonly reaches?: (
		context: ControlRequestContext,
		owner: { readonly projectId: string; readonly sessionId: string },
	) => boolean;
}

/** Notifications one listing returns, newest first. */
export const MAX_LISTED_NOTIFICATIONS = 100;

/** Bind the notification tools to the server-owned notification manager. */
export function createNotificationControlAdapter(
	options: NotificationControlAdapterOptions,
): NotificationControlAdapter {
	const { notifications } = options;
	return {
		sendNotification: (params, context) => {
			try {
				const record = notifications.send(
					{
						projectId: context.projectId,
						sessionId: context.terminalSessionId,
					},
					{
						body: params.body,
						...(params.title === undefined ? {} : { title: params.title }),
					},
					params.notification,
				);
				return {
					notification: record.id,
					sent: 'The notification is held for the terminal you are running in. The user is shown it only if it is still present after about five seconds, and not at all if they click or type in this terminal before then.',
				};
			} catch (error) {
				return notificationFailureFor(error);
			}
		},
		dismissNotification: async (params, context) => {
			// One this terminal sent goes whether or not it has been shown yet.
			if (
				context.chat === undefined &&
				notifications.dismissSent(context.terminalSessionId, params.notification)
			)
				return { notification: params.notification, dismissed: true };
			const record = reachable(context)[params.notification];
			if (record === undefined || options.dismiss === undefined)
				return failure(
					'not_found',
					'No notification you can reach has that handle. list_notifications lists them.',
				);
			await options.dismiss(record);
			return { notification: params.notification, dismissed: true };
		},
		listNotifications: (_params, context) => {
			const records = Object.values(reachable(context)).sort(
				(left, right) => right.raisedAt - left.raisedAt,
			);
			const listed = records.slice(0, MAX_LISTED_NOTIFICATIONS);
			return {
				notifications: listed.map((record) => ({
					notification: record.id,
					kind: record.kind,
					...(record.title === undefined ? {} : { title: record.title }),
					...(record.body === undefined ? {} : { body: record.body }),
					terminal: record.sessionId,
					raised_at: new Date(record.raisedAt).toISOString(),
				})),
				...(listed.length < records.length ? { truncated: true } : {}),
			};
		},
	};

	/** The published notifications of terminals the caller can address. */
	function reachable(
		context: ControlRequestContext,
	): Readonly<Record<string, NotificationRecord>> {
		const all = notifications.snapshot().notifications;
		const result: Record<string, NotificationRecord> = {};
		for (const [id, record] of Object.entries(all))
			if (
				options.reaches?.(context, record) ??
				(record.projectId === context.projectId &&
					record.sessionId === context.terminalSessionId)
			)
				result[id] = record;
		return result;
	}
}

/**
 * Plain words for a notification request's approval prompt, stating the title
 * and body exactly as they would be shown.
 */
export function describeNotificationRequest(
	op: Extract<
		ControlOperation,
		'send_notification' | 'dismiss_notification' | 'list_notifications'
	>,
	params: Readonly<Record<string, unknown>>,
): { readonly summary: string; readonly details: readonly McpApprovalDetail[] } {
	if (op === 'dismiss_notification')
		return { summary: 'dismiss a notification', details: [] };
	if (op === 'list_notifications')
		return { summary: 'list your notifications', details: [] };
	const title = typeof params.title === 'string' ? plainText(params.title) : '';
	const body = typeof params.body === 'string' ? plainText(params.body) : '';
	const text = title === '' ? `"${body}"` : `titled "${title}": "${body}"`;
	return {
		summary:
			params.notification === undefined
				? `send a notification ${text}`
				: `update its notification to one ${text}`,
		details: [
			...(title === '' ? [] : [{ label: 'Title', value: title }]),
			{ label: 'Body', value: body },
		],
	};
}

function notificationFailureFor(error: unknown): ReturnType<typeof failure> {
	// Matched by shape, not by class: a host may compose the manager from a
	// different copy of server-core than this adapter was built against, and
	// `instanceof` would then miss every one of its errors.
	if (!isNotificationManagerError(error)) throw error;
	switch (error.code) {
		case 'not_found':
			return failure('not_found', error.message);
		case 'limit':
		case 'rate_limited':
			return failure('limit_exceeded', error.message);
		default:
			return failure('bad_request', error.message);
	}
}

function isNotificationManagerError(
	error: unknown,
): error is NotificationManagerError {
	return (
		error instanceof Error &&
		error.name === 'NotificationManagerError' &&
		typeof (error as { code?: unknown }).code === 'string'
	);
}
