/**
 * A terminal's workflow along the bottom of its pane: the horizontal layout
 * (ADR-0128). Expanded, a metro map with a column per depth of dependency;
 * collapsed, a 46px strip. Pane chrome like the vertical panel: the pane
 * reserves its height and the terminal fits what is left. Every piece of
 * workflow text is rendered as a text node.
 */

import type {
	SessionWorkflow,
	Workflow,
	WorkflowClient,
	WorkflowStep,
	WorkflowTarget,
} from '@terminay/client-core';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
	type CSSProperties,
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useWorkflowTrace, type WorkflowTrace } from './useWorkflowTrace';
import { type MetroLayout, metroLayout } from './workflowGraph';
import { WorkflowStepMarker } from './workflowIcons';
import { WorkflowOptionsMenu } from './WorkflowOptionsMenu';
import { StepAction, useNow } from './WorkflowPanel';
import {
	isSettledStatus,
	markerStyle,
	progressLabel,
	statusLabel,
	stepTime,
	stripWords,
	WORKFLOW_DRAWER_HEADER_HEIGHT,
	WORKFLOW_STRIP_HEIGHT,
	type WorkflowPanelMode,
} from './workflowPanelModel';
import { setWorkflowDrawerSetting } from './workflowPanelSetting';
import './WorkflowPanel.css';

export interface WorkflowDrawerProps {
	readonly view: SessionWorkflow;
	readonly mode: WorkflowPanelMode;
	readonly target: WorkflowTarget;
	readonly client?: WorkflowClient;
	/** Give the keyboard back to the terminal. */
	readonly focusTerminal: () => void;
	/** The expanded drawer's height in this pane. */
	readonly height: number;
	/** The short-pane overlay's height. */
	readonly overlayHeight: number;
}

/** The expanded map's geometry: column pitch, lane pitch, marker size and margins. */
const MAP = { column: 120, lane: 56, marker: 22, top: 8, left: 50 } as const;
/** The strip's small map. */
const SMALL = { column: 24, lane: 12, marker: 10, top: 2, left: 6 } as const;
/** Characters a station's label keeps before it is shortened with an ellipsis. */
const LABEL_CHARS = 15;

export function WorkflowDrawer(props: WorkflowDrawerProps) {
	const [overlay, setOverlay] = useState(false);
	const forced = props.mode === 'forced-collapsed';
	useEffect(() => {
		if (!forced) setOverlay(false);
	}, [forced]);

	const expand = () => {
		if (forced) setOverlay(true);
		else setWorkflowDrawerSetting('expanded');
	};
	const collapse = () => {
		if (overlay) {
			setOverlay(false);
			props.focusTerminal();
		} else setWorkflowDrawerSetting('collapsed');
	};

	const expanded = props.mode === 'expanded';
	const style = {
		'--workflow-drawer-height': `${expanded ? props.height : WORKFLOW_STRIP_HEIGHT}px`,
		'--workflow-drawer-overlay-height': `${props.overlayHeight}px`,
	} as CSSProperties;
	return (
		<aside
			className={`workflow-drawer workflow-drawer--${expanded ? 'expanded' : 'collapsed'}`}
			aria-label="Workflow"
			data-workflow-mode={props.mode}
			data-workflow-layout="horizontal"
			style={style}
		>
			{expanded ? (
				<ExpandedDrawer {...props} onCollapse={collapse} />
			) : overlay ? null : (
				// The overlay replaces the strip; the aside keeps the strip's height so
				// the terminal does not refit.
				<WorkflowStrip {...props} onExpand={expand} />
			)}
			{overlay ? <DrawerOverlay {...props} onClose={collapse} /> : null}
		</aside>
	);
}

