import type { BotFailureCause, ProtocolError } from '@terminay/protocol';
import { EngineCommandError } from './process.js';
import { BotBlockedError, BotError, BotImageBuildError } from './store.js';

const engineMessages: Readonly<Record<string, string>> = {
	'not-running':
		'The container engine is not running or cannot be reached. Start Docker or Podman, then choose Check again.',
	'not-installed':
		'No container engine was found. Install Docker or Podman, then choose Check again.',
	'engine-changed':
		'The container engine identity changed. Choose Use this engine and confirm before starting bots.',
	'permission-denied':
		'Terminay cannot access the container engine. Give this account access, then choose Check again.',
	'remote-engine':
		'Bots require a local container engine. Choose a local Docker or Podman engine.',
	'unsupported-engine-mode':
		'This container engine mode is unsupported. Use rootful Docker or Podman.',
	'unsupported-platform': 'Bots are not supported on this server platform.',
	'not-found':
		'A required container resource is missing. Create or recreate the bot environment.',
};
/** The structured cause of a failure that also stops any new execution. */
export function botFailureCause(error: unknown): BotFailureCause | null {
	if (error instanceof BotBlockedError) return error.failureCause;
	if (error instanceof BotImageBuildError) return 'image';
	if (error instanceof EngineCommandError) return 'engine';
	return null;
}
/** Engine diagnostics can contain secrets or host paths: expose curated causes. */
export function botFailure(error: unknown): ProtocolError | undefined {
	if (error instanceof EngineCommandError)
		return {
			code:
				error.code === 'permission-denied'
					? 'forbidden'
					: error.code === 'conflict'
						? 'conflict'
						: 'unavailable',
			message:
				engineMessages[error.code] ??
				'The container engine operation failed. Check engine access and try again.',
			details: { reason: error.code },
			retryable: true,
		};
	if (error instanceof BotImageBuildError)
		return {
			code: 'unavailable',
			message:
				'The bot image could not be built. Open Build image to inspect the build log and retry.',
			details: { reason: 'image-build-failed' },
			retryable: true,
		};
	if (error instanceof BotError)
		return {
			code: ([
				'validation',
				'not_found',
				'forbidden',
				'conflict',
				'resource',
				'deadline',
				'unavailable',
			].includes(error.code)
				? error.code
				: 'internal') as ProtocolError['code'],
			message: error.message.slice(0, 4096),
			details: { reason: error.code },
			retryable: false,
		};
	return undefined;
}
