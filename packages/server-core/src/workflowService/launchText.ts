import {
	composeWorkflowGoal,
	WORKFLOW_LAUNCH_INSTRUCTION,
	WORKFLOW_RESUME_INSTRUCTION,
} from '@terminay/protocol';
import { WorkflowServiceError } from './errors.js';
import { WORKFLOW_LIMITS } from './types.js';

/**
 * The only text a workflow ever causes Terminay to type (ADR-0097), built
 * here, server-side, from fixed words; a client names a template or a
 * terminal, never the text.
 */

function compose(openingPrompt: string, instruction: string): string {
	const text = composeWorkflowGoal(openingPrompt, instruction);
	const bytes = Buffer.byteLength(text, 'utf8');
	if (bytes > WORKFLOW_LIMITS.maxLaunchTextBytes)
		throw new WorkflowServiceError(
			'invalid_workflow',
			`the text to type is ${bytes} bytes; the limit is ${WORKFLOW_LIMITS.maxLaunchTextBytes}`,
			{ field: 'launchText', size: bytes, limit: WORKFLOW_LIMITS.maxLaunchTextBytes },
		);
	return text;
}

export { WORKFLOW_LAUNCH_INSTRUCTION, WORKFLOW_RESUME_INSTRUCTION };

export function workflowLaunchText(openingPrompt: string): string {
	return compose(openingPrompt, WORKFLOW_LAUNCH_INSTRUCTION);
}

export function workflowResumeText(openingPrompt: string): string {
	return compose(openingPrompt, WORKFLOW_RESUME_INSTRUCTION);
}
