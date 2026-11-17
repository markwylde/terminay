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
import { PaneEdgeSeparator } from '../../components/PaneEdgeSeparator';
import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowTrace, type WorkflowTrace } from './useWorkflowTrace';
import {
	analyzeStages,
	groupTone,
	railWidth as stageRailWidth,
	type StageAnalysis,
	type StageItem,
	stageIds,
	unimpliedDependencies,
} from './workflowGraph';
import { WorkflowStepMarker } from './workflowIcons';
import { WorkflowOptionsMenu } from './WorkflowOptionsMenu';
import {
	canRestore,
	canSkip,
	isActive,
	PANEL_SKIP_NOTE,
	progressParts,
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
	/** The collapsed rail's width; worked out from the workflow when not given. */
	readonly railWidth?: number;
}

/** The collapsed rail's width for a workflow: wider as its brackets nest (ADR-0128). */
export function workflowRailWidth(view: SessionWorkflow): number {
	if (view.state !== 'attached') return stageRailWidth([]);
	return stageRailWidth(analyzeStages(view.workflow.steps).tree);
}

/**
 * A workflow's progress as one line that wraps only between its parts, so
 * "2s elapsed" never breaks from its number.
 */
export function WorkflowProgress({ workflow, now }: { readonly workflow: Workflow; readonly now: number }) {
	const parts = progressParts(workflow, now);
	return (
		<span className="workflow-progress">
			{parts.map((part, index) => (
				<Fragment key={part}>
					{index === 0 ? null : <span aria-hidden="true">{' · '}</span>}
					<span className="workflow-progress-part">{part}</span>
				</Fragment>
			))}
		</span>
	);
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

	const width = props.width ?? WORKFLOW_PANEL_WIDTH;
	const style = {
		'--workflow-panel-width': `${width}px`,
		'--workflow-overlay-width': `${props.overlayWidth ?? WORKFLOW_PANEL_WIDTH}px`,
		'--workflow-rail-width': `${props.railWidth ?? workflowRailWidth(props.view)}px`,
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
					{/* A drag previews live, so the pane narrows the terminal with it
					    and never covers it. */}
					<PaneEdgeSeparator
						className="workflow-panel-separator"
						label="Resize workflow panel"
						step={WORKFLOW_PANEL_RESIZE_STEP}
						width={width}
						min={WORKFLOW_PANEL_MIN_WIDTH}
						max={Math.max(
							WORKFLOW_PANEL_MIN_WIDTH,
							Math.min(props.maxWidth ?? WORKFLOW_PANEL_MAX_WIDTH, WORKFLOW_PANEL_MAX_WIDTH),
						)}
						onPreview={(next) => props.onPreviewWidth?.(next)}
						onCommit={setWorkflowPanelWidth}
					/>
					<ExpandedWorkflow {...props} onCollapse={collapse} />
				</>
			) : overlay ? null : (
				// The overlay replaces the rail; the aside keeps the rail's strip so
				// the terminal does not refit.
				<WorkflowRail {...props} onExpand={expand} />
			)}
			{overlay ? (
				<WorkflowOverlay {...props} onClose={collapse} />
			) : null}
		</aside>
	);
}

