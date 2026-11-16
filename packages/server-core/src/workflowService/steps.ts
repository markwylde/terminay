import { WorkflowServiceError } from './errors.js';
import { validateNote } from './normalize.js';
import type { Workflow, WorkflowStep, WorkflowStepStatus } from './types.js';

const ACTIVE: ReadonlySet<WorkflowStepStatus> = new Set([
	'running',
	'needs_input',
]);

export function isActiveStatus(status: WorkflowStepStatus): boolean {
	return ACTIVE.has(status);
}

const SETTLED: ReadonlySet<WorkflowStepStatus> = new Set(['done', 'skipped']);

/** A step is settled when it is done or deliberately skipped. */
export function isSettled(status: WorkflowStepStatus): boolean {
	return SETTLED.has(status);
}

/** A workflow is unfinished while any step is not settled. */
export function isUnfinished(workflow: Workflow): boolean {
	return workflow.steps.some((step) => !isSettled(step.status));
}

/** Ids of `step`'s dependencies that are not settled, in step order. */
export function unsettledDependencies(
	workflow: Workflow,
	step: WorkflowStep,
): readonly string[] {
	if (step.after.length === 0) return [];
	const waits = new Set(step.after);
	return workflow.steps
		.filter((other) => waits.has(other.id) && !isSettled(other.status))
		.map((other) => other.id);
}

/**
 * Ready steps (ADR-0128): not started or failed, with every dependency
 * settled, in step order.
 */
export function readyStepIds(workflow: Workflow): readonly string[] {
	return workflow.steps
		.filter(
			(step) =>
				(step.status === 'not_started' || step.status === 'failed') &&
				unsettledDependencies(workflow, step).length === 0,
		)
		.map((step) => step.id);
}

/**
 * The step to continue from: the first active step, else the first ready
 * step, else the first step that is not settled, else null.
 */
export function resumeStepId(workflow: Workflow): string | null {
	const active = workflow.steps.find((step) => isActiveStatus(step.status));
	if (active !== undefined) return active.id;
	const ready = readyStepIds(workflow)[0];
	if (ready !== undefined) return ready;
	return workflow.steps.find((step) => !isSettled(step.status))?.id ?? null;
}

/**
 * Whether moving `from` to `to` starts the step: into an active status from
 * one that is not, or straight to done from not started. Only starting is
 * held to the step's dependencies, so a step already under way can always
 * report and finish.
 */
export function startsStep(
	from: WorkflowStepStatus,
	to: WorkflowStepStatus,
): boolean {
	if (isActiveStatus(to)) return !isActiveStatus(from);
	return to === 'done' && from === 'not_started';
}

/**
 * Apply one status report. Any status may move to any status, except that a
 * step may not start before its dependencies are settled (ADR-0128); any
 * number of steps may be active. Times follow design decision 4's table.
 */
export function applyStepUpdate(
	workflow: Workflow,
	stepId: string,
	status: WorkflowStepStatus,
	note: unknown,
	now: number,
	expectedStatus?: WorkflowStepStatus,
): Workflow {
	const index = workflow.steps.findIndex((step) => step.id === stepId);
	if (index < 0)
		throw new WorkflowServiceError(
			'step_not_found',
			'that step is not in this workflow',
			{ stepId },
		);
	const current = workflow.steps[index] as WorkflowStep;
	if (expectedStatus !== undefined && current.status !== expectedStatus)
		throw new WorkflowServiceError(
			'step_changed',
			`step "${current.title}" is now ${current.status}`,
			{ stepId, status: current.status },
		);
	if (startsStep(current.status, status)) {
		const waiting = unsettledDependencies(workflow, current);
		if (waiting.length > 0) {
			const titles = workflow.steps
				.filter((step) => waiting.includes(step.id))
				.map((step) => `"${step.title}"`)
				.join(', ');
			throw new WorkflowServiceError(
				'step_blocked',
				`step "${current.title}" waits on ${titles}; finish or skip ${waiting.length === 1 ? 'it' : 'them'} first`,
				{ stepIds: waiting },
			);
		}
	}
	const validatedNote = note === undefined ? undefined : validateNote(note);
	const step = workflow.steps[index] as WorkflowStep;
	const next = nextStep(step, status, validatedNote, now);
	const steps = workflow.steps.slice();
	steps[index] = next;
	return { ...workflow, steps };
}

function nextStep(
	step: WorkflowStep,
	status: WorkflowStepStatus,
	note: string | undefined,
	now: number,
): WorkflowStep {
	if (status === 'not_started')
		return { ...step, status, note: '', startedAt: null, endedAt: null };
	const withNote = note === undefined ? step.note : note;
	if (ACTIVE.has(status)) {
		if (ACTIVE.has(step.status))
			return { ...step, status, note: withNote };
		// From not started, or a retry of a finished step.
		return { ...step, status, note: withNote, startedAt: now, endedAt: null };
	}
	// done, failed or skipped
	if (step.status === status) return { ...step, note: withNote };
	return {
		...step,
		status,
		note: withNote,
		startedAt: step.startedAt ?? now,
		endedAt: now,
	};
}

