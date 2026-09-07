/**
 * The activity vocabulary shared by every surface that shows a terminal's
 * state: its tab, the header activity menu, the project tab badges, and the
 * dashboard. One definition so a state can never read two ways.
 */

import type { TerminalActivityState } from '../components/TerminalTab';
import type { AgentState } from '../types/agentStatus';

export type TerminalPresentationActivityState = Extract<
	TerminalActivityState,
	'recent' | 'unviewed' | 'attention'
>;

export type TerminalActivityOverviewState =
	| TerminalPresentationActivityState
	| Exclude<AgentState, 'idle'>;

export type TerminalActivityOverviewItem = {
	color: string;
	emoji: string;
	panelId: string;
	projectEmoji: string;
	projectId: string;
	projectTitle: string;
	sessionId: string;
	state: TerminalActivityOverviewState;
	isAgentStatus: boolean;
	title: string;
};

/**
 * Raw-output activity described in the same words as an agent's lifecycle, so
 * a terminal nobody is driving and a terminal an agent owns can sit in one
 * list without the reader having to translate.
 */
export function terminalOverviewStateToAgentState(
	state: TerminalActivityOverviewState,
): Exclude<AgentState, 'idle'> {
	if (state === 'recent') return 'working';
	if (state === 'unviewed') return 'done';
	if (state === 'attention') return 'blocked';
	return state;
}
