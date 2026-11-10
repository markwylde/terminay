/**
 * The Bots section's view of the fleet, as pure functions.
 *
 * Bots are server-owned. What a device shows is derived here from what the
 * servers report: each bot's profile, its recent sessions, and its
 * environment. Nothing here talks to a server, so it can be tested alone.
 */

import type {
	BotEnvironmentState,
	BotProfile,
	BotSessionRecord,
	BotSessionState,
} from '@terminay/protocol';

/** What a bot is doing, as its card and tab show it. */
export type BotActivity =
	| 'working'
	| 'needs-you'
	| 'queued'
	| 'idle'
	| 'stopped';

/** The dashboard's filters. */
export type BotFilter = 'all' | 'working' | 'needs-you' | 'stopped';
export const BOT_FILTERS: readonly BotFilter[] = [
	'all',
	'working',
	'needs-you',
	'stopped',
];

export const BOT_ACTIVITY_LABELS: Readonly<Record<BotActivity, string>> = {
	idle: 'Idle',
	'needs-you': 'Needs you',
	queued: 'Queued',
	stopped: 'Stopped',
	working: 'Working',
};

export const BOT_FILTER_LABELS: Readonly<Record<BotFilter, string>> = {
	all: 'All bots',
	'needs-you': 'Needs you',
	stopped: 'Stopped',
	working: 'Working',
};

/** The environment states a card distinguishes. */
export type BotEnvironmentSummary = BotEnvironmentState | 'unknown';

export const ENVIRONMENT_LABELS: Readonly<
	Record<BotEnvironmentSummary, string>
> = {
	'not-created': 'Not created',
	building: 'Building image',
	starting: 'Starting',
	running: 'Running',
	stopping: 'Stopping',
	stopped: 'Stopped',
	failed: 'Failed',
	unknown: 'Unknown',
};

export type BotEntry = Readonly<{
	serverId: string;
	serverLabel: string;
	bot: BotProfile;
	/** Newest first. */
	sessions: readonly BotSessionRecord[];
	environment: BotEnvironmentSummary;
	/** The agent's display name, once the server's agent list has loaded. */
	agentName?: string;
	/** The next trigger firing, once triggers are known. */
	nextTrigger?: Readonly<{ name: string; at: number }>;
}>;

const LIVE_STATES: ReadonlySet<BotSessionState> = new Set(['running']);

/**
 * A bot's activity. A session waiting on the user outranks one that runs,
 * which outranks one queued; with none of those, a bot whose container is
 * down is stopped, and otherwise idle.
 */
export function botActivity(
	sessions: readonly BotSessionRecord[],
	environment: BotEnvironmentSummary,
): BotActivity {
	if (sessions.some((s) => s.state === 'needs-you' || s.permission !== null))
		return 'needs-you';
	if (sessions.some((s) => LIVE_STATES.has(s.state))) return 'working';
	if (
		sessions.some(
			(s) => s.state === 'queued' || s.queuedMessage?.status === 'queued',
		)
	)
		return 'queued';
	if (
		environment === 'stopped' ||
		environment === 'not-created' ||
		environment === 'failed'
	)
		return 'stopped';
	return 'idle';
}

export function matchesFilter(
	activity: BotActivity,
	filter: BotFilter,
): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'working':
			return activity === 'working' || activity === 'queued';
		case 'needs-you':
			return activity === 'needs-you';
		case 'stopped':
			return activity === 'stopped';
	}
}

/** Case-insensitive search over what a card shows. */
export function matchesSearch(entry: BotEntry, search: string): boolean {
	const needle = search.trim().toLowerCase();
	if (needle.length === 0) return true;
	const { bot } = entry;
	return [
		bot.name,
		bot.description,
		entry.agentName ?? bot.agentId,
		bot.modelId ?? '',
		entry.serverLabel,
	].some((text) => text.toLowerCase().includes(needle));
}

/** The bots a filter and search leave, in a stable order: by name, then id. */
export function visibleBots(
	entries: readonly BotEntry[],
	filter: BotFilter,
	search: string,
): BotEntry[] {
	return entries
		.filter(
			(entry) =>
				matchesFilter(botActivity(entry.sessions, entry.environment), filter) &&
				matchesSearch(entry, search),
		)
		.sort(
			(a, b) =>
				a.bot.name.localeCompare(b.bot.name) ||
				a.serverId.localeCompare(b.serverId) ||
				a.bot.id.localeCompare(b.bot.id),
		);
}

