import type { AgentState } from '../types/agentStatus';

/** Tab RAG for done/waiting/blocked is an unviewed signal. Working stays live. */
export function visibleTerminalTabAgentState(
	agentState: AgentState | undefined,
	unread: boolean,
): AgentState | undefined {
	if (agentState === undefined || agentState === 'idle') {
		return agentState;
	}
	if (agentState === 'working') {
		return 'working';
	}
	return unread ? agentState : undefined;
}
