import type { TerminalInactivityHold } from '../terminalService/types.js';
import type { AgentStatusService } from './agentService.js';
import type { AgentStatusSnapshot } from './agentTypes.js';

/** Terminal sessions whose live bound root agent is working. Subagents report
 * through their root, and every other agent state leaves the terminal free. */
export function workingAgentTerminals(
	snapshot: AgentStatusSnapshot,
): ReadonlySet<string> {
	const sessions = new Set<string>();
	for (const entry of Object.values(snapshot.entries)) {
		if (entry.kind !== 'root' || !entry.active || entry.state !== 'working')
			continue;
		const sessionId =
			entry.terminalSessionId ?? entry.activationTerminalSessionId;
		if (sessionId !== null) sessions.add(sessionId);
	}
	return sessions;
}

/**
 * Hold a terminal's inactivity wait open while an agent bound to that exact
 * terminal session is working. Listeners hear a session only when its answer
 * changes, so nothing here polls.
 */
export function createAgentInactivityHold(
	agents: AgentStatusService,
): TerminalInactivityHold {
	const held = (): ReadonlySet<string> =>
		agents.integrationEnabled
			? workingAgentTerminals(agents.getSnapshot())
			: new Set();
	return {
		isHeld: (identity) => held().has(identity.sessionId),
		subscribe: (listener) => {
			let previous = held();
			return agents.subscribe(() => {
				const next = held();
				const changed = new Set(
					[...previous, ...next].filter(
						(sessionId) => previous.has(sessionId) !== next.has(sessionId),
					),
				);
				previous = next;
				for (const sessionId of changed) {
					try {
						listener(sessionId);
					} catch {
						/* a waiter fault cannot disturb agent status delivery */
					}
				}
			});
		},
	};
}
