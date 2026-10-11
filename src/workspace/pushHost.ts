/**
 * The workspace's part in Web Push to the installed PWA (ADR-0060).
 *
 * The manager that frames this session holds the device's push subscription
 * and, for this server, an enrolment. The workspace carries that enrolment to
 * its server on the authenticated channel, tells the server whether this
 * window is being looked at, and hands the manager a notification count. It
 * holds none of it and decides nothing: a session that is not framed by such a
 * manager, or a server that does not push, leaves all of this inert.
 */

import type { PushEnrolment } from '@terminay/protocol';

export const PUSH_OPERATIONS = Object.freeze({
	enrol: 'push.enrol',
	withdraw: 'push.withdraw',
	visibility: 'push.visibility',
} as const);

/** The terminal a banner the user opened names. */
export type NotificationTarget = Readonly<{
	projectId: string;
	sessionId: string;
}>;

/** What the framing manager offers a session; see the session transport host. */
export type SessionNotificationsHost = Readonly<{
	getPushEnrolment(): Promise<PushEnrolment | undefined>;
	subscribePushEnrolment(listener: () => void): () => void;
	setNotificationCount(count: number): void;
	subscribeNotificationTarget(
		listener: (target: NotificationTarget) => void,
	): () => void;
}>;

export type PushHostBindingOptions = Readonly<{
	host: SessionNotificationsHost;
	command: (operation: string, payload: unknown) => Promise<unknown>;
	/** Whether this window can be seen right now. */
	isVisible: () => boolean;
	/** Subscribe to visibility changes; returns an unsubscribe. */
	onVisibilityChange: (listener: () => void) => () => void;
}>;

/**
 * Keep one connection's enrolment and visibility in step with the manager and
 * the page. Returns the function that ends the binding.
 */
export function bindPushHost(options: PushHostBindingOptions): () => void {
	const { host, command } = options;
	let disposed = false;
	let syncing = false;
	let resync = false;

	const send = (operation: string, payload: unknown): Promise<void> =>
		command(operation, payload).then(
			() => undefined,
			// Push is best effort: the next change of enrolment or visibility
			// tries again, and nothing else in the workspace depends on it.
			() => undefined,
		);

	const reportVisibility = (): void => {
		if (disposed) return;
		void send(PUSH_OPERATIONS.visibility, { visible: options.isVisible() });
	};

	// One sync at a time, so an enrolment that is switched off while its
	// predecessor is still in flight cannot arrive first and be overwritten.
	const sync = async (): Promise<void> => {
		if (syncing) {
			resync = true;
			return;
		}
		syncing = true;
		try {
			do {
				resync = false;
				let enrolment: PushEnrolment | undefined;
				try {
					enrolment = await host.getPushEnrolment();
				} catch {
					enrolment = undefined;
				}
				if (disposed) return;
				if (enrolment === undefined) {
					await send(PUSH_OPERATIONS.withdraw, {});
				} else {
					await send(PUSH_OPERATIONS.enrol, {
						routingId: enrolment.routingId,
						key: enrolment.key,
						token: enrolment.token,
						silent: enrolment.silent,
					});
					// Enrolling says the window is in front; say so only if it is.
					if (!disposed && !options.isVisible()) reportVisibility();
				}
			} while (resync && !disposed);
		} finally {
			syncing = false;
		}
	};

	const stopEnrolment = host.subscribePushEnrolment(() => void sync());
	const stopVisibility = options.onVisibilityChange(reportVisibility);
	void sync();
	return () => {
		disposed = true;
		stopEnrolment();
		stopVisibility();
	};
}

const HOST_MEMBERS = [
	'getPushEnrolment',
	'subscribePushEnrolment',
	'setNotificationCount',
	'subscribeNotificationTarget',
] as const;

/**
 * The framing manager's notifications surface, where this session has one.
 * It is read from the session transport host the hosted bootstrap installed
 * before the workspace loaded; Desktop and a first-party tab have none.
 */
export function readSessionNotificationsHost(
	scope: { __TERMINAY_SESSION_TRANSPORT__?: unknown } = globalThis as {
		__TERMINAY_SESSION_TRANSPORT__?: unknown;
	},
): SessionNotificationsHost | undefined {
	const transport = scope.__TERMINAY_SESSION_TRANSPORT__;
	if (typeof transport !== 'object' || transport === null) return undefined;
	const host = (transport as { notifications?: unknown }).notifications;
	if (typeof host !== 'object' || host === null) return undefined;
	return HOST_MEMBERS.every(
		(name) => typeof (host as Record<string, unknown>)[name] === 'function',
	)
		? (host as SessionNotificationsHost)
		: undefined;
}

/**
 * The panel a banner's target names, among the panels this window holds. A
 * terminal that has since closed, or that this window does not show, names
 * none, and the selection is then left as it is.
 */
export function findNotificationTargetPanel(
	inventoryByProject: Readonly<
		Record<
			string,
			readonly Readonly<{
				kind: string;
				panelId: string;
				projectId: string;
				sessionId?: string;
			}>[]
		>
	>,
	target: NotificationTarget,
): Readonly<{ projectId: string; panelId: string }> | undefined {
	const entry = (inventoryByProject[target.projectId] ?? []).find(
		(candidate) =>
			candidate.kind === 'terminal' &&
			candidate.sessionId === target.sessionId,
	);
	return entry === undefined
		? undefined
		: { projectId: entry.projectId, panelId: entry.panelId };
}

/** The count the manager is given: a whole number in its accepted range. */
export function boundedNotificationCount(count: number): number {
	if (!Number.isFinite(count) || count <= 0) return 0;
	return Math.min(Math.floor(count), 9999);
}
