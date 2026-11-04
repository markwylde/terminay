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

/** A workflow is unfinished while any step is not done. */
export function isUnfinished(workflow: Workflow): boolean {
	return workflow.steps.some((step) => step.status !== 'done');
}

/**
 * The step to continue from: the active step if there is one, else the first
 * step that is not done, else null.
 */
export function resumeStepId(workflow: Workflow): string | null {
	const active = workflow.steps.find((step) => isActiveStatus(step.status));
	if (active !== undefined) return active.id;
	return workflow.steps.find((step) => step.status !== 'done')?.id ?? null;
}

/**
 * Apply one status report. Any status may move to any status; at most one
 * step is active; times follow design decision 4's table.
 */
export function applyStepUpdate(
	workflow: Workflow,
	stepId: string,
	status: WorkflowStepStatus,
	note: unknown,
	now: number,
): Workflow {
	const index = workflow.steps.findIndex((step) => step.id === stepId);
	if (index < 0)
		throw new WorkflowServiceError(
			'step_not_found',
			'that step is not in this workflow',
			{ stepId },
		);
	if (isActiveStatus(status)) {
		const active = workflow.steps.find(
			(step) => step.id !== stepId && isActiveStatus(step.status),
		);
		if (active !== undefined)
			throw new WorkflowServiceError(
				'step_active',
				`step "${active.title}" is still ${active.status}; finish it before starting another`,
				{ stepId: active.id },
			);
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
	// done or failed
	if (step.status === status) return { ...step, note: withNote };
	return {
		...step,
		status,
		note: withNote,
		startedAt: step.startedAt ?? now,
		endedAt: now,
	};
}