function WorkflowStrip(props: WorkflowDrawerProps & { readonly onExpand: () => void }) {
	const { view } = props;
	const words = view.state === 'attached' ? stripWords(view.workflow.steps) : undefined;
	const done =
		view.state === 'attached'
			? view.workflow.steps.filter((step) => isSettledStatus(step.status)).length
			: 0;
	return (
		<div className="workflow-strip">
			{view.state === 'attached' ? (
				<>
					<span className="workflow-strip-count">
						{done}/{view.workflow.steps.length}
					</span>
					<SmallMap workflow={view.workflow} />
					<span className="workflow-strip-now" title={view.workflow.name}>
						{typeof words === 'string' || words === undefined
							? words
							: words.map((word, index) => (
									<span key={`${index}:${word.title}`}>
										{index > 0 ? ' · ' : null}
										<b
											className={
												word.needsYou ? 'workflow-strip-word--alert' : undefined
											}
										>
											{word.title}
										</b>
										{word.needsYou ? ' needs you' : null}
									</span>
								))}
					</span>
				</>
			) : (
				<span className="workflow-strip-now workflow-error" role="status">
					Workflow could not be restored
				</span>
			)}
			<div className="workflow-header-buttons">
				<WorkflowOptionsMenu
					view={view}
					target={props.target}
					direction="up"
					{...(props.client === undefined ? {} : { client: props.client })}
				/>
				<button
					type="button"
					className="workflow-toggle"
					aria-label="Expand workflow"
					title="Expand workflow"
					onClick={props.onExpand}
				>
					<ChevronUp size={14} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}

function ExpandedDrawer(props: WorkflowDrawerProps & { readonly onCollapse: () => void }) {
	const { view } = props;
	return (
		<div className="workflow-drawer-expanded">
			<header
				className="workflow-drawer-header"
				style={{ minHeight: WORKFLOW_DRAWER_HEADER_HEIGHT }}
			>
				{view.state === 'attached' ? (
					<DrawerSummary workflow={view.workflow} />
				) : (
					<span className="workflow-drawer-name">Workflow</span>
				)}
				<div className="workflow-header-buttons">
					<WorkflowOptionsMenu
						view={view}
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
						<ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
			</header>
			{view.state === 'attached' ? (
				<MetroMap workflow={view.workflow} client={props.client} target={props.target} />
			) : (
				<p className="workflow-unrestorable" role="status">
					This terminal’s workflow could not be restored.
				</p>
			)}
		</div>
	);
}

function DrawerSummary({ workflow }: { readonly workflow: Workflow }) {
	const now = useNow(workflow);
	return (
		<div className="workflow-drawer-summary">
			<span className="workflow-drawer-name">{workflow.name}</span>
			<span className="workflow-progress">{progressLabel(workflow, now)}</span>
		</div>
	);
}

function point(layout: MetroLayout, id: string, geometry: typeof MAP | typeof SMALL) {
	const node = layout.nodes.get(id);
	return [
		geometry.left + (node?.column ?? 0) * geometry.column,
		geometry.top + (node?.lane ?? 0) * geometry.lane + geometry.marker / 2,
	] as const;
}

/** A line from a step to one that waits on it: straight in a lane, curving between lanes. */
function edgePath(
	from: readonly [number, number],
	to: readonly [number, number],
	column: number,
): string {
	const [x1, y1] = from;
	const [x2, y2] = to;
	if (y1 === y2) return `M${x1} ${y1}H${x2}`;
	if (y2 > y1)
		return `M${x1} ${y1}C${x1 + column * 0.5} ${y1} ${x1 + column * 0.5} ${y2} ${x1 + column} ${y2}H${x2}`;
	return `M${x1} ${y1}H${x2 - column}C${x2 - column * 0.5} ${y1} ${x2 - column * 0.5} ${y2} ${x2} ${y2}`;
}

function shortLabel(title: string): string {
	return title.length > LABEL_CHARS ? `${title.slice(0, LABEL_CHARS - 1)}…` : title;
}

function MetroMap({
	workflow,
	client,
	target,
}: {
	readonly workflow: Workflow;
	readonly client: WorkflowClient | undefined;
	readonly target: WorkflowTarget;
}) {
	const now = useNow(workflow);
	const layout = useMemo(() => metroLayout(workflow.steps), [workflow.steps]);
	const byId = useMemo(
		() => new Map(workflow.steps.map((step) => [step.id, step])),
		[workflow.steps],
	);
	const trace = useWorkflowTrace(workflow.steps);
	const [selected, setSelected] = useState<string | null>(null);
	const [focusable, setFocusable] = useState<string | null>(null);
	const stationRefs = useRef(new Map<string, HTMLButtonElement>());
	const selectedStep = selected === null ? undefined : byId.get(selected);
	const roving = focusable !== null && byId.has(focusable) ? focusable : workflow.steps[0]?.id;

	const width = MAP.left * 2 + Math.max(0, layout.columns - 1) * MAP.column;
	const height = MAP.top + Math.max(0, layout.lanes - 1) * MAP.lane + MAP.marker + 30;

	const onStationKey = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
		const delta =
			event.key === 'ArrowRight' || event.key === 'ArrowDown'
				? 1
				: event.key === 'ArrowLeft' || event.key === 'ArrowUp'
					? -1
					: 0;
		if (delta === 0) return;
		event.preventDefault();
		event.stopPropagation();
		const at = workflow.steps.findIndex((step) => step.id === id);
		const next = workflow.steps[Math.min(workflow.steps.length - 1, Math.max(0, at + delta))];
		if (next === undefined) return;
		setFocusable(next.id);
		stationRefs.current.get(next.id)?.focus();
	};

	return (
		<div className="workflow-drawer-body">
			<div
				className={`workflow-metro${trace.lit === null ? '' : ' workflow-metro--tracing'}`}
				style={{ width, height }}
			>
				<svg
					className="workflow-metro-edges"
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					aria-hidden="true"
				>
					{layout.edges.map((edge) => {
						const done = byId.get(edge.from)?.status === 'done';
						const lit = trace.lit === null ? undefined : trace.edgeLit(edge.from, edge.to);
						return (
							<path
								key={`${edge.from}>${edge.to}`}
								className={`workflow-edge workflow-edge--${done ? 'done' : 'waiting'}${lit === undefined ? '' : lit ? ' workflow-edge--traced' : ' workflow-edge--dimmed'}`}
								data-workflow-edge={`${edge.from}>${edge.to}`}
								d={edgePath(point(layout, edge.from, MAP), point(layout, edge.to, MAP), MAP.column)}
								strokeWidth={3.5}
							/>
						);
					})}
				</svg>
				{workflow.steps.map((step) => (
					<Station
						key={step.id}
						step={step}
						at={point(layout, step.id, MAP)}
						now={now}
						trace={trace}
						selected={selected === step.id}
						tabbable={roving === step.id}
						buttonRef={(element) => {
							if (element === null) stationRefs.current.delete(step.id);
							else stationRefs.current.set(step.id, element);
						}}
						onKeyDown={(event) => onStationKey(event, step.id)}
						onSelect={() => {
							setFocusable(step.id);
							setSelected((current) => (current === step.id ? null : step.id));
						}}
					/>
				))}
			</div>
			{selectedStep === undefined ? null : (
				<StationDetail step={selectedStep} now={now} client={client} target={target} />
			)}
		</div>
	);
}

