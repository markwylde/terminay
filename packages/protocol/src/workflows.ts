/**
 * The only text a workflow ever causes Terminay to type (ADR-0097): the fixed
 * instruction after an opening prompt. The server builds the text from these;
 * a client shows the same words in its preview and never sends them.
 */

export const WORKFLOW_LAUNCH_INSTRUCTION = [
	'Work through the Terminay workflow attached to this terminal.',
	'Call the Terminay MCP tool get_workflow to read it.',
	'Start a step only once every step in its after list is done or skipped; get_workflow lists the steps that are ready in ready_step_ids, and steps that are ready at the same time may be worked at the same time.',
	'Before starting a step, call update_workflow_step to set it to running, then follow its prompt.',
	'When a step is finished, set it to done with a one-line note of the outcome, or to failed with the reason.',
	'If a step needs me to decide or do something, set it to needs_input with a one-line question and wait for me.',
	'If you are told to drop a step, or it does not apply, set it to skipped with a one-line reason instead of doing it.',
	'Continue until every step is done or skipped.',
].join(' ');

export const WORKFLOW_RESUME_INSTRUCTION = [
	'Resume the Terminay workflow attached to this terminal.',
	'Call the Terminay MCP tool get_workflow and treat it as the source of truth for what is done.',
	'Continue from its resume point (resume_step_id) and every other step that is running or needs_input, then every other step that is not done or skipped as its after list allows: start a step only once every step in its after list is done or skipped, and work steps that are ready at the same time (ready_step_ids) at the same time when you can.',
	'Before starting a step, call update_workflow_step to set it to running; when it is finished, set it to done with a one-line note, or to failed with the reason.',
	'If a step needs me, set it to needs_input with a one-line question and wait for me.',
	'If you are told to drop a step, or it does not apply, set it to skipped with a one-line reason.',
].join(' ');

/** `/goal`, the opening prompt if there is one, and an instruction. */
export function composeWorkflowGoal(openingPrompt: string, instruction: string): string {
	const opening = openingPrompt.trim();
	return opening === '' ? `/goal ${instruction}` : `/goal ${opening}\n\n${instruction}`;
}

/**
 * The launch or resume text as Terminay types it: {@link composeWorkflowGoal}
 * on one line. Typed text has no bracketed paste to hold lines together, and a
 * typed line break or tab is a key press (a shell runs or completes on it), so
 * each one, with the whitespace around it, becomes a single space.
 */
export function typedWorkflowGoal(openingPrompt: string, instruction: string): string {
	return flattenTypedText(composeWorkflowGoal(openingPrompt, instruction));
}

/** `text` on one line: each run of whitespace holding a line break or tab becomes one space. */
export function flattenTypedText(text: string): string {
	return text.replace(/\s*[\r\n\t]\s*/g, ' ').trim();
}
