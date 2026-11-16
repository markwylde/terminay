/**
 * A server's own upgrade, as its clients see it (ADR-0062).
 *
 * The server decides what is installed. A client reads the status the server
 * publishes and may ask for an upgrade to begin; the request names the mode
 * and, to install the channel's latest release even when it is older, the one
 * boolean `allowOlder` (ADR-0117). No version, reference, URL, path, or other
 * flag can travel in it.
 */

/** Hello capability advertised by a server that publishes its upgrade status. */
export const SERVER_UPGRADE_CAPABILITY = 'server.upgrade' as const;

/** Stable protocol names for the server upgrade surface. */
export const SERVER_UPGRADE_OPERATIONS = Object.freeze({
	status: 'server.upgrade.status',
	start: 'server.upgrade.start',
	/** Read the server's release channel now, not at the next hourly check. */
	check: 'server.upgrade.check',
	event: 'server.upgrade',
	/** The last upgrade attempt, pending or ended (ADR-0125). Both the query
	 * and the event carry `{ attempt }`. */
	attempt: 'server.upgrade.attempt',
	attemptEvent: 'server.upgrade.attempt.changed',
} as const);

export const SERVER_UPGRADE_MODES = ['in-place', 'recreate'] as const;
export type ServerUpgradeMode = (typeof SERVER_UPGRADE_MODES)[number];

// `main` is the rolling Nightly and `canary` the rolling Canary (ADR-0110).
export const SERVER_UPGRADE_CHANNELS = ['tag', 'main', 'canary', 'source'] as const;
export type ServerUpgradeChannel = (typeof SERVER_UPGRADE_CHANNELS)[number];

/** Why a `server.upgrade.start` was refused, in the error's `details.reason`. */
export const SERVER_UPGRADE_REFUSALS = [
	'none-available',
	'cannot-upgrade',
	'mode-not-offered',
	'in-progress',
	'trigger-failed',
	/** `allowOlder` asked for the release that is already running. */
	'already-latest',
	/** `allowOlder` asked for a release this server cannot install itself. */
	'cannot-install-latest',
	/** A `server.upgrade.check` on a server that has no upgrader to ask. */
	'cannot-check',
	/** A `server.upgrade.check` that could not read the release channel. */
	'check-failed',
] as const;
export type ServerUpgradeRefusal = (typeof SERVER_UPGRADE_REFUSALS)[number];

export const SERVER_UPGRADE_MAX_VERSION_CHARS = 128;
export const SERVER_UPGRADE_MAX_TEXT_CHARS = 1024;

/** The state of an upgrade of this server: none, one running, or how the
 * last one ended. Times are milliseconds since the epoch. */
export type ServerUpgradeProgress =
	| { readonly state: 'none' }
	| {
			readonly state: 'in-progress';
			readonly mode: ServerUpgradeMode;
			readonly startedAt: number;
	  }
	| {
			readonly state: 'succeeded';
			readonly from: string;
			readonly to: string;
			readonly at: number;
	  }
	| {
			readonly state: 'failed';
			readonly from: string;
			readonly to: string;
			readonly reason?: string;
			/** The previous version is the one running again. */
			readonly restored: true;
			readonly at: number;
	  };

export const SERVER_UPGRADE_LATEST_ORDERS = ['newer', 'same', 'older'] as const;
export type ServerUpgradeLatestOrder =
	(typeof SERVER_UPGRADE_LATEST_ORDERS)[number];

/** The newest release on the server's channel, whichever way it orders. */
export interface ServerUpgradeLatest {
	readonly version: string;
	readonly order: ServerUpgradeLatestOrder;
	/** Whether a request with `allowOlder` would install it, in place. */
	readonly canInstall: boolean;
	/** Why it cannot be installed from here, and what to run on the host. */
	readonly unavailable?: { readonly reason: string; readonly command: string };
}

export interface ServerUpgradeStatus {
	/** The release this server is running. */
	readonly version: string;
	/** The channel it follows. Absent on a server that has no upgrader to
	 * say: the embedded Local server, or one run from a checkout. */
	readonly channel?: ServerUpgradeChannel;
	/** Present when the channel carries a newer release. */
	readonly available?: { readonly version: string };
	/** Whether the server can carry out the upgrade itself. */
	readonly canUpgrade: boolean;
	/** The modes a `server.upgrade.start` may name. */
	readonly modes: readonly ServerUpgradeMode[];
	/** Present when `recreate` is offered: it ends every terminal. */
	readonly recreateEndsTerminals?: true;
	/** Why the server cannot upgrade itself, and what an operator runs on the
	 * host instead. */
	readonly unavailable?: { readonly reason: string; readonly command: string };
	/** The channel's latest release, newer or not (ADR-0117). Absent before a
	 * check has read it, and on a source install. */
	readonly latest?: ServerUpgradeLatest;
	readonly upgrade: ServerUpgradeProgress;
}

