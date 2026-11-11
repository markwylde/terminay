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
	WorkflowStep,
	WorkflowTarget,
} from '@terminay/client-core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { WorkflowStepMarker } from './workflowIcons';
import {
	canRestore,
	canSkip,
	doneCount,
	elapsed,
	isActive,
	PANEL_SKIP_NOTE,
	showsStepNote,
	statusLabel,
	stepTime,
	WORKFLOW_PANEL_MAX_WIDTH,
	WORKFLOW_PANEL_MIN_WIDTH,
	WORKFLOW_PANEL_RESIZE_STEP,
	WORKFLOW_PANEL_WIDTH,
	type WorkflowPanelMode,
	type WorkflowPanelNotes,
} from './workflowPanelModel';
import {
	setWorkflowPanelNotes,
	setWorkflowPanelSetting,
	setWorkflowPanelWidth,
} from './workflowPanelSetting';
import './WorkflowPanel.css';

export interface WorkflowPanelProps {
	readonly view: SessionWorkflow;
	readonly mode: WorkflowPanelMode;
	readonly target: WorkflowTarget;
	readonly client?: WorkflowClient;
	/** Give the keyboard back to the terminal. */
	readonly focusTerminal: () => void;
	/** The width the expanded panel is drawn at in this pane. */
	readonly width?: number;
	/** The widest the expanded panel may be in this pane. */
	readonly maxWidth?: number;
	/** The narrow-pane overlay's width. */
	readonly overlayWidth?: number;
	/** The width under a dragging pointer, or null when no drag is live. */
	readonly onPreviewWidth?: (width: number | null) => void;
	/** How step notes are shown; the device's choice. Full when not given. */
	readonly notes?: WorkflowPanelNotes;
}

const NOTES_OPTIONS: readonly [WorkflowPanelNotes, string][] = [
	['full', 'Full'],
	['short', '2 lines'],
	['current', 'Current only'],
];

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

	const width = props.width ?? WORKFLOW_PANEL_WIDTH;
	const style = {
		'--workflow-panel-width': `${width}px`,
		'--workflow-overlay-width': `${props.overlayWidth ?? WORKFLOW_PANEL_WIDTH}px`,
	} as CSSProperties;

	return (
		<aside
			className={`workflow-panel workflow-panel--${
				props.mode === 'expanded' ? 'expanded' : 'collapsed'
			} workflow-panel--notes-${props.notes ?? 'full'}`}
			aria-label="Workflow"
			data-workflow-mode={props.mode}
			style={style}
		>
			{props.mode === 'expanded' ? (
				<>
					<WorkflowPanelSeparator
						width={width}
						maxWidth={Math.max(
							WORKFLOW_PANEL_MIN_WIDTH,
							Math.min(props.maxWidth ?? WORKFLOW_PANEL_MAX_WIDTH, WORKFLOW_PANEL_MAX_WIDTH),
						)}
						onPreview={props.onPreviewWidth}
					/>
					<ExpandedWorkflow {...props} onCollapse={collapse} />
				</>
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

/**
 * The expanded panel's left edge. It follows the workspace separators'
 * gesture rules: a drag starts from the drawn width and previews live, so the
 * pane narrows the terminal with it and never covers it; releasing commits
 * once, and only if the pointer moved; a cancelled drag commits nothing.
 */
function WorkflowPanelSeparator({
	width,
	maxWidth,
	onPreview,
}: {
	readonly width: number;
	readonly maxWidth: number;
	readonly onPreview: ((width: number | null) => void) | undefined;
}) {
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startWidth: number;
		latest: number;
		moved: boolean;
		removeListeners: () => void;
	} | null>(null);
	const onPreviewRef = useRef(onPreview);
	onPreviewRef.current = onPreview;
	const clamp = (next: number) =>
		Math.min(maxWidth, Math.max(WORKFLOW_PANEL_MIN_WIDTH, Math.round(next)));
	const clampRef = useRef(clamp);
	clampRef.current = clamp;

	const end = (commit: boolean) => {
		const drag = dragRef.current;
		if (drag === null) return;
		dragRef.current = null;
		drag.removeListeners();
		if (commit && drag.moved) setWorkflowPanelWidth(drag.latest);
		onPreviewRef.current?.(null);
	};
	const endRef = useRef(end);
	endRef.current = end;

	// Unmounting mid-drag, say because the panel collapsed, commits nothing.
	useEffect(() => () => endRef.current(false), []);

	return (
		<hr
			className="workflow-panel-separator"
			aria-label="Resize workflow panel"
			aria-orientation="vertical"
			aria-valuemin={WORKFLOW_PANEL_MIN_WIDTH}
			aria-valuemax={maxWidth}
			aria-valuenow={width}
			aria-valuetext={`${width} pixels`}
			tabIndex={0}
			onKeyDown={(event) => {
				// The panel sits on the right, so moving its edge left widens it.
				const step =
					event.key === 'ArrowLeft'
						? WORKFLOW_PANEL_RESIZE_STEP
						: event.key === 'ArrowRight'
							? -WORKFLOW_PANEL_RESIZE_STEP
							: 0;
				if (step === 0) return;
				event.preventDefault();
				event.stopPropagation();
				setWorkflowPanelWidth(clamp(width + step));
			}}
			onPointerDown={(event) => {
				if (event.button !== 0 || dragRef.current !== null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture?.(event.pointerId);
				const ownerWindow = event.currentTarget.ownerDocument.defaultView;
				const pointerId = event.pointerId;
				const onMove = (moveEvent: PointerEvent) => {
					const drag = dragRef.current;
					if (drag === null || moveEvent.pointerId !== pointerId) return;
					moveEvent.preventDefault();
					const next = clampRef.current(
						drag.startWidth - (moveEvent.clientX - drag.startX),
					);
					if (moveEvent.clientX !== drag.startX) drag.moved = true;
					if (next === drag.latest) return;
					drag.latest = next;
					onPreviewRef.current?.(next);
				};
				const onUp = (upEvent: PointerEvent) => {
					if (upEvent.pointerId !== pointerId) return;
					endRef.current(upEvent.type === 'pointerup');
				};
				const onBlur = () => endRef.current(false);
				// Losing pointer capture does not end the drag: the handle is thin
				// and a quick pointer leaves it while the button is still held.
				ownerWindow?.addEventListener('pointermove', onMove);
				ownerWindow?.addEventListener('pointerup', onUp);
				ownerWindow?.addEventListener('pointercancel', onUp);
				ownerWindow?.addEventListener('blur', onBlur);
				dragRef.current = {
					pointerId,
					startX: event.clientX,
					startWidth: width,
					latest: width,
					moved: false,
					removeListeners: () => {
						ownerWindow?.removeEventListener('pointermove', onMove);
						ownerWindow?.removeEventListener('pointerup', onUp);
						ownerWindow?.removeEventListener('pointercancel', onUp);
						ownerWindow?.removeEventListener('blur', onBlur);
					},
				};
			}}
		/>
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
					<WorkflowSummary
						workflow={props.view.workflow}
						notes={props.notes ?? 'full'}
					/>
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
				<WorkflowSteps
					workflow={props.view.workflow}
					client={props.client}
					target={props.target}
					notes={props.notes ?? 'full'}
				/>
			)}
			<RemoveWorkflow {...props} />
		</div>
	);
}

function WorkflowSummary({
	workflow,
	notes,
}: {
	readonly workflow: Workflow;
	readonly notes: WorkflowPanelNotes;
}) {
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
			<label className="workflow-notes-field">
				<span className="workflow-notes-label" aria-hidden="true">
					Notes
				</span>
				<select
					className="workflow-notes-select"
					aria-label="Step notes"
					title="Step notes"
					value={notes}
					onChange={(event) =>
						setWorkflowPanelNotes(event.target.value as WorkflowPanelNotes)
					}
				>
					{NOTES_OPTIONS.map(([value, text]) => (
						<option key={value} value={value}>
							{text}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

function WorkflowSteps({
	workflow,
	client,
	target,
	notes,
}: {
	readonly workflow: Workflow;
	readonly client: WorkflowClient | undefined;
	readonly target: WorkflowTarget;
	readonly notes: WorkflowPanelNotes;
}) {
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
							className={`workflow-step${isActive(step.status) ? ' workflow-step--active' : ''}${step.status === 'skipped' ? ' workflow-step--skipped' : ''}`}
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
								{showsStepNote(step, notes) ? (
									<span
										className="workflow-step-note workflow-text"
										title={notes === 'short' ? step.note : undefined}
									>
										{step.note}
									</span>
								) : null}
							</div>
							{time === undefined ? null : (
								<span className="workflow-step-time">{time}</span>
							)}
							{client === undefined ? null : (
								<StepAction step={step} client={client} target={target} />
							)}
						</li>
					);
				})}
			</ol>
		</>
	);
}