function Station(props: {
	readonly step: WorkflowStep;
	readonly at: readonly [number, number];
	readonly now: number;
	readonly trace: WorkflowTrace;
	readonly selected: boolean;
	readonly tabbable: boolean;
	readonly buttonRef: (element: HTMLButtonElement | null) => void;
	readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	readonly onSelect: () => void;
}) {
	const { step } = props;
	const time = stepTime(step, props.now);
	const lit = props.trace.lit;
	const traceClass =
		lit === null ? '' : lit.has(step.id) ? ' workflow-station--traced' : ' workflow-station--dimmed';
	return (
		<button
			ref={props.buttonRef}
			type="button"
			className={`workflow-station${props.selected ? ' workflow-station--selected' : ''}${traceClass}`}
			data-status={step.status}
			data-workflow-step-id={step.id}
			aria-pressed={props.selected}
			aria-label={`${step.title}, ${statusLabel(step.status)}`}
			title={step.title}
			tabIndex={props.tabbable ? 0 : -1}
			style={{ left: props.at[0], top: props.at[1] - MAP.marker / 2 }}
			onClick={props.onSelect}
			onKeyDown={props.onKeyDown}
			{...props.trace.bind(step.id)}
		>
			<WorkflowStepMarker step={step} labelled={false} />
			<span className="workflow-station-label">{shortLabel(step.title)}</span>
			{time === undefined ? null : (
				<span className="workflow-station-time">
					{step.status === 'needs_input' ? `needs you · ${time}` : time}
				</span>
			)}
		</button>
	);
}