export interface ServerUpgradeStartRequest {
	readonly mode: ServerUpgradeMode;
	/** Install the channel's latest release even when it is older. Only ever
	 * `true` when present. */
	readonly allowOlder?: true;
	/** Chosen by the requesting device so it can find its attempt even when
	 * the reply is lost to the restart. Sent only to a server that advertises
	 * `server.upgrade.attempts`. */
	readonly requestId?: string;
}

export const SERVER_UPGRADE_MAX_ID_CHARS = 64;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export const SERVER_UPGRADE_ATTEMPT_STAGES = [
	'requested',
	'installing',
	'finishing',
] as const;
export type ServerUpgradeAttemptStage =
	(typeof SERVER_UPGRADE_ATTEMPT_STAGES)[number];

export const SERVER_UPGRADE_ENDING_KINDS = [
	'succeeded',
	'rolled-back',
	'unchanged',
	'failed',
] as const;
export type ServerUpgradeEndingKind =
	(typeof SERVER_UPGRADE_ENDING_KINDS)[number];

export const SERVER_UPGRADE_ATTEMPT_KINDS = ['upgrade', 'install-latest'] as const;
export type ServerUpgradeAttemptKind =
	(typeof SERVER_UPGRADE_ATTEMPT_KINDS)[number];

/** How an attempt ended. Versions are for people; `failed` means the running
 * release was not changed, `rolled-back` that it was restored. */
export interface ServerUpgradeEnding {
	readonly kind: ServerUpgradeEndingKind;
	readonly from: string;
	readonly to: string;
	readonly reason?: string;
	readonly at: number;
}

/** One upgrade attempt as the server owns it (ADR-0125). Pending while it has
 * a `stage`; ended once it has an `ending`. */
export interface ServerUpgradeAttempt {
	readonly id: string;
	readonly requestId?: string;
	readonly mode: ServerUpgradeMode;
	readonly kind: ServerUpgradeAttemptKind;
	readonly startedAt: number;
	readonly expiresAt: number;
	readonly stage?: ServerUpgradeAttemptStage;
	readonly ending?: ServerUpgradeEnding;
}

export interface ServerUpgradeAttemptState {
	readonly attempt: ServerUpgradeAttempt | null;
}

/** Validate the attempt state exactly as a server publishes it. */
export function parseServerUpgradeAttemptState(
	value: unknown,
): ServerUpgradeAttemptState {
	const record = strictRecord(value, 'server upgrade attempt state', [
		'attempt',
	]);
	if (record.attempt === null) return Object.freeze({ attempt: null });
	return Object.freeze({ attempt: parseServerUpgradeAttempt(record.attempt) });
}

export function parseServerUpgradeAttempt(value: unknown): ServerUpgradeAttempt {
	const record = strictRecord(value, 'server upgrade attempt', [
		'id',
		'requestId',
		'mode',
		'kind',
		'startedAt',
		'expiresAt',
		'stage',
		'ending',
	]);
	if (!isServerUpgradeMode(record.mode))
		throw new TypeError('server upgrade mode is invalid');
	if (
		!(SERVER_UPGRADE_ATTEMPT_KINDS as readonly unknown[]).includes(record.kind)
	)
		throw new TypeError('server upgrade attempt kind is invalid');
	const startedAt = time(record.startedAt, 'startedAt');
	const expiresAt = time(record.expiresAt, 'expiresAt');
	if (expiresAt < startedAt)
		throw new TypeError('server upgrade expiresAt is invalid');
	if (record.stage !== undefined && record.ending !== undefined)
		throw new TypeError('server upgrade attempt is both pending and ended');
	if (record.stage === undefined && record.ending === undefined)
		throw new TypeError('server upgrade attempt is neither pending nor ended');
	if (
		record.stage !== undefined &&
		!(SERVER_UPGRADE_ATTEMPT_STAGES as readonly unknown[]).includes(
			record.stage,
		)
	)
		throw new TypeError('server upgrade attempt stage is invalid');
	return Object.freeze({
		id: identifier(record.id, 'attempt id'),
		...(record.requestId === undefined
			? {}
			: { requestId: identifier(record.requestId, 'request id') }),
		mode: record.mode,
		kind: record.kind as ServerUpgradeAttemptKind,
		startedAt,
		expiresAt,
		...(record.stage === undefined
			? {}
			: { stage: record.stage as ServerUpgradeAttemptStage }),
		...(record.ending === undefined
			? {}
			: { ending: parseEnding(record.ending) }),
	});
}

