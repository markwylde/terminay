/** Server-owned bot environment operations. Every operation needs terminal-create
 * authority; payloads never accept engine arguments or host paths. */
export const BOT_ENVIRONMENT_OPERATIONS = Object.freeze({
	overview: 'bots.environment.overview',
	settings: 'bots.environment.settings',
	setSettings: 'bots.environment.set-settings',
	start: 'bots.environment.start',
	stop: 'bots.environment.stop',
	restart: 'bots.environment.restart',
	recreate: 'bots.environment.recreate',
	remove: 'bots.environment.remove',
	containers: 'bots.environment.containers',
	containerAction: 'bots.environment.container-action',
	containerLogs: 'bots.environment.container-logs',
});
export type BotEnvironmentState =
	| 'not-created'
	| 'building'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'failed';
export interface BotResourceLimits {
	readonly cpus: number;
	readonly memoryBytes: number;
	readonly pids: number;
}
export type BotSocketWarning =
	| 'root-equivalent'
	| 'server-account'
	| 'engine-control';
export interface BotEnvironmentSettings {
	readonly botId: string;
	readonly shareEngineSocket: boolean;
	readonly idleStopMs: number | null;
	readonly limits: BotResourceLimits;
	readonly limitsEnforced: boolean;
	readonly socketWarning: BotSocketWarning;
	/** Per-bot environment revision, independent of the bots.changed revision. */
	readonly revision: number;
}
export interface BotEnvironmentSetSettings {
	readonly botId: string;
	readonly shareEngineSocket?: boolean;
	readonly idleStopMs?: number | null;
	readonly limits?: BotResourceLimits;
	readonly confirmed?: boolean;
	readonly expectedRevision?: number;
}
/** Refusal in ProtocolError.details; confirmation uses code `forbidden`,
 * stale revisions use code `conflict`. */
export type BotEnvironmentSettingsRefusal =
	| {
			readonly reason: 'confirmation-required';
			readonly socketWarning: BotSocketWarning;
	  }
	| { readonly reason: 'conflict' };
export const DEFAULT_BOT_RESOURCE_LIMITS: BotResourceLimits = Object.freeze({
	cpus: 2,
	memoryBytes: 4 * 1024 ** 3,
	pids: 1024,
});
export const DEFAULT_BOT_IDLE_STOP_MS = 30 * 60_000;
export function botIdleStopMs(value: unknown): number | null {
	if (value === null) return null;
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 5 * 60_000 ||
		value > 7 * 24 * 60 * 60_000
	)
		throw new TypeError('invalid bot idle stop');
	return value;
}
export function parseBotEnvironmentSetSettings(
	value: unknown,
): BotEnvironmentSetSettings {
	const record = object(value);
	const result: {
		botId: string;
		shareEngineSocket?: boolean;
		idleStopMs?: number | null;
		limits?: BotResourceLimits;
		confirmed?: boolean;
		expectedRevision?: number;
	} = {
		botId: botEnvironmentId(record.botId),
	};
	for (const key of Object.keys(record))
		if (
			![
				'botId',
				'shareEngineSocket',
				'idleStopMs',
				'limits',
				'confirmed',
				'expectedRevision',
			].includes(key)
		)
			throw new TypeError('unknown bot settings field');
	for (const key of ['shareEngineSocket', 'confirmed'] as const)
		if (record[key] !== undefined) {
			if (typeof record[key] !== 'boolean')
				throw new TypeError('invalid bot settings flag');
			result[key] = record[key];
		}
	if (record.idleStopMs !== undefined)
		result.idleStopMs = botIdleStopMs(record.idleStopMs);
	if (record.limits !== undefined)
		result.limits = botResourceLimits(
			object(record.limits) as unknown as BotResourceLimits,
		);
	if (record.expectedRevision !== undefined) {
		revision(record.expectedRevision);
		result.expectedRevision = record.expectedRevision as number;
	}
	return result;
}
export function parseBotEnvironmentSettings(
	value: unknown,
): BotEnvironmentSettings {
	const record = object(value);
	botEnvironmentId(record.botId);
	botIdleStopMs(record.idleStopMs);
	botResourceLimits(object(record.limits) as unknown as BotResourceLimits);
	if (
		typeof record.shareEngineSocket !== 'boolean' ||
		typeof record.limitsEnforced !== 'boolean'
	)
		throw new TypeError('invalid bot settings flag');
	socketWarning(record.socketWarning);
	revision(record.revision);
	return structuredClone(record) as unknown as BotEnvironmentSettings;
}
function revision(value: unknown): void {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		throw new TypeError('invalid bot settings revision');
}
function socketWarning(value: unknown): void {
	if (
		!['root-equivalent', 'server-account', 'engine-control'].includes(
			String(value),
		)
	)
		throw new TypeError('invalid socket warning');
}
export type BotContainerAction =
	| 'start'
	| 'stop'
	| 'restart'
	| 'logs'
	| 'remove';
