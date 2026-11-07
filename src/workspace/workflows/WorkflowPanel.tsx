/**
 * A terminal's workflow, at the right edge of its pane (ADR-0097). Pane
 * chrome, like the app-window rail: the pane reserves the strip and the
 * terminal fits what is left. Every piece of workflow text is rendered as a
 * text node; none of it is ever interpreted.
 */

import type {
	SessionWorkflow,
	Workflow,
	WorkflowClient,
	WorkflowTarget,
} from '@terminay/client-core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WorkflowStepMarker } from './workflowIcons';
import {
	doneCount,
	elapsed,
	isActive,
	statusLabel,
	stepTime,
	type WorkflowPanelMode,
} from './workflowPanelModel';
import { setWorkflowPanelSetting } from './workflowPanelSetting';
import './WorkflowPanel.css';

export interface WorkflowPanelProps {
	readonly view: SessionWorkflow;
	readonly mode: WorkflowPanelMode;
	readonly target: WorkflowTarget;
	readonly client?: WorkflowClient;
	/** Give the keyboard back to the terminal. */
	readonly focusTerminal: () => void;
}

export function WorkflowPanel(props: WorkflowPanelProps) {
	const [overlay, setOverlay] = useState(false);
	const forced = props.mode === 'forced-collapsed';
	// The overlay exists only while the pane is too narrow.
	useEffect(() => {
		if (!forced) setOverlay(false);
	}, [forced]);

	const expand = () => {
		if (forced) setOverlay(true);
		else setWorkflowPanelSetting('expanded');
	};
	const collapse = () => {
		if (overlay) {
			setOverlay(false);
			props.focusTerminal();
		} else setWorkflowPanelSetting('collapsed');
	};

	return (
		<aside
			className={`workflow-panel workflow-panel--${
				props.mode === 'expanded' ? 'expanded' : 'collapsed'
			}`}
			aria-label="Workflow"
			data-workflow-mode={props.mode}
		>
			{props.mode === 'expanded' ? (
				<ExpandedWorkflow {...props} onCollapse={collapse} />
			) : overlay ? null : (
				// The overlay replaces the rail; the aside keeps the rail's strip so
				// the terminal does not refit.
				<WorkflowRail view={props.view} onExpand={expand} />
			)}
			{overlay ? (
				<WorkflowOverlay {...props} onClose={collapse} />
			) : null}
		</aside>
	);
}

function WorkflowRail({
	view,
	onExpand,
}: {
	readonly view: SessionWorkflow;
	readonly onExpand: () => void;
}) {
	return (
		<div className="workflow-rail">
			<button
				type="button"
				className="workflow-toggle"
				aria-label="Expand workflow"
				title="Expand workflow"
				onClick={onExpand}
			>
				<ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
			</button>
			{view.state === 'unrestorable' ? (
				<span
					className="workflow-marker workflow-marker--alert workflow-marker--filled"
					role="img"
					aria-label="Workflow could not be restored"
				>
					!
				</span>
			) : (
				<ol className="workflow-rail-steps">
					{view.workflow.steps.map((step) => (
						<li
							key={step.id}
							className={`workflow-rail-step${isActive(step.status) ? ' workflow-rail-step--active' : ''}`}
						>
							<WorkflowStepMarker step={step} />
						</li>
					))}
				</ol>
			)}
			{view.state === 'attached' ? (
				// The workflow's name, read bottom to top along the foot of the rail.
				<span className="workflow-rail-name" title={view.workflow.name}>
					{view.workflow.name}
				</span>
			) : null}
		</div>
	);
}

function ExpandedWorkflow(
	props: WorkflowPanelProps & { readonly onCollapse: () => void },
) {
	return (
		<div className="workflow-expanded">
			<header className="workflow-header">
				{props.view.state === 'unrestorable' ? (
					<div className="workflow-summary">
						<span className="workflow-eyebrow">Workflow</span>
					</div>
				) : (
					<WorkflowSummary workflow={props.view.workflow} />
				)}
				<button
					type="button"
					className="workflow-toggle"
					aria-label="Collapse workflow"
					title="Collapse workflow"
					onClick={props.onCollapse}
				>
					<ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
				</button>
			</header>
			{props.view.state === 'unrestorable' ? (
				<p className="workflow-unrestorable" role="status">
					This terminal’s workflow could not be restored.
				</p>
			) : (
				<WorkflowSteps workflow={props.view.workflow} />
			)}
			<RemoveWorkflow {...props} />
		</div>
	);
}

