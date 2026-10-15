import type {
	ActivitySessionIdentity,
	TerminalActivityService,
} from '../activity/service.js';
import type { TerminalActivitySessionSnapshot } from '../activity/types.js';
import type { NotificationManager } from './manager.js';
import type { ActivityNotificationKind } from './types.js';

/**
 * The notification a terminal's reduced activity calls for, if any: it is
 * unacknowledged and either needs attention or has finished. A working
 * terminal calls for none. Provider state is authoritative for an agent's
 * terminal, exactly as it is for that terminal's indicator.
 */
export function activityNotificationKind(
	session: TerminalActivitySessionSnapshot,
): ActivityNotificationKind | undefined {
	if (session.acknowledged) return undefined;
	if (session.provider !== undefined) {
		if (session.providerState === 'waiting') return 'agent-waiting';
		if (session.providerState === 'blocked') return 'agent-blocked';
		if (session.providerState === 'done') return 'agent-finished';
		return undefined;
	}
	if (session.attention) return 'attention';
	return session.status === 'idle' ? 'command-finished' : undefined;
}

/**
 * Which terminals a person has chosen not to track (ADR-0065). Their activity
 * raises no notification. The workspace owns the choice; this is how the
 * binding reads it and hears it change.
 */
export interface NotificationTracking {
	/** The sessions whose panels have Track activity off, as of now. */
	untrackedSessionIds(): ReadonlySet<string>;
	/** Called after any change that may have changed `untrackedSessionIds`. */
	subscribe(listener: () => void): () => void;
	/**
	 * Acknowledge a terminal's current activity without counting it as
	 * interaction, so turning tracking back on reports only what comes next.
	 */
	acknowledge(identity: ActivitySessionIdentity): void;
}

/**
 * Feed the manager from terminal activity. This is the whole of what activity
 * knows about notifications: it sets or clears each terminal's one record as
 * the reducer's state changes, and reports interaction. Timing, publication,
 * and delivery belong to the manager.
 */
export function bindNotificationsToActivity(
	manager: NotificationManager,
	activity: TerminalActivityService,
	tracking?: NotificationTracking,
): () => void {
	let untracked: ReadonlySet<string> =
		tracking?.untrackedSessionIds() ?? new Set();
	const reconcile = (session: TerminalActivitySessionSnapshot): void => {
		if (session.projectId === undefined) return;
		manager.rehomeSession(session.sessionId, session.projectId);
		manager.setActivity(
			{ projectId: session.projectId, sessionId: session.sessionId },
			untracked.has(session.sessionId)
				? undefined
				: activityNotificationKind(session),
			session.updatedAt,
		);
	};
	// Activity restored before this binding settles again from here.
	for (const session of Object.values(activity.snapshot().sessions))
		reconcile(session);
	const stopTracking = tracking?.subscribe(() => {
		const previous = untracked;
		const next = tracking.untrackedSessionIds();
		untracked = next;
		const sessions = activity.snapshot().sessions;
		for (const sessionId of next) {
			if (previous.has(sessionId)) continue;
			const session = sessions[sessionId];
			if (session !== undefined) reconcile(session);
		}
		for (const sessionId of previous) {
			if (next.has(sessionId)) continue;
			const session = sessions[sessionId];
			if (session?.projectId === undefined) continue;
			try {
				tracking.acknowledge({
					serverId: activity.serverId,
					projectId: session.projectId,
					sessionId,
				});
			} catch {
				/* a terminal that has just exited has nothing to acknowledge */
			}
			const current = activity.snapshot().sessions[sessionId];
			if (current !== undefined) reconcile(current);
		}
	});
	const stopActivity = activity.subscribe((event) => {
		if (event.type === 'activity.removed' || event.snapshot === undefined) {
			manager.removeSession(event.sessionId);
			return;
		}
		reconcile(event.snapshot);
	});
	const stopInteraction = activity.onInteraction(
		(identity: ActivitySessionIdentity) => {
			// The reducer's own change clears the activity record; what a process
			// sent has no reducer state and is cleared by the interaction itself.
			manager.removeSent(identity.sessionId);
		},
	);
	return () => {
		stopActivity();
		stopInteraction();
		stopTracking?.();
	};
}
