import { ChevronDown } from 'lucide-react';
import type { CSSProperties, RefObject } from 'react';
import { AgentStatusIndicator } from '../components/AgentStatusIndicator';
import type { TerminalActivityState } from '../components/TerminalTab';
import type { AgentState } from '../types/agentStatus';
import { activityCountDigits, formatActivityCount } from './activityCountBadge';

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

export function terminalOverviewStateToAgentState(
	state: TerminalActivityOverviewState,
): Exclude<AgentState, 'idle'> {
	if (state === 'recent') return 'working';
	if (state === 'unviewed') return 'done';
	if (state === 'attention') return 'blocked';
	return state;
}

export function buildTerminalActivityOverview(
	items: TerminalActivityOverviewItem[],
) {
	const priority = (state: TerminalActivityOverviewState) => {
		const canonical = terminalOverviewStateToAgentState(state);
		if (canonical === 'blocked' || canonical === 'waiting') return 0;
		if (canonical === 'working') return 1;
		return 2;
	};
	const sortedItems = [...items].sort(
		(a, b) =>
			priority(a.state) - priority(b.state) ||
			a.projectTitle.localeCompare(b.projectTitle) ||
			a.title.localeCompare(b.title),
	);
	return {
		items: sortedItems,
		attentionCount: sortedItems.filter((item) => {
			const state = terminalOverviewStateToAgentState(item.state);
			return state === 'waiting' || state === 'blocked';
		}).length,
		recentCount: sortedItems.filter(
			(item) => terminalOverviewStateToAgentState(item.state) === 'working',
		).length,
		unviewedCount: sortedItems.filter(
			(item) => terminalOverviewStateToAgentState(item.state) === 'done',
		).length,
	};
}

function ActivityCountPill({
	count,
	state,
}: {
	count: number;
	state: 'attention' | 'recent' | 'unviewed';
}) {
	const label = formatActivityCount(count);
	return (
		<span
			className={`terminal-activity-pill terminal-activity-pill--${state}`}
			data-digits={activityCountDigits(label)}
		>
			{label}
		</span>
	);
}

export function TerminalActivityOverview({
	activityMenuRef,
	attentionCount,
	isOpen,
	items,
	onActivate,
	onToggle,
	recentCount,
	unviewedCount,
}: {
	activityMenuRef: RefObject<HTMLDivElement | null>;
	attentionCount: number;
	isOpen: boolean;
	items: TerminalActivityOverviewItem[];
	onActivate: (item: TerminalActivityOverviewItem) => void;
	onToggle: () => void;
	recentCount: number;
	unviewedCount: number;
}) {
	if (items.length === 0) return null;
	return (
		<div
			ref={activityMenuRef}
			className={`terminal-activity-status${isOpen ? ' terminal-activity-status--open' : ''}`}
		>
			<button
				type="button"
				className="terminal-activity-button"
				onClick={onToggle}
				title="Open terminal activity menu"
				aria-label="Open terminal activity menu"
				aria-haspopup="menu"
				aria-expanded={isOpen}
			>
				{attentionCount > 0 ? <ActivityCountPill count={attentionCount} state="attention" /> : null}
				{unviewedCount > 0 ? <ActivityCountPill count={unviewedCount} state="unviewed" /> : null}
				{recentCount > 0 ? <ActivityCountPill count={recentCount} state="recent" /> : null}
				<ChevronDown className="terminal-activity-button__chevron" size={12} aria-hidden="true" />
			</button>
			{isOpen ? (
				<div className="terminal-activity-menu" role="menu" aria-label="Terminal activity menu">
					<div className="terminal-activity-menu__section-label">Terminal Activity</div>
					{items.map((item) => {
						const state = terminalOverviewStateToAgentState(item.state);
						return (
							<button key={`${item.projectId}:${item.panelId}:${item.sessionId}`} type="button" className="terminal-activity-menu__item" onClick={() => onActivate(item)}>
								<AgentStatusIndicator state={state} label={item.isAgentStatus ? undefined : `Terminal ${state}`} />
								<span className="terminal-activity-menu__preview" style={{ '--tab-color': item.color } as CSSProperties}>
									<span className="terminal-activity-menu__dot" />
									<span className="terminal-activity-menu__emoji" aria-hidden="true">{item.emoji || item.projectEmoji || '>'}</span>
								</span>
								<span className="terminal-activity-menu__text">
									<span className="terminal-activity-menu__title">{item.title}</span>
									<span className="terminal-activity-menu__project">{item.projectEmoji ? `${item.projectEmoji} ` : ''}{item.projectTitle}</span>
								</span>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
