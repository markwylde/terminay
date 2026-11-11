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
export const WORKFLOW_RAIL_WIDTH = 36;
/** Width the expanded panel takes until the user resizes it. */
export const WORKFLOW_PANEL_WIDTH = 264;
/** Bounds of the width the user may give the expanded panel. */
export const WORKFLOW_PANEL_MIN_WIDTH = 200;
export const WORKFLOW_PANEL_MAX_WIDTH = 640;
/** How far one arrow key moves the panel's separator. */
export const WORKFLOW_PANEL_RESIZE_STEP = 16;
/** A terminal narrower than this beside the expanded panel keeps the rail. */
export const WORKFLOW_MIN_TERMINAL_COLUMNS = 60;

export type WorkflowMarkerTone = 'done' | 'running' | 'alert' | 'idle' | 'skipped';
export type WorkflowStatusGlyph = 'check' | 'dot' | 'cross' | 'exclamation' | 'dash' | 'none';

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
		skipped: { tone: 'skipped', filled: false, glyph: 'dash' },
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
		skipped: 'skipped',
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

/** Settled steps count as done: done, or deliberately skipped. */
export function isSettledStatus(status: WorkflowStepStatus): boolean {
	return status === 'done' || status === 'skipped';
}

/** Every step is settled (and there is at least one). */
export function isFinished(workflow: Pick<Workflow, 'steps'>): boolean {
	return (
		workflow.steps.length > 0 &&
		workflow.steps.every((step) => isSettledStatus(step.status))
	);
}

export function doneCount(workflow: Pick<Workflow, 'steps'>): number {
	return workflow.steps.filter((step) => isSettledStatus(step.status)).length;
}

/** "All 8 steps done", or "All 8 steps done or skipped" when any was skipped. */
export function finishedLabel(steps: readonly Pick<WorkflowStep, 'status'>[]): string {
	const total = steps.length;
	const noun = total === 1 ? 'step' : 'steps';
	const skipped = steps.some((step) => step.status === 'skipped');
	return `All ${total} ${noun} done${skipped ? ' or skipped' : ''}`;
}

/** The panel offers Skip on a step that has not started or failed. */
export function canSkip(status: WorkflowStepStatus): boolean {
	return status === 'not_started' || status === 'failed';
}

/** The panel offers Restore on a skipped step. */
export function canRestore(status: WorkflowStepStatus): boolean {
	return status === 'skipped';
}

/** The note the panel's Skip writes. */
export const PANEL_SKIP_NOTE = 'Skipped from the panel';

/** The tone of a workflow's progress dial: red, amber, green, or grey. */
export type WorkflowDialTone = 'alert' | 'running' | 'done' | 'idle';

/** What a terminal's tab and rows show for its workflow: a dial and its name. */
export interface WorkflowTabSummary {
	readonly done: number;
	readonly total: number;
	readonly tone: WorkflowDialTone;
	/** The share of the ring that is filled, from 0 to 1. */
	readonly fraction: number;
	/** Set only when every step is done: names this one completion, so a
	 * workflow that reopens and finishes again is a new completion. */
	readonly completionKey?: string;
	/** True while a step is running or needs the user: the time moves. */
	readonly ticking: boolean;
	/** The tooltip and accessible name, in words. */
	readonly label: string;
}

/** The completion a finished workflow is at: its id and its latest step end. */
export function completionKey(workflow: Workflow): string | undefined {
	if (!isFinished(workflow)) return undefined;
	const ends = workflow.steps.map((step) => step.endedAt ?? 0);
	return `${workflow.id}:${Math.max(...ends)}`;
}

