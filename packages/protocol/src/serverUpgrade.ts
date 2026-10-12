/**
 * A server's own upgrade, as its clients see it (ADR-0062).
 *
 * The server decides what is installed. A client reads the status the server
 * publishes and may ask for an upgrade to begin; the request names the mode
 * and nothing else, so no version, reference, URL, path, or flag can travel
 * in it.
 */

/** Hello capability advertised by a server that publishes its upgrade status. */
export const SERVER_UPGRADE_CAPABILITY = 'server.upgrade' as const;

/** Stable protocol names for the server upgrade surface. */
export const SERVER_UPGRADE_OPERATIONS = Object.freeze({
	status: 'server.upgrade.status',
	start: 'server.upgrade.start',
	event: 'server.upgrade',
} as const);

export const SERVER_UPGRADE_MODES = ['in-place', 'recreate'] as const;
export type ServerUpgradeMode = (typeof SERVER_UPGRADE_MODES)[number];

export const SERVER_UPGRADE_CHANNELS = ['tag', 'main', 'source'] as const;
export type ServerUpgradeChannel = (typeof SERVER_UPGRADE_CHANNELS)[number];

/** Why a `server.upgrade.start` was refused, in the error's `details.reason`. */
export const SERVER_UPGRADE_REFUSALS = [
	'none-available',
	'cannot-upgrade',
	'mode-not-offered',
	'in-progress',
	'trigger-failed',
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
	readonly upgrade: ServerUpgradeProgress;
}

export interface ServerUpgradeStartRequest {
	readonly mode: ServerUpgradeMode;
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
	let unavailable:
		| { readonly reason: string; readonly command: string }
		| undefined;
	if (record.unavailable !== undefined) {
		const entry = strictRecord(
			record.unavailable,
			'server upgrade unavailable',
			['reason', 'command'],
		);
		unavailable = Object.freeze({
			reason: text(
				entry.reason,
				'unavailable reason',
				SERVER_UPGRADE_MAX_TEXT_CHARS,
			),
			command: text(
				entry.command,
				'unavailable command',
				SERVER_UPGRADE_MAX_TEXT_CHARS,
			),
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
		upgrade: parseProgress(record.upgrade),
	});
}

/** Validate a start request. Anything beyond the mode is a rejection: the
 * client never names what is installed. */
export function parseServerUpgradeStartRequest(
	value: unknown,
): ServerUpgradeStartRequest {
	const record = strictRecord(value, 'server upgrade request', ['mode']);
	if (!isServerUpgradeMode(record.mode))
		throw new TypeError('server upgrade mode is invalid');
	return Object.freeze({ mode: record.mode });
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
