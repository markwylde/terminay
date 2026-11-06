import type { BotFailureCause } from '@terminay/protocol';
import type { EngineDriver } from './engine.js';

/** Process exhaustion is claimed only within this many processes of the limit. */
export const BOT_PROCESS_LIMIT_MARGIN = 16;
const EAGAIN = [
	/\bspawn\b[^\n]*\bEAGAIN\b/,
	/\bfork: Resource temporarily unavailable\b/,
	/\bpthread_create: Resource temporarily unavailable\b/,
	/\bexec\b[^\n]*\bEAGAIN\b/i,
	/\bOCI runtime exec failed\b[^\n]*resource temporarily unavailable/i,
];

/** True when text shows an EAGAIN failure to create a process or thread. */
export function showsProcessCreationFailure(text: string): boolean {
	return EAGAIN.some((pattern) => pattern.test(text));
}

export interface BotProcessCount {
	readonly current: number;
	readonly limit: number;
}

/** The container's process count and limit, from the engine; null when unknown. */
export async function botProcessCount(
	driver: Pick<EngineDriver, 'run'>,
	container: string,
): Promise<BotProcessCount | null> {
	try {
		const raw = await driver.run(
			['stats', '--no-stream', '--format', 'json', container],
			{ deadlineMs: 10_000 },
		);
		const parsed = JSON.parse(raw) as
			| Record<string, unknown>
			| Record<string, unknown>[];
		const usage = Array.isArray(parsed) ? parsed[0] : parsed;
		const current = Number(usage?.PIDs ?? usage?.pids);
		const limit = Number(usage?.PidsLimit ?? usage?.pids_limit);
		return Number.isSafeInteger(current) &&
			Number.isSafeInteger(limit) &&
			limit > 0 &&
			current >= 0
			? { current, limit }
			: null;
	} catch {
		return null;
	}
}

export interface BotProcessFailure {
	readonly reason: string;
	readonly cause: BotFailureCause | null;
}

/**
 * Classify a failure from its diagnostic text. The text match alone never sets
 * a cause: only engine evidence at the limit does (bot-container-engine).
 */
export async function classifyProcessFailure(
	text: string,
	count: () => Promise<BotProcessCount | null>,
): Promise<BotProcessFailure | null> {
	if (!showsProcessCreationFailure(text)) return null;
	const pids = await count();
	if (pids && pids.current >= pids.limit - BOT_PROCESS_LIMIT_MARGIN)
		return {
			reason: `The bot container has run out of processes (${pids.current} of ${pids.limit}). Restart the bot container.`,
			cause: 'processes',
		};
	return {
		reason: 'The agent could not start a process (EAGAIN).',
		cause: null,
	};
}
