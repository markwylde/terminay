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

/**
 * Ready steps (ADR-0128): not started or failed, with every step they wait on
 * settled, in step order.
 */
export function readySteps<T extends Pick<WorkflowStep, 'id' | 'status' | 'after'>>(
	steps: readonly T[],
): T[] {
	const settled = new Set(
		steps.filter((step) => isSettledStatus(step.status)).map((step) => step.id),
	);
	return steps.filter(
		(step) =>
			(step.status === 'not_started' || step.status === 'failed') &&
			step.after.every((id) => settled.has(id)),
	);
}

/**
 * A workflow's current steps: those that need input, then those running,
 * each in step order; when none is active, its first failed step; otherwise
 * its first ready step (else its first step not settled).
 */
export function currentSteps<T extends Pick<WorkflowStep, 'id' | 'status' | 'after'>>(
	steps: readonly T[],
): T[] {
	const active = [
		...steps.filter((step) => step.status === 'needs_input'),
		...steps.filter((step) => step.status === 'running'),
	];
	if (active.length > 0) return active;
	const failed = steps.find((step) => step.status === 'failed');
	if (failed !== undefined) return [failed];
	const ready = readySteps(steps)[0];
	if (ready !== undefined) return [ready];
	const next = steps.find((step) => !isSettledStatus(step.status));
	return next === undefined ? [] : [next];
}

/**
 * The first current step's title, with how many other steps are active:
 * "Server + 2 more". Undefined when nothing is current.
 */
export function currentStepTitle(
	steps: readonly Pick<WorkflowStep, 'id' | 'title' | 'status' | 'after'>[],
): string | undefined {
	const current = currentSteps(steps);
	const first = current[0];
	if (first === undefined) return undefined;
	const others = isActive(first.status) ? current.length - 1 : 0;
	return others > 0 ? `${first.title} + ${others} more` : first.title;
}

/**
 * The current step in words: as `currentStepTitle`, with "needs you" after a
 * step that needs input: "Docs needs you + 2 more".
 */