/**
 * Skip on a step that has not started or failed, Restore on a skipped one.
 * Each carries the status shown, so a step that changed meanwhile (an agent
 * started it) is refused rather than overwritten.
 */
function StepAction({
	step,
	client,
	target,
}: {
	readonly step: WorkflowStep;
	readonly client: WorkflowClient;
	readonly target: WorkflowTarget;
}) {
	const [failed, setFailed] = useState<'skip' | 'restore' | undefined>();
	const [pending, setPending] = useState(false);
	// A fresh status from the server clears an earlier failure.
	useEffect(() => {
		setFailed(undefined);
	}, [step.status]);
	const skip = canSkip(step.status);
	const restore = canRestore(step.status);
	if (!skip && !restore && failed === undefined) return null;
	const act = () => {
		const kind = skip ? 'skip' : 'restore';
		setFailed(undefined);
		setPending(true);
		void client
			.updateStep(
				target,
				step.id,
				skip ? 'skipped' : 'not_started',
				skip
					? { note: PANEL_SKIP_NOTE, expectedStatus: step.status }
					: { expectedStatus: step.status },
			)
			.catch(() => setFailed(kind))
			.finally(() => setPending(false));
	};
	return (
		<span className="workflow-step-action">
			{skip || restore ? (
				<button
					type="button"
					className="workflow-step-button"
					disabled={pending}
					aria-label={`${skip ? 'Skip' : 'Restore'} ${step.title}`}
					onClick={act}
				>
					{skip ? 'Skip' : 'Restore'}
				</button>
			) : null}
			{failed === undefined ? null : (
				<span className="workflow-error" role="alert">
					{failed === 'skip'
						? 'The step could not be skipped.'
						: 'The step could not be restored.'}
				</span>
			)}
		</span>
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