function parseEnding(value: unknown): ServerUpgradeEnding {
	const record = strictRecord(value, 'server upgrade ending', [
		'kind',
		'from',
		'to',
		'reason',
		'at',
	]);
	if (
		!(SERVER_UPGRADE_ENDING_KINDS as readonly unknown[]).includes(record.kind)
	)
		throw new TypeError('server upgrade ending kind is invalid');
	return Object.freeze({
		kind: record.kind as ServerUpgradeEndingKind,
		from: text(record.from, 'from', SERVER_UPGRADE_MAX_VERSION_CHARS),
		to: text(record.to, 'to', SERVER_UPGRADE_MAX_VERSION_CHARS),
		...(record.reason === undefined
			? {}
			: {
					reason: text(record.reason, 'reason', SERVER_UPGRADE_MAX_TEXT_CHARS),
				}),
		at: time(record.at, 'at'),
	});
}

/** Whether a string is a well-formed attempt or request id. */
export function isServerUpgradeId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= SERVER_UPGRADE_MAX_ID_CHARS &&
		ID_PATTERN.test(value)
	);
}

function identifier(value: unknown, name: string): string {
	if (!isServerUpgradeId(value))
		throw new TypeError(`server upgrade ${name} is invalid`);
	return value;
}

/** Validate a status exactly as a server publishes it. */
export function parseServerUpgradeStatus(value: unknown): ServerUpgradeStatus {
	const record = strictRecord(value, 'server upgrade status', [
		'version',
		'channel',
		'available',
		'canUpgrade',
		'modes',
		'recreateEndsTerminals',
		'unavailable',
		'latest',
		'upgrade',
	]);
	const version = text(
		record.version,
		'version',
		SERVER_UPGRADE_MAX_VERSION_CHARS,
	);
	if (
		record.channel !== undefined &&
		!(SERVER_UPGRADE_CHANNELS as readonly unknown[]).includes(record.channel)
	)
		throw new TypeError('server upgrade channel is invalid');
	if (typeof record.canUpgrade !== 'boolean')
		throw new TypeError('server upgrade canUpgrade is invalid');
	const modes = parseModes(record.modes);
	const offersRecreate = modes.includes('recreate');
	if (
		record.recreateEndsTerminals !== undefined &&
		(record.recreateEndsTerminals !== true || !offersRecreate)
	)
		throw new TypeError('server upgrade recreateEndsTerminals is invalid');
	if (offersRecreate && record.recreateEndsTerminals !== true)
		throw new TypeError(
			'server upgrade recreate mode must say it ends terminals',
		);
	let available: { readonly version: string } | undefined;
	if (record.available !== undefined) {
		const entry = strictRecord(record.available, 'server upgrade available', [
			'version',
		]);
		available = Object.freeze({
			version: text(
				entry.version,
				'available version',
				SERVER_UPGRADE_MAX_VERSION_CHARS,
			),
		});
	}
	const unavailable =
		record.unavailable === undefined
			? undefined
			: parseUnavailable(record.unavailable, 'unavailable');
	let latest: ServerUpgradeLatest | undefined;
	if (record.latest !== undefined) {
		const entry = strictRecord(record.latest, 'server upgrade latest', [
			'version',
			'order',
			'canInstall',
			'unavailable',
		]);
		if (
			!(SERVER_UPGRADE_LATEST_ORDERS as readonly unknown[]).includes(entry.order)
		)
			throw new TypeError('server upgrade latest order is invalid');
		if (typeof entry.canInstall !== 'boolean')
			throw new TypeError('server upgrade latest canInstall is invalid');
		if (entry.canInstall && entry.order === 'same')
			throw new TypeError('server upgrade latest cannot install itself');
		const blocked =
			entry.unavailable === undefined
				? undefined
				: parseUnavailable(entry.unavailable, 'latest unavailable');
		latest = Object.freeze({
			version: text(
				entry.version,
				'latest version',
				SERVER_UPGRADE_MAX_VERSION_CHARS,
			),
			order: entry.order as ServerUpgradeLatestOrder,
			canInstall: entry.canInstall,
			...(blocked === undefined ? {} : { unavailable: blocked }),
		});
	}
	return Object.freeze({
		version,
		...(record.channel === undefined
			? {}
			: { channel: record.channel as ServerUpgradeChannel }),
		...(available === undefined ? {} : { available }),
		canUpgrade: record.canUpgrade,
		modes,
		...(offersRecreate ? { recreateEndsTerminals: true as const } : {}),
		...(unavailable === undefined ? {} : { unavailable }),
		...(latest === undefined ? {} : { latest }),
		upgrade: parseProgress(record.upgrade),
	});
}

