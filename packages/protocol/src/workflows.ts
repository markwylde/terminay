/**
 * The only text a workflow ever causes Terminay to type (ADR-0097): the fixed
 * instruction after an opening prompt. The server builds the text from these;
 * a client shows the same words in its preview and never sends them.
 */

export const WORKFLOW_LAUNCH_INSTRUCTION = [
	'Work through the Terminay workflow attached to this terminal.',
	'Call the Terminay MCP tool get_workflow to read it, then take the steps in order.',
	'Before starting a step, call update_workflow_step to set it to running, then follow its prompt.',
	'When a step is finished, set it to done with a one-line note of the outcome, or to failed with the reason.',
	'If a step needs me to decide or do something, set it to needs_input with a one-line question and wait for me.',
	'Continue until every step is done.',
].join(' ');

export const WORKFLOW_RESUME_INSTRUCTION = [
	'Resume the Terminay workflow attached to this terminal.',
	'Call the Terminay MCP tool get_workflow and treat it as the source of truth for what is done.',
	'Continue from its resume point (resumeStepId), then every later step that is not done, in order.',
	'Before starting a step, call update_workflow_step to set it to running; when it is finished, set it to done with a one-line note, or to failed with the reason.',
	'If a step needs me, set it to needs_input with a one-line question and wait for me.',
].join(' ');

/** `/goal`, the opening prompt if there is one, and an instruction. */
export function composeWorkflowGoal(openingPrompt: string, instruction: string): string {
	const opening = openingPrompt.trim();
	return opening === '' ? `/goal ${instruction}` : `/goal ${opening}\n\n${instruction}`;
}
