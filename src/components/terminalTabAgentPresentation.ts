import type { AgentState } from '../types/agentStatus';
import {
	isAgentIndicatorStateVisible,
	type PanelTabAppearance,
} from '../workspace/workspaceInventory';

/**
 * Tab RAG for done/waiting/blocked is an unviewed signal. Working stays live.
 * Given the tab's appearance, the same indicator settings that govern a plain
 * terminal's tab decide whether the glyph shows at all.
 */
export function visibleTerminalTabAgentState(
	agentState: AgentState | undefined,
	unread: boolean,
	appearance?: PanelTabAppearance,
): AgentState | undefined {
	if (agentState === undefined || agentState === 'idle') {
		return agentState;
	}
	const visible =
		agentState === 'working' ? 'working' : unread ? agentState : undefined;
	if (
		visible === undefined ||
		appearance === undefined ||
		isAgentIndicatorStateVisible(visible, appearance)
	) {
		return visible;
	}
	return undefined;
}
