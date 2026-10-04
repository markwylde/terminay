/**
 * Telling apart the two ways the server refuses a request made for a view.
 *
 * "This client does not control the terminal" can be a lapsed lease, which the
 * client renews before trying once more. Every other refusal, a permission the
 * user declined or a policy set to Never Allow, is an answer: asking again
 * would prompt the user a second time for something they just refused.
 */

const NOT_CONTROLLER = 'not-controller';

type ErrorLike = { readonly code?: unknown; readonly details?: unknown; readonly cause?: unknown };

/** Whether an error, or what caused it, is the server saying this client is not the controller. */
export function isNotControllerError(error: unknown): boolean {
	let current: unknown = error;
	// An operation error wraps the client error that carries the server's reason.
	for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
		const { code, details, cause } = current as ErrorLike;
		if (
			code === 'forbidden' &&
			typeof details === 'object' &&
			details !== null &&
			(details as { reason?: unknown }).reason === NOT_CONTROLLER
		)
			return true;
		current = cause;
	}
	return false;
}