export interface BotSiblingContainer {
	readonly id: string;
	readonly name: string;
	readonly image: string;
	readonly state: string;
	readonly ports: string;
	readonly createdAt: string;
}
export interface BotEnvironmentOverview {
	readonly botId: string;
	readonly state: BotEnvironmentState;
	readonly uptimeMs: number;
	readonly image: string;
	readonly fingerprint: string;
	readonly current: boolean;
	readonly homeVolume: string;
	readonly limits: BotResourceLimits;
	readonly limitsEnforced: boolean;
	readonly shareEngineSocket: boolean;
	readonly socketChangePending: boolean;
	readonly limitsChangePending: boolean;
	readonly socketWarning:
		| 'root-equivalent'
		| 'server-account'
		| 'engine-control';
	readonly cpuPercent: number | null;
	readonly memoryBytes: number | null;
	readonly homeBytes: number | null;
	readonly sampledAt: number;
	readonly log: string;
}
export function botEnvironmentId(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-z0-9]{12}$/.test(value))
		throw new TypeError('invalid bot id');
	return value;
}
export function botResourceLimits(value: BotResourceLimits): BotResourceLimits {
	if (
		!Number.isFinite(value.cpus) ||
		value.cpus <= 0 ||
		value.cpus > 1024 ||
		!Number.isSafeInteger(value.memoryBytes) ||
		value.memoryBytes < 16 * 1024 * 1024 ||
		!Number.isSafeInteger(value.pids) ||
		value.pids < 1 ||
		value.pids > 4_194_304
	)
		throw new TypeError('invalid bot resource limits');
	return { cpus: value.cpus, memoryBytes: value.memoryBytes, pids: value.pids };
}

export function parseBotEnvironmentOverview(
	value: unknown,
): BotEnvironmentOverview {
	const record = object(value);
	botEnvironmentId(record.botId);
	if (
		![
			'not-created',
			'building',
			'starting',
			'running',
			'stopping',
			'stopped',
			'failed',
		].includes(String(record.state))
	)
		throw new TypeError('invalid bot environment state');
	for (const key of ['uptimeMs', 'sampledAt']) nonnegative(record[key]);
	for (const key of ['cpuPercent', 'memoryBytes', 'homeBytes'])
		if (record[key] !== null) nonnegative(record[key]);
	for (const key of [
		'current',
		'limitsEnforced',
		'shareEngineSocket',
		'socketChangePending',
		'limitsChangePending',
	])
		if (typeof record[key] !== 'boolean')
			throw new TypeError('invalid bot environment flag');
	for (const key of ['image', 'fingerprint', 'homeVolume'])
		boundedText(record[key], 2048);
	boundedText(record.log, 256 * 1024);
	if (
		!['root-equivalent', 'server-account', 'engine-control'].includes(
			String(record.socketWarning),
		)
	)
		throw new TypeError('invalid socket warning');
	botResourceLimits(object(record.limits) as unknown as BotResourceLimits);
	return structuredClone(record) as unknown as BotEnvironmentOverview;
}
export function parseBotSiblingContainers(
	value: unknown,
): readonly BotSiblingContainer[] {
	if (!Array.isArray(value) || value.length > 10000)
		throw new TypeError('invalid bot containers');
	for (const item of value) {
		const record = object(item);
		if (typeof record.id !== 'string' || !/^[a-f0-9]{12,64}$/.test(record.id))
			throw new TypeError('invalid bot container id');
		for (const key of ['name', 'image', 'state', 'createdAt'])
			boundedText(record[key], 2048);
		boundedText(record.ports, 65536);
	}
	return structuredClone(value) as readonly BotSiblingContainer[];
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('invalid bot environment result');
	return value as Record<string, unknown>;
}
function nonnegative(value: unknown): void {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		throw new TypeError('invalid bot environment figure');
}
function boundedText(value: unknown, limit: number): void {
	if (
		typeof value !== 'string' ||
		new TextEncoder().encode(value).length > limit
	)
		throw new TypeError('invalid bot environment text');
}