export function filterCounts(
	entries: readonly BotEntry[],
): Readonly<Record<BotFilter, number>> {
	const counts: Record<BotFilter, number> = {
		all: 0,
		'needs-you': 0,
		stopped: 0,
		working: 0,
	};
	for (const entry of entries) {
		const activity = botActivity(entry.sessions, entry.environment);
		for (const filter of BOT_FILTERS)
			if (matchesFilter(activity, filter)) counts[filter] += 1;
	}
	return counts;
}

export type NeedsYouEntry = Readonly<{
	serverId: string;
	botId: string;
	botName: string;
	sessionId: string;
	/** What the bot is waiting for, in a line. */
	summary: string;
	since: number;
}>;

function toolTitle(toolCall: unknown): string | undefined {
	if (typeof toolCall !== 'object' || toolCall === null) return undefined;
	const title = (toolCall as Record<string, unknown>).title;
	return typeof title === 'string' && title.length > 0 ? title : undefined;
}

/** Every session, from any bot, that waits on the user; oldest first. */
export function needsYou(entries: readonly BotEntry[]): NeedsYouEntry[] {
	const result: NeedsYouEntry[] = [];
	for (const entry of entries) {
		for (const session of entry.sessions) {
			if (session.state !== 'needs-you' && session.permission === null)
				continue;
			const tool = toolTitle(session.permission?.toolCall);
			result.push({
				serverId: entry.serverId,
				botId: entry.bot.id,
				botName: entry.bot.name,
				sessionId: session.id,
				summary:
					tool === undefined
						? 'Waiting for your decision'
						: `Wants to run: ${tool}`,
				since: session.startedAt,
			});
		}
	}
	return result.sort((a, b) => a.since - b.since);
}

/** Investigate failures is on unless the profile turns it off. */
export function investigatesFailures(bot: Pick<BotProfile, 'investigateFailures'>): boolean {
	return bot.investigateFailures !== false;
}

/** Terminay MCP access is off unless the profile turns it on (ADR-0100). */
export function hasTerminayMcpAccess(bot: Pick<BotProfile, 'terminayMcpAccess'>): boolean {
	return bot.terminayMcpAccess === true;
}

/** How many failures a failure investigation covers, listed or only counted. */
function failureCount(origin: BotSessionRecord['origin']): number {
	return origin.kind === 'failure'
		? origin.failures.length + origin.overflow
		: 0;
}

/** A session's title: its trigger's name, a failure investigation, or the chat's first words. */
export function sessionTitle(session: BotSessionRecord): string {
	if (session.origin.kind === 'failure') {
		const n = failureCount(session.origin);
		return n > 1 ? `Investigate failure (${n} failures)` : 'Investigate failure';
	}
	if (session.origin.kind !== 'chat') return session.origin.triggerName;
	const text = session.queuedMessage?.text?.trim();
	if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
	return 'Chat';
}

export type SessionOrigin = BotSessionRecord['origin']['kind'];
export type SessionOriginFilter = 'all' | SessionOrigin;
/** The Sessions origin filter, in menu order. */
export const SESSION_ORIGIN_FILTER_LABELS: Readonly<
	Record<SessionOriginFilter, string>
> = {
	all: 'Any origin',
	chat: 'Chat',
	trigger: 'Trigger',
	'run-now': 'Run now',
	failure: 'Failure',
};
/** The short chip on a session row. */
export const SESSION_ORIGIN_CHIPS: Readonly<Record<SessionOrigin, string>> = {
	chat: 'Message',
	'run-now': 'Manual',
	trigger: 'Trigger',
	failure: 'Investigate',
};
/** What started a session, as its detail view says it. */
export function sessionOriginLabel(origin: BotSessionRecord['origin']): string {
	switch (origin.kind) {
		case 'chat':
			return 'Chat';
		case 'failure':
			return 'Investigate failure';
		case 'run-now':
			return `Run now · ${origin.triggerName}`;
		case 'trigger':
			return `Trigger · ${origin.triggerName}`;
	}
}
export const FAILURE_KIND_LABELS: Readonly<
	Record<'execution' | 'firing' | 'condition', string>
