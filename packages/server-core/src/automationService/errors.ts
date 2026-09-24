export type AutomationErrorCode =
	| 'invalid_automation'
	/** The trigger and action cannot be combined; `details.reason` names why. */
	| 'invalid_combination'
	| 'automation_not_found'
	| 'run_not_found'
	| 'conflict'
	| 'limit'
	| 'forbidden'
	| 'unavailable';

export class AutomationServiceError extends Error {
	readonly code: AutomationErrorCode;
	readonly details: Readonly<Record<string, string | number>> | undefined;

	constructor(
		code: AutomationErrorCode,
		message: string,
		details?: Readonly<Record<string, string | number>>,
	) {
		super(message);
		this.name = 'AutomationServiceError';
		this.code = code;
		this.details = details;
	}
}