export function tabSummary(
	view: SessionWorkflow | undefined,
	now: number = Date.now(),
): WorkflowTabSummary | undefined {
	if (view === undefined) return undefined;
	if (view.state === 'unrestorable')
		return {
			done: 0,
			total: 0,
			tone: 'alert',
			fraction: 1,
			ticking: false,
			label: 'Workflow could not be restored',
		};
	const { steps } = view.workflow;
	const done = doneCount(view.workflow);
	const total = steps.length;
	const fraction = total === 0 ? 0 : done / total;
	const count = `${done} of ${total}`;
	const key = completionKey(view.workflow);
	if (key !== undefined)
		return {
			done,
			total,
			tone: 'done',
			fraction: 1,
			completionKey: key,
			ticking: false,
			label: finishedLabel(steps),
		};
	const active = steps.find((step) => isActive(step.status));
	const failed = steps.filter((step) => step.status === 'failed');
	const tone: WorkflowDialTone =
		failed.length > 0 || steps.some((step) => step.status === 'needs_input')
			? 'alert'
			: active !== undefined
				? 'running'
				: 'idle';
	const failures = failed.map((step) => `${step.title} failed`);
	let parts: string[];
	if (active !== undefined) {
		const name =
			active.status === 'needs_input' ? `${active.title} needs you` : active.title;
		const time =
			active.startedAt === null ? [] : [formatDuration(now - active.startedAt)];
		parts = [name, count, ...time, ...failures];
	} else if (failures.length > 0) {
		const [first, ...rest] = failures;
		parts = [first as string, count, ...rest];
	} else {
		const next = steps.find((step) => !isSettledStatus(step.status));
		parts = next === undefined ? [count] : [`Next: ${next.title}`, count];
	}
	return {
		done,
		total,
		tone,
		fraction,
		ticking: active !== undefined,
		label: parts.join(' · '),
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
	if (step.startedAt === null || step.status === 'skipped') return undefined;
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
	const finished = isFinished(workflow);
	const last = finished
		? Math.max(...ends.filter((value): value is number => value !== null))
		: now;
	return formatDuration(last - first);
}

/**
 * How the panel shows. `columnsBesideRail` is how wide the terminal is with
 * only the rail beside it; the terminal must keep at least the minimum
 * beside the expanded panel. The panel narrows toward its minimum width to
 * keep it, and below that stays a rail and expands as an overlay that does
 * not resize the terminal.
 */
export type WorkflowPanelMode = 'collapsed' | 'expanded' | 'forced-collapsed';

export interface WorkflowPanelLayout {
	readonly mode: WorkflowPanelMode;
	/** The width the expanded panel is drawn at in this pane. */
	readonly width: number;
	/** The widest the expanded panel may be in this pane. */
	readonly maxWidth: number;
}

/** A width the user chose, made one the panel can take. */
export function clampPanelWidth(width: number): number {
	if (!Number.isFinite(width)) return WORKFLOW_PANEL_WIDTH;
	return Math.min(
		WORKFLOW_PANEL_MAX_WIDTH,
		Math.max(WORKFLOW_PANEL_MIN_WIDTH, Math.round(width)),
	);
}

/** The widest panel that keeps the terminal at the minimum columns. */
export function widestPanelWidth(
	columnsBesideRail: number | undefined,
	cellWidth: number | undefined,
): number {
	if (
		columnsBesideRail === undefined ||
		cellWidth === undefined ||
		cellWidth <= 0
	)
		return WORKFLOW_PANEL_MAX_WIDTH;
	const spare = columnsBesideRail - WORKFLOW_MIN_TERMINAL_COLUMNS;
	return Math.min(
		WORKFLOW_PANEL_MAX_WIDTH,
		Math.floor(WORKFLOW_RAIL_WIDTH + spare * cellWidth),
	);
}

export function panelLayout(
	setting: 'collapsed' | 'expanded',
	chosenWidth: number,
	columnsBesideRail: number | undefined,
	cellWidth: number | undefined,
): WorkflowPanelLayout {
	const maxWidth = widestPanelWidth(columnsBesideRail, cellWidth);
	// Narrowness is the pane's, whatever the setting: expanding a narrow pane
	// always opens the overlay and never changes the setting.
	if (maxWidth < WORKFLOW_PANEL_MIN_WIDTH)
		return {
			mode: 'forced-collapsed',
			width: WORKFLOW_PANEL_MIN_WIDTH,
			maxWidth,
		};
	return {
		mode: setting,
		width: Math.min(clampPanelWidth(chosenWidth), maxWidth),
		maxWidth,
	};
}

/** Pixels the pane reserves at its right edge for the panel. */
export function reservedWidth(layout: WorkflowPanelLayout | undefined): number {
	if (layout === undefined) return 0;
	return layout.mode === 'expanded' ? layout.width : WORKFLOW_RAIL_WIDTH;
}

/** The narrow-pane overlay: the chosen width, or most of the pane. */
export function overlayWidth(
	chosenWidth: number,
	paneWidth: number | undefined,
): number {
	const chosen = clampPanelWidth(chosenWidth);
	if (paneWidth === undefined || !(paneWidth > 0)) return chosen;
	return Math.min(chosen, Math.floor(paneWidth * 0.85));
}