export function currentStepLabel(
	steps: readonly Pick<WorkflowStep, 'id' | 'title' | 'status' | 'after'>[],
): string | undefined {
	const current = currentSteps(steps);
	const first = current[0];
	if (first === undefined) return undefined;
	const name =
		first.status === 'needs_input' ? `${first.title} needs you` : first.title;
	const others = isActive(first.status) ? current.length - 1 : 0;
	return others > 0 ? `${name} + ${others} more` : name;
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
	const active = currentSteps(steps).find((step) => isActive(step.status));
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
		const name = currentStepLabel(steps) ?? active.title;
		const time =
			active.startedAt === null ? [] : [formatDuration(now - active.startedAt)];
		parts = [name, count, ...time, ...failures];
	} else if (failures.length > 0) {
		const [first, ...rest] = failures;
		parts = [first as string, count, ...rest];
	} else {
		const next = currentSteps(steps)[0];
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
export function reservedWidth(
	layout: WorkflowPanelLayout | undefined,
	railWidth: number = WORKFLOW_RAIL_WIDTH,
): number {
	if (layout === undefined) return 0;
	return layout.mode === 'expanded' ? layout.width : railWidth;
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

/**
 * How the expanded panel shows step notes: every note in full, each cut to
 * two lines, or only the current steps' notes. Home's Workflows section
 * offers the same three.
 */
export type WorkflowPanelNotes = 'full' | 'short' | 'current';

export const WORKFLOW_PANEL_NOTES: readonly WorkflowPanelNotes[] = [
	'full',
	'short',
	'current',
];

/** A step the user is following now: running, waiting on them, or failed. */
export function isCurrentStep(status: WorkflowStepStatus): boolean {
	return status === 'running' || status === 'needs_input' || status === 'failed';
}

/** Whether a step's note is shown at this density. */
export function showsStepNote(
	step: Pick<WorkflowStep, 'note' | 'status'>,
	notes: WorkflowPanelNotes,
): boolean {
	if (step.note === '') return false;
	return notes !== 'current' || isCurrentStep(step.status);
}

/** The horizontal drawer's collapsed strip height. */
export const WORKFLOW_STRIP_HEIGHT = 46;
/** The expanded drawer's height cap. */
export const WORKFLOW_DRAWER_MAX_HEIGHT = 240;
/** The expanded drawer's header, above the map. */
export const WORKFLOW_DRAWER_HEADER_HEIGHT = 36;
/** One lane of the metro map, and the map's padding above and below. */
export const WORKFLOW_DRAWER_LANE_HEIGHT = 56;
export const WORKFLOW_DRAWER_MAP_PADDING = 8;
/** A terminal shorter than this above the expanded drawer keeps the strip. */
export const WORKFLOW_MIN_TERMINAL_ROWS = 10;

/** How tall the expanded drawer is for a map of `lanes` lanes: header plus map, capped. */
export function drawerHeight(lanes: number): number {
	return Math.min(
		WORKFLOW_DRAWER_MAX_HEIGHT,
		WORKFLOW_DRAWER_HEADER_HEIGHT +
			WORKFLOW_DRAWER_MAP_PADDING * 2 +
			Math.max(1, lanes) * WORKFLOW_DRAWER_LANE_HEIGHT,
	);
}

export interface WorkflowDrawerLayout {
	readonly mode: WorkflowPanelMode;
	/** The expanded drawer's height in this pane. */
	readonly height: number;
	/** The short-pane overlay's height: the drawer's, at most 85% of the pane. */
	readonly overlayHeight: number;
}

/**
 * How the horizontal drawer shows. It expands only when the terminal keeps at
 * least ten rows above it; otherwise the pane keeps the strip, and expanding
 * opens an overlay that does not resize the terminal.
 */
export function drawerLayout(
	setting: 'collapsed' | 'expanded',
	lanes: number,
	paneHeight: number | undefined,
	rowHeight: number | undefined,
): WorkflowDrawerLayout {
	const height = drawerHeight(lanes);
	const overlayHeight =
		paneHeight === undefined || !(paneHeight > 0)
			? height
			: Math.min(height, Math.floor(paneHeight * 0.85));
	const fits =
		paneHeight === undefined ||
		rowHeight === undefined ||
		!(rowHeight > 0) ||
		paneHeight - height >= WORKFLOW_MIN_TERMINAL_ROWS * rowHeight;
	return { mode: fits ? setting : 'forced-collapsed', height, overlayHeight };
}

/** Pixels the pane reserves at its bottom edge for the drawer. */
export function reservedHeight(layout: WorkflowDrawerLayout | undefined): number {
	if (layout === undefined) return 0;
	return layout.mode === 'expanded' ? layout.height : WORKFLOW_STRIP_HEIGHT;
}

/**
 * The expanded panel's and drawer's progress line: "5 of 11 done · 2 running ·
 * 1 needs you · 12m elapsed", leaving out counts of nothing and the time
 * before any step has started.
 */
export function progressLabel(workflow: Workflow, now: number): string {
	return progressParts(workflow, now).join(' · ');
}

/** The progress line's parts, each drawn unbroken so the line wraps only between them. */
export function progressParts(workflow: Workflow, now: number): readonly string[] {
	const running = workflow.steps.filter((step) => step.status === 'running').length;
	const needs = workflow.steps.filter((step) => step.status === 'needs_input').length;
	const since = elapsed(workflow, now);
	return [
		`${doneCount(workflow)} of ${workflow.steps.length} done`,
		...(running > 0 ? [`${running} running`] : []),
		...(needs > 0 ? [`${needs} ${needs === 1 ? 'needs' : 'need'} you`] : []),
		...(since === undefined ? [] : [`${since} elapsed`]),
	];
}

/**
 * What the collapsed strip says: every running or needs-input step in step
 * order, "Finished" once every step is settled, and "Waiting" otherwise.
 */
export function stripWords(
	steps: readonly Pick<WorkflowStep, 'title' | 'status'>[],
): readonly { readonly title: string; readonly needsYou: boolean }[] | 'Finished' | 'Waiting' {
	const active = steps.filter((step) => isActive(step.status));
	if (active.length > 0)
		return active.map((step) => ({
			title: step.title,
			needsYou: step.status === 'needs_input',
		}));
	return steps.length > 0 && steps.every((step) => isSettledStatus(step.status))
		? 'Finished'
		: 'Waiting';
}
