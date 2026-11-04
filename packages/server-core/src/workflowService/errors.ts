export type WorkflowErrorCode =
	| 'invalid_workflow'
	| 'template_not_found'
	| 'workflow_exists'
	| 'no_workflow'
	| 'step_not_found'
	| 'step_active'
	| 'unauthorized_target'
	| 'write_failed';

export class WorkflowServiceError extends Error {
	readonly code: WorkflowErrorCode;
	readonly details: Readonly<Record<string, unknown>> | undefined;

	constructor(
		code: WorkflowErrorCode,
		message: string,
		details?: Readonly<Record<string, unknown>>,
	) {
		super(message);
		this.name = 'WorkflowServiceError';
		this.code = code;
		this.details = details;
	}
}

export function isWorkflowServiceError(
	value: unknown,
): value is WorkflowServiceError {
	return value instanceof WorkflowServiceError;
}
