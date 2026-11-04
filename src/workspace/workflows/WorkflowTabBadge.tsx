/**
 * A terminal tab's workflow progress: done over total steps, and a red
 * marker while a step has failed or needs the user (ADR-0097).
 */

import type { ReactElement } from 'react';
import { useTerminalWorkflow } from './useServerWorkflows';
import { tabSummary, type WorkflowTabSummary } from './workflowPanelModel';
import './WorkflowPanel.css';

export function WorkflowTabProgress({
	summary,
}: {
	readonly summary: WorkflowTabSummary | undefined;
}): ReactElement | null {
	if (summary === undefined) return null;
	return (
		<span className="terminal-tab-workflow" role="img" aria-label={summary.label} title={summary.label}>
			{summary.total > 0 ? `${summary.done}/${summary.total}` : null}
			{summary.alert ? <span className="terminal-tab-workflow-alert" /> : null}
		</span>
	);
}

/** The progress for one terminal's tab. */
export function TerminalWorkflowBadge(props: {
	readonly serverId: string | undefined;
	readonly sessionId: string | undefined;
}): ReactElement | null {
	const { view } = useTerminalWorkflow(props.serverId, props.sessionId);
	return <WorkflowTabProgress summary={tabSummary(view)} />;
}
