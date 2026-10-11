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
 * Feed the manager from terminal activity. This is the whole of what activity
 * knows about notifications: it sets or clears each terminal's one record as
 * the reducer's state changes, and reports interaction. Timing, publication,
 * and delivery belong to the manager.
 */
export function bindNotificationsToActivity(
	manager: NotificationManager,
	activity: TerminalActivityService,
): () => void {
	const reconcile = (session: TerminalActivitySessionSnapshot): void => {
		if (session.projectId === undefined) return;
		manager.rehomeSession(session.sessionId, session.projectId);
		manager.setActivity(
			{ projectId: session.projectId, sessionId: session.sessionId },
			activityNotificationKind(session),
			session.updatedAt,
		);
	};
	// Activity restored before this binding settles again from here.
	for (const session of Object.values(activity.snapshot().sessions))
		reconcile(session);
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
	};
}
