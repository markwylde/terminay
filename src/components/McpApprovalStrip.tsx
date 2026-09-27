import type { McpApprovalDecision } from '@terminay/client-core';
import { useEffect, useState } from 'react';
import type { TerminalMcpApprovals } from '../workspace/mcpApprovals/useServerMcpApprovals';

/**
 * An MCP request waiting on the user, shown inline above the terminal that
 * made it (ADR-0031). It is part of the pane, never a modal or a window, so
 * it works the same on desktop, in a browser, and on a phone. Every client
 * showing the terminal shows it; the first decision clears it everywhere.
 */
export function McpApprovalStrip({ pending }: { readonly pending: TerminalMcpApprovals }) {
	const approval = pending.approvals[0];
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const approvalId = approval?.id;
	useEffect(() => {
		setExpanded(false);
		setBusy(false);
		setError(undefined);
	}, [approvalId]);
	if (approval === undefined) return null;
	const decide = (decision: McpApprovalDecision) => {
		setBusy(true);
		setError(undefined);
		pending.decide(approval.id, decision).catch((cause: unknown) => {
			setBusy(false);
			setError(cause instanceof Error ? cause.message : 'The decision could not be sent.');
		});
	};
	const count = pending.approvals.length;
	return (
		<section
			className="terminal-mcp-approval"
			role="alert"
			aria-label="MCP permission request"
			data-mcp-approval-id={approval.id}
		>
			<div className="terminal-mcp-approval-summary">
				<p>
					<strong>{approval.agent}</strong> in <strong>{approval.terminalTitle}</strong> wants to{' '}
					{approval.summary}.
				</p>
				<span className="terminal-mcp-approval-meta">
					{approval.groupLabel}
					{count > 1 ? ` · 1 of ${count}` : ''}
				</span>
			</div>
			{approval.details.length > 0 ? (
				<button
					type="button"
					className="terminal-mcp-approval-toggle"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded ? 'Hide details' : 'Show details'}
				</button>
			) : null}
			{expanded ? (
				<dl className="terminal-mcp-approval-details">
					{approval.details.map((detail, index) => (
						// Details are an ordered list whose labels may repeat.
						<div key={index}>
							<dt>{detail.label}</dt>
							<dd>{detail.code === true ? <pre>{detail.value}</pre> : detail.value}</dd>
						</div>
					))}
				</dl>
			) : null}
			{error === undefined ? null : <p className="terminal-mcp-approval-error">{error}</p>}
			<div className="terminal-mcp-approval-actions">
				<button type="button" disabled={busy} onClick={() => decide('once')}>
					Allow One Time
				</button>
				<button type="button" disabled={busy} onClick={() => decide('session')}>
					Allow This Session
				</button>
				<button
					type="button"
					className="terminal-mcp-approval-decline"
					disabled={busy}
					onClick={() => decide('decline')}
				>
					Decline
				</button>
			</div>
		</section>
	);
}
