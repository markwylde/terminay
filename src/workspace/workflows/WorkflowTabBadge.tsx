/**
 * A terminal's workflow progress as a small dial: a ring filled to the share
 * of steps done, coloured by the workflow's state, named in words. Shown on
 * the terminal's tab and its rows in the Tabs sidebar and compact switcher
 * (ADR-0097). A finished workflow's dial hides once the user has seen it.
 */

import { type ReactElement, useEffect, useState } from 'react';
import { useTerminalWorkflow } from './useServerWorkflows';
import { tabSummary, type WorkflowTabSummary } from './workflowPanelModel';
import { useWorkflowCompletionSeen } from './workflowSeen';
import './WorkflowPanel.css';

const SIZE = 12;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** How often the dial's time is refreshed while a step is active. */
export const WORKFLOW_DIAL_TICK_MS = 30_000;

export function WorkflowDial({
	summary,
}: {
	readonly summary: WorkflowTabSummary;
}): ReactElement {
	const filled = Math.min(1, Math.max(0, summary.fraction)) * CIRCUMFERENCE;
	return (
		<span
			className={`workflow-dial workflow-dial--${summary.tone}`}
			role="img"
			aria-label={summary.label}
			title={summary.label}
			data-workflow-dial={summary.tone}
			data-workflow-dial-done={summary.done}
			data-workflow-dial-total={summary.total}
		>
			<svg
				aria-hidden="true"
				width={SIZE}
				height={SIZE}
				viewBox={`0 0 ${SIZE} ${SIZE}`}
			>
				<circle
					className="workflow-dial__track"
					cx={SIZE / 2}
					cy={SIZE / 2}
					r={RADIUS}
					fill="none"
					strokeWidth={STROKE}
				/>
				{filled > 0 ? (
					<circle
						className="workflow-dial__arc"
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						strokeWidth={STROKE}
						strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
						// Start at twelve o'clock and fill clockwise.
						transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
					/>
				) : null}
			</svg>
		</span>
	);
}

/** The time, refreshed every half minute while a step is active. */
function useDialNow(ticking: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), WORKFLOW_DIAL_TICK_MS);
		return () => clearInterval(timer);
	}, [ticking]);
	return now;
}

/** The dial for one terminal, or nothing without a workflow or once seen. */
export function TerminalWorkflowBadge(props: {
	readonly serverId: string | undefined;
	readonly sessionId: string | undefined;
}): ReactElement | null {
	const { view } = useTerminalWorkflow(props.serverId, props.sessionId);
	const ticking =
		view?.state === 'attached' &&
		view.workflow.steps.some(
			(step) => step.status === 'running' || step.status === 'needs_input',
		);
	const now = useDialNow(ticking);
	const summary = tabSummary(view, now);
	const seen = useWorkflowCompletionSeen(summary?.completionKey);
	if (summary === undefined || seen) return null;
	return <WorkflowDial summary={summary} />;
}
