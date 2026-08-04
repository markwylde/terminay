import type { AgentState } from '../types/agentStatus';
import './AgentStatusIndicator.css';

export type AgentStatusIndicatorSize = 'small' | 'medium';

export type AgentStatusIndicatorProps = {
	state: AgentState;
	needsAttention?: boolean;
	showIdle?: boolean;
	size?: AgentStatusIndicatorSize;
	className?: string;
	label?: string;
};

const STATE_LABELS: Record<AgentState, string> = {
	working: 'Agent working',
	waiting: 'Agent waiting for input',
	blocked: 'Agent blocked',
	done: 'Agent done',
	idle: 'Agent idle',
};

export function getAgentStatusLabel(
	state: AgentState,
	needsAttention = false,
): string {
	return needsAttention && state !== 'waiting' && state !== 'blocked'
		? 'Agent needs attention'
		: STATE_LABELS[state];
}

export function AgentStatusIndicator({
	state,
	needsAttention = false,
	showIdle = false,
	size = 'small',
	className,
	label,
}: AgentStatusIndicatorProps) {
	if (state === 'idle' && !needsAttention && !showIdle) {
		return null;
	}

	const visualState = needsAttention ? 'attention' : state;
	const classes = [
		'agent-status-indicator',
		`agent-status-indicator--${visualState}`,
		`agent-status-indicator--${size}`,
		className,
	]
		.filter(Boolean)
		.join(' ');

	return (
		<span
			className={classes}
			data-agent-state={state}
			data-needs-attention={needsAttention || undefined}
			role="img"
			aria-label={label ?? getAgentStatusLabel(state, needsAttention)}
			title={label ?? getAgentStatusLabel(state, needsAttention)}
		>
			<span className="agent-status-indicator__glyph" aria-hidden="true" />
		</span>
	);
}