function WorkflowRail(
	props: WorkflowPanelProps & { readonly onExpand: () => void },
) {
	const { view } = props;
	return (
		<div className="workflow-rail">
			<button
				type="button"
				className="workflow-toggle"
				aria-label="Expand workflow"
				title="Expand workflow"
				onClick={props.onExpand}
			>
				<ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
			</button>
			<WorkflowOptionsMenu
				view={view}
				target={props.target}
				{...(props.client === undefined ? {} : { client: props.client })}
			/>
			{view.state === 'unrestorable' ? (
				<span
					className="workflow-marker workflow-marker--alert workflow-marker--filled"
					role="img"
					aria-label="Workflow could not be restored"
				>
					!
				</span>
			) : (
				<RailStages workflow={view.workflow} />
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

/** The rail's markers, with each bracket drawn as a capsule around its tracks. */
function RailStages({ workflow }: { readonly workflow: Workflow }) {
	const analysis = useMemo(() => analyzeStages(workflow.steps), [workflow.steps]);
	const byId = useMemo(
		() => new Map(workflow.steps.map((step) => [step.id, step])),
		[workflow.steps],
	);
	const render = (items: readonly StageItem[]): ReactNode[] =>
		items.map((item) => {
			if (typeof item === 'string') {
				const step = byId.get(item);
				if (step === undefined) return null;
				return (
					<li
						key={item}
						className={`workflow-rail-step${isActive(step.status) ? ' workflow-rail-step--active' : ''}`}
					>
						<WorkflowStepMarker step={step} />
					</li>
				);
			}
			const ids = stageIds(item);
			const tone = groupTone(
				ids.flatMap((id) => {
					const step = byId.get(id);
					return step === undefined ? [] : [step.status];
				}),
			);
			const divided = item.tracks.some((track) => track.length > 1);
			return (
				<li
					key={`group:${ids[0] ?? ''}`}
					className={`workflow-capsule workflow-capsule--${tone}`}
					data-workflow-group-tone={tone}
				>
					{item.tracks.map((track, index) => (
						<Fragment key={stageIds(track[0] ?? '')[0] ?? index}>
							{divided && index > 0 ? (
								<span className="workflow-capsule-rule" aria-hidden="true" />
							) : null}
							<ol className="workflow-rail-track">{render(track)}</ol>
						</Fragment>
					))}
				</li>
			);
		});
	return <ol className="workflow-rail-steps">{render(analysis.tree)}</ol>;
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
				<div className="workflow-header-buttons">
					<WorkflowOptionsMenu
						view={props.view}
						target={props.target}
						{...(props.client === undefined ? {} : { client: props.client })}
					/>
					<button
						type="button"
						className="workflow-toggle"
						aria-label="Collapse workflow"
						title="Collapse workflow"
						onClick={props.onCollapse}
					>
						<ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
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
		</div>
	);
}

/**
 * The header's text. The eyebrow shares its row with the header's buttons;
 * the name and progress take the panel's whole width beneath them.
 */
function WorkflowSummary({ workflow }: { readonly workflow: Workflow }) {
	const now = useNow(workflow);
	return (
		<div className="workflow-summary">
			<span className="workflow-eyebrow" aria-hidden="true">
				Workflow
			</span>
			<span className="workflow-name">{workflow.name}</span>
			<WorkflowProgress workflow={workflow} now={now} />
		</div>
	);
}

interface StepsContext {
	readonly analysis: StageAnalysis;
	readonly byId: ReadonlyMap<string, WorkflowStep>;
	readonly trace: WorkflowTrace;
	readonly now: number;
	readonly notes: WorkflowPanelNotes;
	readonly client: WorkflowClient | undefined;
	readonly target: WorkflowTarget;
}

/**
 * The steps in the arrangement their dependencies give (ADR-0128): steps in
 * sequence, and brackets of tracks for steps that run alongside each other.
 */
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
	const analysis = useMemo(() => analyzeStages(workflow.steps), [workflow.steps]);
	const byId = useMemo(
		() => new Map(workflow.steps.map((step) => [step.id, step])),
		[workflow.steps],
	);
	const trace = useWorkflowTrace(workflow.steps);
	const context: StepsContext = { analysis, byId, trace, now, notes, client, target };
	return (
		<>
			{workflow.openingPrompt === '' ? null : (
				<details className="workflow-brief">
					<summary>Brief</summary>
					<p className="workflow-text">{workflow.openingPrompt}</p>
				</details>
			)}
			<ol
				className={`workflow-steps${trace.lit === null ? '' : ' workflow-steps--tracing'}`}
			>
				{renderStages(analysis.tree, byId, (step) => (
					<StepRow key={step.id} step={step} context={context} />
				))}
			</ol>
		</>
	);
}

/**
 * A stage tree as list items: each step through `renderStep`, which returns
 * its `li`, and each bracket as an `li` of tracks, coloured by its steps.
 * The panel and Home's Workflows columns both draw with it.
 */
export function renderStages(
	items: readonly StageItem[],
	byId: ReadonlyMap<string, WorkflowStep>,
	renderStep: (step: WorkflowStep) => ReactNode,
): ReactNode[] {
	return items.map((item) => {
		if (typeof item === 'string') {
			const step = byId.get(item);
			return step === undefined ? null : renderStep(step);
		}
		const ids = stageIds(item);
		const tone = groupTone(
			ids.flatMap((id) => {
				const step = byId.get(id);
				return step === undefined ? [] : [step.status];
			}),
		);
		const divided = item.tracks.some((track) => track.length > 1);
		return (
			<li
				key={`group:${ids[0] ?? ''}`}
				className={`workflow-group workflow-group--${tone}${divided ? ' workflow-group--divided' : ''}`}
				data-workflow-group-tone={tone}
			>
				{item.tracks.map((track, index) => (
					<ol
						key={stageIds(track[0] ?? '')[0] ?? index}
						className="workflow-track"
					>
						{renderStages(track, byId, renderStep)}
					</ol>
				))}
			</li>
		);
	});
}

function StepRow({
	step,
	context,
}: {
	readonly step: WorkflowStep;
	readonly context: StepsContext;
}) {
	const time = stepTime(step, context.now);
	const after = unimpliedDependencies(context.analysis, step.id).flatMap((id) => {
		const title = context.byId.get(id)?.title;
		return title === undefined ? [] : [title];
	});
	const lit = context.trace.lit;
	const traceClass =
		lit === null ? '' : lit.has(step.id) ? ' workflow-step--traced' : ' workflow-step--dimmed';
	return (
		<li
			className={`workflow-step${isActive(step.status) ? ' workflow-step--active' : ''}${step.status === 'skipped' ? ' workflow-step--skipped' : ''}${traceClass}`}
			data-status={step.status}
			data-workflow-step-id={step.id}
			aria-current={isActive(step.status) ? 'step' : undefined}
			// Focusable, so tracing works from the keyboard too.
			// biome-ignore lint/a11y/noNoninteractiveTabindex: focusing a step traces its dependencies (ADR-0128).
			tabIndex={0}
			{...context.trace.bind(step.id)}
		>
			<WorkflowStepMarker step={step} labelled={false} />
			<div className="workflow-step-body">
				<span className="workflow-step-title">
					{step.title}
					{step.status === 'needs_input' ? (
						<span className="workflow-step-needs" aria-hidden="true">
							Needs you
						</span>
					) : null}
					<span className="workflow-visually-hidden">
						{`, ${statusLabel(step.status)}`}
					</span>
				</span>
				{after.length === 0 ? null : (
					<span className="workflow-step-after">after {after.join(', ')}</span>
				)}
				{showsStepNote(step, context.notes) ? (
					<span
						className="workflow-step-note workflow-text"
						title={context.notes === 'short' ? step.note : undefined}
					>
						{step.note}
					</span>
				) : null}
			</div>
			{time === undefined ? null : (
				<span className="workflow-step-time">{time}</span>
			)}
			{context.client === undefined ? null : (
				<StepAction step={step} client={context.client} target={context.target} />
			)}
		</li>
	);
}

/**
 * Skip on a step that has not started or failed, Restore on a skipped one.
 * Each carries the status shown, so a step that changed meanwhile (an agent
 * started it) is refused rather than overwritten.
 */
export function StepAction({
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
export function useNow(workflow: Workflow): number {
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
