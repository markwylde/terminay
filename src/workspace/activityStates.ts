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

/** A bot's unacknowledged posts, as its Notifications row shows them. */
export type BotNotificationRow = Readonly<{
	/** The server that published it; bot ids are per server. */
	serverId: string;
	botId: string;
	name: string;
	avatar: string;
	colour: string;
	count: number;
	/** The latest post this row covers; dismissing it acknowledges no further. */
	throughSequence: number;
	/** Plain-text excerpt of the latest post. */
	excerpt: string;
}>;

export type TerminalActivityOverviewItem = {
	color: string;
	emoji: string;
	/** The server's id for this notification, when the server published it. */
	notificationId?: string;
	panelId: string;
	projectEmoji: string;
	projectId: string;
	projectTitle: string;
	sessionId: string;
	/** The text of a notification a process in the terminal sent. Plain text. */
	sent?: { title?: string; body: string };
	/**
	 * Present on a bot's notification, which belongs to no terminal: the
	 * terminal fields are then empty and the row names the bot instead.
	 */
	bot?: BotNotificationRow;
	/** When the terminal entered `state`, in epoch milliseconds, when known. */
	since?: number;
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
