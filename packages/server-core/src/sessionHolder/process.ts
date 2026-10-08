import type { NodePtyModuleLike } from '../terminalService/nodePty.js';
import { SessionHolder } from './holder.js';
import { isSessionHolderGeneration } from './paths.js';

/**
 * Environment a server passes to the holder process it starts. Everything a
 * holder needs arrives here, so it reads nothing else from its installation
 * after start-up (ADR-0035).
 */
export const SESSION_HOLDER_ENV = Object.freeze({
	dataRoot: 'TERMINAY_SESSION_HOLDER_DATA_ROOT',
	generation: 'TERMINAY_SESSION_HOLDER_GENERATION',
	buildId: 'TERMINAY_SESSION_HOLDER_BUILD_ID',
	limitMs: 'TERMINAY_SESSION_HOLDER_LIMIT_MS',
});

/**
 * Run this process as a session holder until it has nothing left to hold.
 * The host entry point supplies its own `node-pty`, loaded eagerly.
 */
export async function runSessionHolderProcess(
	nodePty: NodePtyModuleLike,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const dataRoot = env[SESSION_HOLDER_ENV.dataRoot];
	const generation = env[SESSION_HOLDER_ENV.generation];
	const buildId = env[SESSION_HOLDER_ENV.buildId];
	if (
		typeof dataRoot !== 'string' ||
		dataRoot.length === 0 ||
		typeof generation !== 'string' ||
		!isSessionHolderGeneration(generation) ||
		typeof buildId !== 'string' ||
		buildId.length === 0
	)
		throw new Error('session holder environment is incomplete');
	process.umask(0o077);
	// The launch variables describe this holder, not the shells it starts.
	for (const name of Object.values(SESSION_HOLDER_ENV)) delete process.env[name];
	const holder = await SessionHolder.start({
		dataRoot,
		generation,
		buildId,
		nodePty,
		limitMs: parseLimit(env[SESSION_HOLDER_ENV.limitMs]),
		onClosed: () => process.exit(0),
	});
	// Logout and shutdown arrive as SIGTERM: save tails, then end sessions.
	for (const signal of ['SIGTERM', 'SIGINT'] as const)
		process.on(signal, () => void holder.close('signal', { signal }));
	// Observed, not handled: the process still dies of the error.
	process.on('uncaughtExceptionMonitor', (error) => holder.recordCrash(error));
	// A holder has no terminal of its own to hang up on.
	process.on('SIGHUP', () => undefined);
}

function parseLimit(value: string | undefined): number | null {
	if (value === undefined || value === '' || value === 'none') return null;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new Error('session holder limit is invalid');
	return parsed;
}
