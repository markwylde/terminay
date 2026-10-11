import {
	type McpApprovalDetail,
	type NotificationManager,
	type NotificationManagerError,
	plainText,
} from '@terminay/server-core';
import type { ControlOperation } from './controlEndpoint.js';
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
	readonly notifications: Pick<NotificationManager, 'send' | 'dismissSent'>;
}

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
					sent: 'The notification is held for the terminal you are running in. The user is shown it only if it is still present after about five seconds, and not at all while they are already in this terminal.',
				};
			} catch (error) {
				return notificationFailureFor(error);
			}
		},
		dismissNotification: (params, context) =>
			notifications.dismissSent(context.terminalSessionId, params.notification)
				? { notification: params.notification, dismissed: true }
				: failure(
						'not_found',
						'This terminal sent no notification with that handle.',
					),
	};
}

/**
 * Plain words for a notification request's approval prompt, stating the title
 * and body exactly as they would be shown.
 */
export function describeNotificationRequest(
	op: Extract<ControlOperation, 'send_notification' | 'dismiss_notification'>,
	params: Readonly<Record<string, unknown>>,
): { readonly summary: string; readonly details: readonly McpApprovalDetail[] } {
	if (op === 'dismiss_notification')
		return { summary: 'dismiss one of its notifications', details: [] };
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