function parseUnavailable(
	value: unknown,
	name: string,
): { readonly reason: string; readonly command: string } {
	const entry = strictRecord(value, `server upgrade ${name}`, [
		'reason',
		'command',
	]);
	return Object.freeze({
		reason: text(entry.reason, `${name} reason`, SERVER_UPGRADE_MAX_TEXT_CHARS),
		command: text(
			entry.command,
			`${name} command`,
			SERVER_UPGRADE_MAX_TEXT_CHARS,
		),
	});
}

/** Validate a start request. Anything beyond the mode, `allowOlder` and the
 * device's own request id is a rejection: the client never names what is
 * installed. */
export function parseServerUpgradeStartRequest(
	value: unknown,
): ServerUpgradeStartRequest {
	const record = strictRecord(value, 'server upgrade request', [
		'mode',
		'allowOlder',
		'requestId',
	]);
	if (!isServerUpgradeMode(record.mode))
		throw new TypeError('server upgrade mode is invalid');
	if (record.allowOlder !== undefined && record.allowOlder !== true)
		throw new TypeError('server upgrade allowOlder is invalid');
	return Object.freeze({
		mode: record.mode,
		...(record.allowOlder === true ? { allowOlder: true as const } : {}),
		...(record.requestId === undefined
			? {}
			: { requestId: identifier(record.requestId, 'request id') }),
	});
}

export function isServerUpgradeMode(
	value: unknown,
): value is ServerUpgradeMode {
	return (SERVER_UPGRADE_MODES as readonly unknown[]).includes(value);
}

function parseModes(value: unknown): readonly ServerUpgradeMode[] {
	if (!Array.isArray(value) || value.length > SERVER_UPGRADE_MODES.length)
		throw new TypeError('server upgrade modes are invalid');
	const modes: ServerUpgradeMode[] = [];
	for (const entry of value) {
		if (!isServerUpgradeMode(entry) || modes.includes(entry))
			throw new TypeError('server upgrade modes are invalid');
		modes.push(entry);
	}
	return Object.freeze(modes);
}

function parseProgress(value: unknown): ServerUpgradeProgress {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('server upgrade state is invalid');
	const state = (value as Record<string, unknown>).state;
	if (state === 'none') {
		strictRecord(value, 'server upgrade state', ['state']);
		return Object.freeze({ state });
	}
	if (state === 'in-progress') {
		const record = strictRecord(value, 'server upgrade state', [
			'state',
			'mode',
			'startedAt',
		]);
		if (!isServerUpgradeMode(record.mode))
			throw new TypeError('server upgrade mode is invalid');
		return Object.freeze({
			state,
			mode: record.mode,
			startedAt: time(record.startedAt, 'startedAt'),
		});
	}
	if (state === 'succeeded') {
		const record = strictRecord(value, 'server upgrade state', [
			'state',
			'from',
			'to',
			'at',
		]);
		return Object.freeze({
			state,
			from: text(record.from, 'from', SERVER_UPGRADE_MAX_VERSION_CHARS),
			to: text(record.to, 'to', SERVER_UPGRADE_MAX_VERSION_CHARS),
			at: time(record.at, 'at'),
		});
	}
	if (state === 'failed') {
		const record = strictRecord(value, 'server upgrade state', [
			'state',
			'from',
			'to',
			'reason',
			'restored',
			'at',
		]);
		if (record.restored !== true)
			throw new TypeError('server upgrade restored flag is invalid');
		return Object.freeze({
			state,
			from: text(record.from, 'from', SERVER_UPGRADE_MAX_VERSION_CHARS),
			to: text(record.to, 'to', SERVER_UPGRADE_MAX_VERSION_CHARS),
			...(record.reason === undefined
				? {}
				: {
						reason: text(
							record.reason,
							'reason',
							SERVER_UPGRADE_MAX_TEXT_CHARS,
						),
					}),
			restored: true as const,
			at: time(record.at, 'at'),
		});
	}
	throw new TypeError('server upgrade state is invalid');
}

function strictRecord(
	value: unknown,
	name: string,
	known: readonly string[],
): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((key) => !known.includes(key)))
		throw new TypeError(`${name} has an unknown field`);
	return record;
}

function text(value: unknown, name: string, maxChars: number): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maxChars
	)
		throw new TypeError(`server upgrade ${name} is invalid`);
	return value;
}

function time(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError(`server upgrade ${name} is invalid`);
	return value;
}