/** The selected station's step in full, beneath the map, with Skip or Restore. */
function StationDetail({
	step,
	now,
	client,
	target,
}: {
	readonly step: WorkflowStep;
	readonly now: number;
	readonly client: WorkflowClient | undefined;
	readonly target: WorkflowTarget;
}) {
	const time = stepTime(step, now);
	return (
		<div
			className={`workflow-station-detail${step.status === 'skipped' ? ' workflow-step--skipped' : ''}`}
			data-workflow-station-detail={step.id}
			data-status={step.status}
		>
			<div className="workflow-step-body">
				<span className="workflow-step-title">{step.title}</span>
				<span className="workflow-station-detail-status">
					{statusLabel(step.status)}
					{time === undefined ? null : ` · ${time}`}
				</span>
				{step.note === '' ? null : (
					<span className="workflow-step-note workflow-text">{step.note}</span>
				)}
			</div>
			{client === undefined ? null : (
				<StepAction step={step} client={client} target={target} />
			)}
		</div>
	);
}

/** The strip's map: markers only, no labels. */
function SmallMap({ workflow }: { readonly workflow: Workflow }) {
	const layout = useMemo(() => metroLayout(workflow.steps), [workflow.steps]);
	const width = SMALL.left * 2 + Math.max(0, layout.columns - 1) * SMALL.column;
	const height = SMALL.top * 2 + Math.max(0, layout.lanes - 1) * SMALL.lane + SMALL.marker;
	return (
		<svg
			className="workflow-strip-map"
			width={width}
			height={height}
			viewBox={`0 0 ${width} ${height}`}
			aria-hidden="true"
		>
			{layout.edges.map((edge) => {
				const done = workflow.steps.find((step) => step.id === edge.from)?.status === 'done';
				return (
					<path
						key={`${edge.from}>${edge.to}`}
						className={`workflow-edge workflow-edge--${done ? 'done' : 'waiting'}`}
						d={edgePath(point(layout, edge.from, SMALL), point(layout, edge.to, SMALL), SMALL.column)}
						strokeWidth={2}
					/>
				);
			})}
			{workflow.steps.map((step) => {
				const [x, y] = point(layout, step.id, SMALL);
				const style = markerStyle(step.status);
				return (
					<circle
						key={step.id}
						className={`workflow-strip-dot workflow-marker--${style.tone}${style.filled ? ' workflow-strip-dot--filled' : ''}`}
						cx={x}
						cy={y}
						r={SMALL.marker / 2 - 1}
					/>
				);
			})}
		</svg>
	);
}

/**
 * The expanded drawer over the bottom of a short pane. It does not resize the
 * terminal; it holds the keyboard until it closes, so nothing typed while it
 * is open reaches the terminal.
 */
function DrawerOverlay(props: WorkflowDrawerProps & { readonly onClose: () => void }) {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		ref.current?.focus();
	}, []);
	return (
		<div
			ref={ref}
			className="workflow-drawer-overlay"
			role="dialog"
			aria-label="Workflow"
			tabIndex={-1}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === 'Escape') {
					event.preventDefault();
					props.onClose();
				}
			}}
			onBlur={(event) => {
				const next = event.relatedTarget;
				if (next instanceof Node && ref.current?.contains(next)) return;
				if (next !== null) props.onClose();
			}}
		>
			<ExpandedDrawer {...props} onCollapse={props.onClose} />
		</div>
	);
}
