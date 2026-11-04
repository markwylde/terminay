/**
 * What a terminal's workflow panel and tab show, as pure functions of the
 * server's workflow (ADR-0097). Nothing here talks to a server.
 */

import type {
	SessionWorkflow,
	Workflow,
	WorkflowStep,
	WorkflowStepStatus,
} from '@terminay/client-core';

/** Width the collapsed rail reserves at the pane's right edge. */
export const WORKFLOW_RAIL_WIDTH = 28;
/** Width the expanded panel reserves. */
export const WORKFLOW_PANEL_WIDTH = 264;
/** A terminal narrower than this beside the expanded panel keeps the rail. */
export const WORKFLOW_MIN_TERMINAL_COLUMNS = 60;

export type WorkflowMarkerTone = 'done' | 'running' | 'alert' | 'idle';
export type WorkflowStatusGlyph = 'check' | 'dot' | 'cross' | 'exclamation' | 'none';

export interface WorkflowMarkerStyle {
	readonly tone: WorkflowMarkerTone;
	/** Filled markers are solid; outlined ones are a ring. */
	readonly filled: boolean;
	/** Shown when the step has no icon. */
	readonly glyph: WorkflowStatusGlyph;
}

const MARKERS: Readonly<Record<WorkflowStepStatus, WorkflowMarkerStyle>> =
	Object.freeze({
		done: { tone: 'done', filled: true, glyph: 'check' },
		running: { tone: 'running', filled: false, glyph: 'dot' },
		failed: { tone: 'alert', filled: true, glyph: 'cross' },
		needs_input: { tone: 'alert', filled: true, glyph: 'exclamation' },
		not_started: { tone: 'idle', filled: false, glyph: 'none' },
	});

export function markerStyle(status: WorkflowStepStatus): WorkflowMarkerStyle {
	return MARKERS[status];
}

const STATUS_LABELS: Readonly<Record<WorkflowStepStatus, string>> =
	Object.freeze({
		not_started: 'not started',
		running: 'running',
		done: 'done',
		failed: 'failed',
		needs_input: 'needs you',
	});

export function statusLabel(status: WorkflowStepStatus): string {
	return STATUS_LABELS[status];
}

/** A marker's accessible name: the step's title and its status. */
export function markerName(step: Pick<WorkflowStep, 'title' | 'status'>): string {
	return `${step.title}: ${statusLabel(step.status)}`;
}

export function isActive(status: WorkflowStepStatus): boolean {
	return status === 'running' || status === 'needs_input';
}

export function doneCount(workflow: Workflow): number {
	return workflow.steps.filter((step) => step.status === 'done').length;
}

/** What a terminal's tab shows: done over total, and whether anything needs attention. */
export interface WorkflowTabSummary {
	readonly done: number;
	readonly total: number;
	readonly alert: boolean;
	readonly label: string;
}

export function tabSummary(
	view: SessionWorkflow | undefined,
): WorkflowTabSummary | undefined {
	if (view === undefined) return undefined;
	if (view.state === 'unrestorable')
		return {
			done: 0,
			total: 0,
			alert: true,
			label: 'Workflow could not be restored',
		};
	const done = doneCount(view.workflow);
	const total = view.workflow.steps.length;
	const alert = view.workflow.steps.some(
		(step) => step.status === 'failed' || step.status === 'needs_input',
	);
	return {
		done,
		total,
		alert,
		label: `Workflow ${view.workflow.name}: ${done} of ${total} done${alert ? ', needs attention' : ''}`,
	};
}

/** Milliseconds as "45s", "12m", or "1h 05m". */
export function formatDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.floor(milliseconds / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** A step's duration once it ended, its running time while active, or nothing. */
export function stepTime(step: WorkflowStep, now: number): string | undefined {
	if (step.startedAt === null) return undefined;
	if (step.endedAt !== null) return formatDuration(step.endedAt - step.startedAt);
	return isActive(step.status) ? formatDuration(now - step.startedAt) : undefined;
}

/** Time since the first step started, or nothing before any has. */
export function elapsed(workflow: Workflow, now: number): string | undefined {
	const starts = workflow.steps
		.map((step) => step.startedAt)
		.filter((value): value is number => value !== null);
	if (starts.length === 0) return undefined;
	const first = Math.min(...starts);
	const ends = workflow.steps.map((step) => step.endedAt);
	const finished = workflow.steps.every((step) => step.status === 'done');
	const last = finished
		? Math.max(...ends.filter((value): value is number => value !== null))
		: now;
	return formatDuration(last - first);
}

/**
 * How the panel shows. `columnsBesideRail` is how wide the terminal is with
 * only the rail beside it; the terminal must keep at least the minimum
 * beside the expanded panel, or the panel stays a rail and expands as an
 * overlay that does not resize the terminal.
 */
export type WorkflowPanelMode = 'collapsed' | 'expanded' | 'forced-collapsed';

export function panelMode(
	setting: 'collapsed' | 'expanded',
	columnsBesideRail: number | undefined,
	cellWidth: number | undefined,
): WorkflowPanelMode {
	if (setting === 'collapsed') return 'collapsed';
	if (columnsBesideRail === undefined || cellWidth === undefined || cellWidth <= 0)
		return 'expanded';
	const lost = Math.ceil((WORKFLOW_PANEL_WIDTH - WORKFLOW_RAIL_WIDTH) / cellWidth);
	return columnsBesideRail - lost < WORKFLOW_MIN_TERMINAL_COLUMNS
		? 'forced-collapsed'
		: 'expanded';
}

/** Pixels the pane reserves at its right edge for the panel. */
export function reservedWidth(mode: WorkflowPanelMode | undefined): number {
	if (mode === undefined) return 0;
	return mode === 'expanded' ? WORKFLOW_PANEL_WIDTH : WORKFLOW_RAIL_WIDTH;
}
