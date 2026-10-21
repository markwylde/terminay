import type {
	MAX_NOTIFICATION_BODY_CHARS as ServerMaxBodyChars,
	MAX_NOTIFICATION_TITLE_CHARS as ServerMaxTitleChars,
} from '@terminay/server-core';
import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The MCP notification tools (ADR-0061, ADR-0072). A sent notification belongs
 * to the calling terminal, which the capability fixes; no parameter names a
 * terminal or a project. Listing and dismissing are addressed by reach: a
 * handle resolves only for a notification of a terminal the caller reaches.
 */

// Type-only imports keep the stdio entry, which reaches this module through
// the dispatcher, free of server-core at runtime; `satisfies` pins the literal
// to its source. The binding to the manager lives in notificationAdapter.ts.
export const MAX_NOTIFICATION_TOOL_TITLE_CHARS =
	80 as const satisfies typeof ServerMaxTitleChars;
export const MAX_NOTIFICATION_TOOL_BODY_CHARS =
	280 as const satisfies typeof ServerMaxBodyChars;

export interface SendNotificationParams {
	readonly body: string;
	readonly title?: string;
	/** Handle of a notification this terminal sent, to replace in place. */
	readonly notification?: string;
}
export interface DismissNotificationParams {
	readonly notification: string;
}
export type ListNotificationsParams = Record<string, never>;

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;

type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the notification tools; each method is already past the
 * MCP permission gate when it is called. */
export interface NotificationControlAdapter {
	readonly sendNotification: Handler<SendNotificationParams>;
	readonly dismissNotification: Handler<DismissNotificationParams>;
	readonly listNotifications: Handler<ListNotificationsParams>;
}

export function isNotificationParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function parseSendNotification(
	params: Record<string, unknown>,
): Parsed<SendNotificationParams> {
	if (typeof params.body !== 'string' || params.body.trim().length === 0)
		return badRequest('body must be a non-empty string');
	if ([...params.body.trim()].length > MAX_NOTIFICATION_TOOL_BODY_CHARS)
		return badRequest(
			`body must be at most ${MAX_NOTIFICATION_TOOL_BODY_CHARS} characters`,
		);
	if (params.title !== undefined && typeof params.title !== 'string')
		return badRequest('title must be a string');
	if (
		params.title !== undefined &&
		[...params.title.trim()].length > MAX_NOTIFICATION_TOOL_TITLE_CHARS
	)
		return badRequest(
			`title must be at most ${MAX_NOTIFICATION_TOOL_TITLE_CHARS} characters`,
		);
	if (params.notification !== undefined && !isHandle(params.notification))
		return badRequest('notification must be a notification handle');
	return {
		body: params.body,
		...(params.title === undefined ? {} : { title: params.title }),
		...(params.notification === undefined
			? {}
			: { notification: params.notification as string }),
	};
}

export function parseDismissNotification(
	params: Record<string, unknown>,
): Parsed<DismissNotificationParams> {
	if (!isHandle(params.notification))
		return badRequest('notification must be a notification handle');
	return { notification: params.notification };
}

export function parseListNotifications(): Parsed<ListNotificationsParams> {
	return {};
}

export function notificationFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

function isHandle(value: unknown): value is string {
	return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function badRequest(message: string): Failure {
	return notificationFailure('bad_request', message);
}