> = {
	execution: 'Execution failed',
	firing: 'Firing could not start',
	condition: 'Condition check failed',
};

export const SESSION_STATE_LABELS: Readonly<Record<BotSessionState, string>> = {
	completed: 'Completed',
	failed: 'Failed',
	interrupted: 'Interrupted',
	'needs-you': 'Needs you',
	queued: 'Queued',
	running: 'Running',
	stopped: 'Stopped',
	suspended: 'Suspended',
	'timed-out': 'Timed out',
};

/** Up to two initials for an avatar with no picture. */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.map((word) => [...word][0] ?? '').join('');
	return (letters || '?').slice(0, 2).toUpperCase();
}

/** "4m", "2h", "3d": how long ago, short enough for a card. */
export function shortAge(from: number, now: number): string {
	const seconds = Math.max(0, Math.round((now - from) / 1000));
	if (seconds < 60) return 'now';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

/** What the composer accepts; the server checks the same limits again. */
export const BOT_CHAT_IMAGE_TYPES = [
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
] as const;
export const BOT_CHAT_IMAGE_BYTES = 2 * 1024 * 1024;
export const BOT_CHAT_IMAGES_PER_MESSAGE = 4;

/**
 * Which offered files join the pending images. Valid images are taken up to
 * the per-message limit; the first refusal is reported, and images already
 * pending are never touched.
 */
export function acceptChatImages<F extends { type: string; size: number }>(
	pending: number,
	files: readonly F[],
): { accepted: F[]; refusal?: string } {
	const accepted: F[] = [];
	let refusal: string | undefined;
	for (const file of files) {
		if (!(BOT_CHAT_IMAGE_TYPES as readonly string[]).includes(file.type))
			refusal ??= 'Only PNG, JPEG, GIF and WebP images can be attached.';
		else if (file.size > BOT_CHAT_IMAGE_BYTES)
			refusal ??= 'Images must be 2 MiB or smaller.';
		else if (pending + accepted.length >= BOT_CHAT_IMAGES_PER_MESSAGE)
			refusal ??= `A message can carry at most ${BOT_CHAT_IMAGES_PER_MESSAGE} images.`;
		else accepted.push(file);
	}
	return refusal ? { accepted, refusal } : { accepted };
}

/** A send attempt's idempotency key. A retry of the same content reuses it, so
 * a post whose response was lost is replayed rather than duplicated. */
export interface ChatSendAttempt {
	readonly signature: string;
	readonly key: string;
}
export function chatSendAttempt(
	previous: ChatSendAttempt | undefined,
	signature: string,
	fresh: () => string,
): ChatSendAttempt {
	return previous?.signature === signature
		? previous
		: { signature, key: fresh() };
}

export type RecoveryNotice = Readonly<{
	kind: 'not-created' | 'failed' | 'outdated';
	tone: 'warn' | 'error';
	title: string;
	detail: string;
	/** The label of the create action, when creating is the way forward. */
	create?: string;
	recreate?: boolean;
}>;

/** What an environment that needs the user says, and the actions it offers. */
export function recoveryNotice(
	name: string,
	state: BotEnvironmentSummary | undefined,
	imageOutdated: boolean,
): RecoveryNotice | undefined {
	if (state === 'failed')
		return {
			kind: 'failed',
			tone: 'error',
			title: `${name}’s environment failed to start`,
			detail:
				'Try again, or recreate the container from the current image. The bot home is kept either way.',
			create: 'Try again',
			recreate: true,
		};
	if (state === 'not-created')
		return {
			kind: 'not-created',
			tone: 'warn',
			title: `${name}’s environment is not created`,
			detail:
				'Sessions create it when they start. Create it now to use the shell and desktop.',
			create: 'Create environment',
		};
	if (imageOutdated)
		return {
			kind: 'outdated',
			tone: 'warn',
			title: `${name}’s container uses an older image`,
			detail: 'Recreate it to pick up the current image. The bot home is kept.',
			recreate: true,
		};
	return undefined;
}