function WorkflowSummary({ workflow }: { readonly workflow: Workflow }) {
	const now = useNow(workflow);
	const since = elapsed(workflow, now);
	return (
		<div className="workflow-summary">
			<span className="workflow-eyebrow" aria-hidden="true">
				Workflow
			</span>
			<span className="workflow-name">{workflow.name}</span>
			<span className="workflow-progress">
				{doneCount(workflow)} of {workflow.steps.length} done
				{since === undefined ? null : ` · ${since} elapsed`}
			</span>
		</div>
	);
}

function WorkflowSteps({ workflow }: { readonly workflow: Workflow }) {
	const now = useNow(workflow);
	return (
		<>
			{workflow.openingPrompt === '' ? null : (
				<details className="workflow-brief">
					<summary>Brief</summary>
					<p className="workflow-text">{workflow.openingPrompt}</p>
				</details>
			)}
			<ol className="workflow-steps">
				{workflow.steps.map((step) => {
					const time = stepTime(step, now);
					return (
						<li
							key={step.id}
							className={`workflow-step${isActive(step.status) ? ' workflow-step--active' : ''}`}
							data-status={step.status}
							aria-current={isActive(step.status) ? 'step' : undefined}
						>
							<WorkflowStepMarker step={step} labelled={false} />
							<div className="workflow-step-body">
								<span className="workflow-step-title">
									{step.title}
									<span className="workflow-visually-hidden">
										{`, ${statusLabel(step.status)}`}
									</span>
								</span>
								{step.note === '' ? null : (
									<span className="workflow-step-note workflow-text">
										{step.note}
									</span>
								)}
							</div>
							{time === undefined ? null : (
								<span className="workflow-step-time">{time}</span>
							)}
						</li>
					);
				})}
			</ol>
		</>
	);
}

function RemoveWorkflow(props: WorkflowPanelProps) {
	const [confirming, setConfirming] = useState(false);
	const [failed, setFailed] = useState(false);
	const client = props.client;
	if (client === undefined) return null;
	const remove = () => {
		setFailed(false);
		void client.remove(props.target).catch(() => setFailed(true));
	};
	return (
		<footer className="workflow-footer">
			{confirming ? (
				<>
					<button type="button" className="workflow-remove" onClick={remove}>
						Remove workflow
					</button>
					<button type="button" onClick={() => setConfirming(false)}>
						Keep
					</button>
				</>
			) : (
				<button type="button" onClick={() => setConfirming(true)}>
					Remove…
				</button>
			)}
			{failed ? (
				<span className="workflow-error" role="alert">
					The workflow could not be removed.
				</span>
			) : null}
		</footer>
	);
}

/**
 * The expanded panel over the right of a narrow pane. It does not resize the
 * terminal; it holds the keyboard until it closes, so nothing typed while it
 * is open reaches the terminal.
 */
function WorkflowOverlay(
	props: WorkflowPanelProps & { readonly onClose: () => void },
) {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		ref.current?.focus();
	}, []);
	return (
		<div
			ref={ref}
			className="workflow-overlay"
			role="dialog"
			aria-label="Workflow"
			tabIndex={-1}
			onKeyDown={(event) => {
				// Keys pressed here are the overlay's, never the terminal's.
				event.stopPropagation();
				if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
				}
			}}
			onBlur={(event) => {
				const next = event.relatedTarget;
				if (next instanceof Node && ref.current?.contains(next)) return;
				// Focus moving to the terminal, or anywhere else, closes it.
				if (next !== null) props.onClose();
			}}
		>
			<ExpandedWorkflow {...props} onCollapse={props.onClose} />
		</div>
	);
}

/** The time, ticking once a second while a step is active. */
function useNow(workflow: Workflow): number {
	const [now, setNow] = useState(() => Date.now());
	const ticking = workflow.steps.some((step) => isActive(step.status));
	useEffect(() => {
		if (!ticking) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [ticking]);
	return now;
}
