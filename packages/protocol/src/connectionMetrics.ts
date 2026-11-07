/**
 * Connection timing samples (the `connection.metrics.v1` capability).
 *
 * A workspace client times each connect, recovery and answered resume probe,
 * and sends the server one sample. The server keeps them only while
 * `remoteAccess.connectionMetrics` is on. A sample is metadata only: fixed
 * vocabularies and bounded integer durations, with no identity, address or
 * workspace content. Both sides validate against the same tables.
 */

export const CONNECTION_METRICS_CAPABILITY = 'connection.metrics.v1' as const;

export const CONNECTION_METRICS_OPERATIONS = Object.freeze({
	record: 'connection.metrics.record',
	summary: 'connection.metrics.summary',
	clear: 'connection.metrics.clear',
} as const);

export const CONNECTION_METRIC_KINDS = Object.freeze([
	'connect',
	'recover',
	'resume-alive',
] as const);
export type ConnectionMetricKind = (typeof CONNECTION_METRIC_KINDS)[number];

export const CONNECTION_METRIC_TRIGGERS = Object.freeze([
	'initial',
	'resume-probe',
	'heartbeat',
	'transport-closed',
	'manual',
] as const);
export type ConnectionMetricTrigger =
	(typeof CONNECTION_METRIC_TRIGGERS)[number];

export const CONNECTION_METRIC_HOSTS = Object.freeze([
	'browser',
	'desktop',
] as const);
export type ConnectionMetricHost = (typeof CONNECTION_METRIC_HOSTS)[number];

export const CONNECTION_METRIC_FAILURES = Object.freeze([
	'timeout',
	'transport-closed',
	'signaling',
	'unreachable',
	'other',
] as const);
export type ConnectionMetricFailure =
	(typeof CONNECTION_METRIC_FAILURES)[number];

/** The steps a session host reports for its last connect. */
export const HOST_CONNECT_TIMING_KEYS = Object.freeze([
	'signalMs',
	'iceMs',
	'lanesMs',
	'deviceAuthMs',
	'appAuthMs',
] as const);
export type HostConnectTimingKey = (typeof HOST_CONNECT_TIMING_KEYS)[number];
export type HostConnectTimings = Readonly<
	Partial<Record<HostConnectTimingKey, number>>
>;

export const CONNECTION_METRIC_DURATIONS = Object.freeze([
	/** How long the document was hidden before the resume that led here. */
	'hiddenMs',
	/** From the document being shown to the loss being declared. */
	'detectMs',
	/** The answered resume probe's round trip. */
	'probeRttMs',
	...HOST_CONNECT_TIMING_KEYS,
	/** From attempt start until the host handed back an open transport. */
	'transportMs',
	'helloMs',
	/** Building the workspace projections after the hello. */
	'syncMs',
	/** From the loss (or the first attempt) to ready. */
	'totalMs',
] as const);
export type ConnectionMetricDuration =
	(typeof CONNECTION_METRIC_DURATIONS)[number];

/** Anything longer is a clock jump, not a measurement. */
export const CONNECTION_METRIC_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
export const CONNECTION_METRIC_MAX_ATTEMPTS = 10_000;

export type ConnectionMetricSample = Readonly<
	{
		kind: ConnectionMetricKind;
		trigger: ConnectionMetricTrigger;
		host: ConnectionMetricHost;
		attempts?: number;
		failure?: ConnectionMetricFailure;
	} & Partial<Record<ConnectionMetricDuration, number>>
>;

/** A stored sample: the server adds when it received it. */
export type StoredConnectionMetricSample = ConnectionMetricSample &
	Readonly<{ at: number }>;

export type ConnectionMetricStats = Readonly<{
	count: number;
	mean: number;
	p50: number;
	p95: number;
	max: number;
}>;

export type ConnectionMetricBreakdown = Readonly<{
	count: number;
	durations: Readonly<Partial<Record<ConnectionMetricDuration, ConnectionMetricStats>>>;
	/** Samples that needed more than one attempt. */
	retried: number;
}>;

export type ConnectionMetricsSummary = Readonly<{
	enabled: boolean;
	count: number;
	since?: number;
	until?: number;
	overall: ConnectionMetricBreakdown;
	byTrigger: Readonly<Partial<Record<ConnectionMetricTrigger, ConnectionMetricBreakdown>>>;
	byKind: Readonly<Partial<Record<ConnectionMetricKind, number>>>;
	recent: readonly StoredConnectionMetricSample[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, max: number): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const rounded = Math.round(value);
	if (rounded < 0 || rounded > max) return undefined;
	return rounded;
}

function oneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): T | undefined {
	return typeof value === 'string' && (values as readonly string[]).includes(value)
		? (value as T)
		: undefined;
}

/** Keep the host steps that are bounded durations under a known key. */
export function normalizeHostConnectTimings(
	input: unknown,
): HostConnectTimings | undefined {
	if (!isRecord(input)) return undefined;
	const result: Partial<Record<HostConnectTimingKey, number>> = {};
	for (const key of HOST_CONNECT_TIMING_KEYS) {
		const value = boundedInteger(input[key], CONNECTION_METRIC_MAX_DURATION_MS);
		if (value !== undefined) result[key] = value;
	}
	return Object.keys(result).length === 0 ? undefined : Object.freeze(result);
}

/**
 * Validate an untrusted sample field by field. Unknown fields and invalid
 * values are dropped; a sample without a valid kind, trigger and host is
 * refused as a whole.
 */
export function normalizeConnectionMetricSample(
	input: unknown,
): ConnectionMetricSample | undefined {
	if (!isRecord(input)) return undefined;
	const kind = oneOf(CONNECTION_METRIC_KINDS, input.kind);
	const trigger = oneOf(CONNECTION_METRIC_TRIGGERS, input.trigger);
	const host = oneOf(CONNECTION_METRIC_HOSTS, input.host);
	if (kind === undefined || trigger === undefined || host === undefined)
		return undefined;
	const sample: Record<string, unknown> = { kind, trigger, host };
	const attempts = boundedInteger(input.attempts, CONNECTION_METRIC_MAX_ATTEMPTS);
	if (attempts !== undefined && attempts >= 1) sample.attempts = attempts;
	const failure = oneOf(CONNECTION_METRIC_FAILURES, input.failure);
	if (failure !== undefined) sample.failure = failure;
	for (const key of CONNECTION_METRIC_DURATIONS) {
		const value = boundedInteger(input[key], CONNECTION_METRIC_MAX_DURATION_MS);
		if (value !== undefined) sample[key] = value;
	}
	return Object.freeze(sample) as ConnectionMetricSample;
}

/** Classify a connect failure message into the fixed vocabulary. */
export function classifyConnectionFailure(
	cause: unknown,
): ConnectionMetricFailure {
	const message = (
		cause instanceof Error ? cause.message : String(cause ?? '')
	).toLowerCase();
	if (message.includes('time') || message.includes('deadline')) return 'timeout';
	if (message.includes('signal')) return 'signaling';
	if (message.includes('closed') || message.includes('retired'))
		return 'transport-closed';
	if (message.includes('unreachable') || message.includes('reach'))
		return 'unreachable';
	return 'other';
}
