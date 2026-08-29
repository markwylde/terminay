import { type Dirent, constants as fsConstants } from 'node:fs';
import {
	chmod,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	unlink,
} from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

export const DIAGNOSTIC_SCHEMA_VERSION = 1 as const;
export const MAX_EVENT_BYTES = 16 * 1024;
export const TEXT_RATE_LIMIT_ENTRIES = 100;
export const TEXT_RATE_LIMIT_BYTES = 256 * 1024;
export const RATE_LIMIT_WINDOW_MS = 10_000;
export const SEGMENT_MAX_BYTES = 10 * 1024 * 1024;
export const SEGMENT_MAX_AGE_MS = 60 * 60 * 1000;
export const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ARTIFACT_AGGREGATE_MAX_BYTES = 100 * 1024 * 1024;

export const DIAGNOSTIC_SEVERITIES = [
	'debug',
	'info',
	'warning',
	'error',
	'fatal',
] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export const DIAGNOSTIC_COMPONENTS = [
	'diagnostics',
	'main',
	'renderer',
	'electron-child',
	'local-server',
] as const;
export type DiagnosticComponent = (typeof DIAGNOSTIC_COMPONENTS)[number];

/** Stable names are identifiers for machines and support tooling, never formatted messages. */
export const DIAGNOSTIC_EVENT_NAMES = [
	'diagnostics.launch.started',
	'diagnostics.launch.clean-exit',
	'diagnostics.launch.previous-interrupted',
	'diagnostics.writer.degraded',
	'diagnostics.cleanup.failed',
	'diagnostics.retention.completed',
	'diagnostics.source.suppressed',
	'diagnostics.cleared',
	'diagnostics.performance.enabled',
	'diagnostics.performance.disabled',
	'diagnostics.performance.sample',
	'diagnostics.performance.stack-collected',
	'diagnostics.performance.stack-unavailable',
	'diagnostics.performance.trace-started',
	'diagnostics.performance.trace-completed',
	'diagnostics.performance.trace-failed',
	'main.ready',
	'main.stdout',
	'main.stderr',
	'main.uncaught-exception',
	'main.unhandled-rejection',
	'main.window.created',
	'main.window.destroyed',
	'renderer.console',
	'renderer.bootstrap.failed',
	'renderer.root-error',
	'renderer.preload-failed',
	'renderer.load-failed',
	'renderer.navigation-failed',
	'renderer.process-gone',
	'renderer.unresponsive',
	'renderer.responsive',
	'renderer.stack-collected',
	'renderer.stack-unavailable',
	'electron-child.process-gone',
	'local-server.starting',
	'local-server.ready',
	'local-server.failed',
	'local-server.connection.failed',
	'local-server.file-operation.failed',
	'local-server.terminal-congestion',
	'local-server.remote-pairing.advertised',
	'local-server.remote-pairing.registered',
	'local-server.remote-pairing.signaling-closed',
	'local-server.remote-pairing.rotated',
	'local-server.remote-pairing.reregistered',
	'local-server.remote-pairing.client-join',
	'local-server.remote-pairing.failed',
	'local-server.remote-webrtc.peer-state',
	'local-server.remote-webrtc.ice-grace',
	'local-server.remote-webrtc.channel-state',
	'local-server.remote-webrtc.application-lane',
	'local-server.remote-webrtc.peer-closed',
	'local-server.stopping',
	'local-server.stopped',
	'terminal.recovery.started',
	'terminal.recovery.retrying',
	'terminal.recovery.recovered',
	'terminal.recovery.failed',
] as const;
export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENT_NAMES)[number];

export interface DiagnosticEventInput {
	severity: DiagnosticSeverity;
	component: DiagnosticComponent;
	event: DiagnosticEventName;
	source?: string;
	message?: unknown;
	stack?: unknown;
	fields?: unknown;
	timestamp?: Date | number | string;
}

export interface DiagnosticEvent {
	schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
	timestamp: string;
	severity: DiagnosticSeverity;
	component: DiagnosticComponent;
	event: DiagnosticEventName;
	launchId: string;
	source?: string;
	message?: string;
	stack?: string;
	fields?: Record<string, unknown>;
	truncated?: true;
}

const MAX_STRING_BYTES = 8 * 1024;
const MAX_STACK_BYTES = 8 * 1024;
const MAX_DEPTH = 6;
const MAX_OBJECT_KEYS = 48;
const MAX_ARRAY_ITEMS = 48;
const REDACTED = '<redacted>';
const TRUNCATED = '<truncated>';

const secretPatterns: ReadonlyArray<[RegExp, string]> = [
	[/\b(authorization\s*[:=]\s*)(?:basic|bearer)\s+[^\s,;]+/gi, `$1${REDACTED}`],
	[/\b(cookie|set-cookie)\s*[:=]\s*[^\r\n;]+/gi, `$1=${REDACTED}`],
	[
		/\b(api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|secret|reconnect[-_ ]?grant|pairing[-_ ]?(?:pin|token))\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
		`$1=${REDACTED}`,
	],
	[/\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b/g, REDACTED],
	[/\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}\b/g, REDACTED],
	[
		/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		REDACTED,
	],
];
const SECRET_FIELD_PATTERN =
	/(?:authorization|cookie|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|passwd|secret|reconnect[-_ ]?grant|pairing[-_ ]?(?:pin|token))/i;

/**
 * Defence-in-depth for arbitrary error text. Callers must still avoid sending user
 * content. URLs and absolute paths are deliberately reduced rather than "cleaned".
 */
export function sanitizeDiagnosticText(value: string): string {
	let result = value;
	result = result.replace(
		/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi,
		'<url:redacted>',
	);
	result = result.replace(
		/(?:^|[\s("'])\/(?:Users|home|private|tmp|var|opt|Volumes|mnt|srv)(?:\/[^\s:),;"']*)?/g,
		(match) => {
			const prefix = match[0] === '/' ? '' : match[0];
			return `${prefix}<path:redacted>`;
		},
	);
	result = result.replace(
		/(?:^|[\s("'=])\/(?!\/)[^\s:),;"']+/g,
		(match) => `${match[0] === '/' ? '' : match[0]}<path:redacted>`,
	);
	result = result.replace(
		/\b[A-Za-z]:\\(?:[^\s:),;"']+\\)*[^\s:),;"']*/g,
		'<path:redacted>',
	);
	result = result.replace(/\\\\[^\s\\]+\\[^\s:),;"']*/g, '<path:redacted>');
	for (const [pattern, replacement] of secretPatterns)
		result = result.replace(pattern, replacement);
	return result;
}

function truncateUtf8(
	value: string,
	maxBytes: number,
): { text: string; truncated: boolean } {
	if (Buffer.byteLength(value) <= maxBytes)
		return { text: value, truncated: false };
	const suffix = TRUNCATED;
	const target = Math.max(0, maxBytes - Buffer.byteLength(suffix));
	let low = 0;
	let high = value.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (Buffer.byteLength(value.slice(0, middle)) <= target) low = middle;
		else high = middle - 1;
	}
	return { text: `${value.slice(0, low)}${suffix}`, truncated: true };
}

function safeErrorString(value: unknown): string {
	try {
		if (typeof value === 'string') return value;
		if (value instanceof Error) return `${value.name}: ${value.message}`;
		return String(value);
	} catch {
		return '<unprintable>';
	}
}

function normalizeString(
	value: unknown,
	maxBytes = MAX_STRING_BYTES,
): { text: string; truncated: boolean } {
	return truncateUtf8(sanitizeDiagnosticText(safeErrorString(value)), maxBytes);
}

interface NormalizationState {
	ancestors: Set<object>;
	truncated: boolean;
}

function normalizeValue(
	value: unknown,
	state: NormalizationState,
	depth = 0,
): unknown {
	if (value === null || typeof value === 'boolean') return value;
	if (typeof value === 'number')
		return Number.isFinite(value) ? value : String(value);
	if (typeof value === 'string') {
		const normalized = normalizeString(value);
		state.truncated ||= normalized.truncated;
		return normalized.text;
	}
	if (typeof value === 'bigint') return `${value.toString()}n`;
	if (typeof value === 'undefined') return '<undefined>';
	if (typeof value === 'symbol')
		return normalizeString(value.description ?? '<symbol>').text;
	if (typeof value === 'function') return '<function>';
	if (value instanceof Date)
		return Number.isNaN(value.getTime())
			? '<invalid-date>'
			: value.toISOString();
	if (value instanceof Error) {
		return normalizeValue(
			{ name: value.name, message: value.message, stack: value.stack },
			state,
			depth,
		);
	}
	if (depth >= MAX_DEPTH) {
		state.truncated = true;
		return '<max-depth>';
	}
	if (typeof value !== 'object') return '<unsupported>';
	if (state.ancestors.has(value)) {
		state.truncated = true;
		return '<circular>';
	}
	state.ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			if (value.length > MAX_ARRAY_ITEMS) state.truncated = true;
			const items = value
				.slice(0, MAX_ARRAY_ITEMS)
				.map((item) => normalizeValue(item, state, depth + 1));
			if (value.length > MAX_ARRAY_ITEMS)
				items.push(`<${value.length - MAX_ARRAY_ITEMS} items truncated>`);
			return items;
		}
		const output: Record<string, unknown> = {};
		let keys: string[];
		try {
			keys = Object.keys(value).sort();
		} catch {
			state.truncated = true;
			return '<uninspectable-object>';
		}
		if (keys.length > MAX_OBJECT_KEYS) state.truncated = true;
		for (const rawKey of keys.slice(0, MAX_OBJECT_KEYS)) {
			const key = normalizeString(rawKey, 256).text;
			if (SECRET_FIELD_PATTERN.test(rawKey)) {
				output[key] = REDACTED;
				continue;
			}
			try {
				output[key] = normalizeValue(
					(value as Record<string, unknown>)[rawKey],
					state,
					depth + 1,
				);
			} catch {
				output[key] = '<unreadable-property>';
			}
		}
		if (keys.length > MAX_OBJECT_KEYS)
			output[TRUNCATED] = `${keys.length - MAX_OBJECT_KEYS} keys`;
		return output;
	} finally {
		state.ancestors.delete(value);
	}
}

function validTimestamp(
	value: DiagnosticEventInput['timestamp'],
	now: () => number,
): string {
	const date = value === undefined ? new Date(now()) : new Date(value);
	return Number.isNaN(date.getTime())
		? new Date(now()).toISOString()
		: date.toISOString();
}

function stringifyEvent(event: DiagnosticEvent): string {
	return JSON.stringify(event);
}

/** Normalize hostile values and guarantee a JSON encoding no larger than MAX_EVENT_BYTES. */
export function normalizeDiagnosticEvent(
	input: DiagnosticEventInput,
	launchId: string,
	options: { now?: () => number; maxBytes?: number } = {},
): DiagnosticEvent {
	const now = options.now ?? Date.now;
	const maxBytes = Math.min(
		Math.max(options.maxBytes ?? MAX_EVENT_BYTES, 512),
		MAX_EVENT_BYTES,
	);
	const jsonByteBudget = maxBytes - 1;
	const state: NormalizationState = { ancestors: new Set(), truncated: false };
	const event: DiagnosticEvent = {
		schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
		timestamp: validTimestamp(input.timestamp, now),
		severity: input.severity,
		component: input.component,
		event: input.event,
		launchId: normalizeString(launchId, 128).text,
	};
	if (input.source !== undefined)
		event.source = normalizeString(input.source, 256).text;
	if (input.message !== undefined) {
		const message = normalizeString(input.message);
		event.message = message.text;
		state.truncated ||= message.truncated;
	}
	if (input.stack !== undefined) {
		const stack = normalizeString(input.stack, MAX_STACK_BYTES);
		event.stack = stack.text;
		state.truncated ||= stack.truncated;
	}
	if (input.fields !== undefined) {
		const fields = normalizeValue(input.fields, state);
		event.fields =
			fields !== null && typeof fields === 'object' && !Array.isArray(fields)
				? (fields as Record<string, unknown>)
				: { value: fields };
	}
	if (state.truncated) event.truncated = true;

	let encoded = stringifyEvent(event);
	if (Buffer.byteLength(encoded) <= jsonByteBudget) return event;

	const originalBytes = Buffer.byteLength(encoded);
	event.truncated = true;
	event.fields = {
		originalEncodedBytes: originalBytes,
		value: '<event-fields-truncated>',
	};
	if (event.stack)
		event.stack = truncateUtf8(
			event.stack,
			Math.min(2048, Math.floor(maxBytes / 5)),
		).text;
	if (event.message)
		event.message = truncateUtf8(
			event.message,
			Math.min(2048, Math.floor(maxBytes / 5)),
		).text;
	encoded = stringifyEvent(event);
	if (Buffer.byteLength(encoded) <= jsonByteBudget) return event;

	delete event.stack;
	if (event.message) event.message = truncateUtf8(event.message, 256).text;
	event.fields = { originalEncodedBytes: originalBytes };
	encoded = stringifyEvent(event);
	if (Buffer.byteLength(encoded) <= jsonByteBudget) return event;

	// Identifiers are caller-owned but bounded again for unusually tiny test limits.
	event.launchId = truncateUtf8(event.launchId, 32).text;
	delete event.source;
	delete event.message;
	delete event.fields;
	return event;
}

export function encodeDiagnosticEvent(event: DiagnosticEvent): string {
	return `${stringifyEvent(event)}\n`;
}

export type DiagnosticRateChannel = 'text' | 'lifecycle';

interface RateEntry {
	at: number;
	bytes: number;
}

interface RateBucket {
	entries: RateEntry[];
	bytes: number;
	suppressed: number;
	suppressedBytes: number;
	suppressionStartedAt?: number;
}

export interface SuppressionSummary {
	source: string;
	channel: DiagnosticRateChannel;
	count: number;
	bytes: number;
	windowMs: number;
}

export interface RateLimitDecision {
	allowed: boolean;
	summaries: SuppressionSummary[];
}

/** Text floods cannot consume the independently-accounted lifecycle allowance. */
export class DiagnosticSourceRateLimiter {
	private readonly buckets = new Map<string, RateBucket>();

	constructor(
		private readonly options: {
			now?: () => number;
			windowMs?: number;
			textEntries?: number;
			textBytes?: number;
			lifecycleEntries?: number;
			lifecycleBytes?: number;
			maxSources?: number;
		} = {},
	) {}

	admit(
		source: string,
		encodedBytes: number,
		channel: DiagnosticRateChannel = 'text',
	): RateLimitDecision {
		const now = (this.options.now ?? Date.now)();
		const summaries = this.drainSuppressionSummaries(now);
		const key = `${channel}:${source}`;
		let bucket = this.buckets.get(key);
		if (!bucket) {
			if (this.buckets.size >= (this.options.maxSources ?? 512)) {
				return { allowed: false, summaries };
			}
			bucket = { entries: [], bytes: 0, suppressed: 0, suppressedBytes: 0 };
			this.buckets.set(key, bucket);
		}
		this.prune(bucket, now);
		const entryLimit =
			channel === 'text'
				? (this.options.textEntries ?? TEXT_RATE_LIMIT_ENTRIES)
				: (this.options.lifecycleEntries ?? TEXT_RATE_LIMIT_ENTRIES);
		const byteLimit =
			channel === 'text'
				? (this.options.textBytes ?? TEXT_RATE_LIMIT_BYTES)
				: (this.options.lifecycleBytes ?? TEXT_RATE_LIMIT_BYTES);
		const safeBytes = Math.max(0, Math.floor(encodedBytes));
		if (
			bucket.entries.length >= entryLimit ||
			bucket.bytes + safeBytes > byteLimit
		) {
			bucket.suppressed += 1;
			bucket.suppressedBytes += safeBytes;
			bucket.suppressionStartedAt ??= now;
			return { allowed: false, summaries };
		}
		bucket.entries.push({ at: now, bytes: safeBytes });
		bucket.bytes += safeBytes;
		return { allowed: true, summaries };
	}

	drainSuppressionSummaries(
		at = (this.options.now ?? Date.now)(),
	): SuppressionSummary[] {
		const summaries: SuppressionSummary[] = [];
		const windowMs = this.options.windowMs ?? RATE_LIMIT_WINDOW_MS;
		for (const [key, bucket] of this.buckets) {
			this.prune(bucket, at);
			if (
				bucket.suppressed > 0 &&
				bucket.suppressionStartedAt !== undefined &&
				at - bucket.suppressionStartedAt >= windowMs
			) {
				const separator = key.indexOf(':');
				summaries.push({
					source: key.slice(separator + 1),
					channel: key.slice(0, separator) as DiagnosticRateChannel,
					count: bucket.suppressed,
					bytes: bucket.suppressedBytes,
					windowMs,
				});
				bucket.suppressed = 0;
				bucket.suppressedBytes = 0;
				bucket.suppressionStartedAt = undefined;
			}
			if (bucket.entries.length === 0 && bucket.suppressed === 0)
				this.buckets.delete(key);
		}
		return summaries;
	}

	private prune(bucket: RateBucket, now: number): void {
		const cutoff = now - (this.options.windowMs ?? RATE_LIMIT_WINDOW_MS);
		while (bucket.entries[0] && bucket.entries[0].at <= cutoff) {
			bucket.bytes -= bucket.entries.shift()!.bytes;
		}
	}
}

const SEGMENT_PATTERN =
	/^terminay-diagnostics-v1-(\d{13})-([a-zA-Z0-9_-]{1,128})-(\d{4})\.jsonl$/;
const CRASH_PATTERN = /^terminay-crash-v1-(\d{13})-[a-zA-Z0-9_-]{1,128}\.dmp$/;
const PERFORMANCE_TRACE_PATTERN =
	/^terminay-performance-trace-v1-(\d{13})-([a-zA-Z0-9_-]{1,128})\.json$/;
export const LAUNCH_MARKER_FILENAME = 'terminay-launch-v1.json';

export type ManagedArtifactKind = 'segment' | 'crash' | 'performance-trace';

export interface ManagedArtifact {
	path: string;
	name: string;
	kind: ManagedArtifactKind;
	createdAt: number;
	size: number;
}

const CRASHPAD_DUMP_PATTERN =
	/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.dmp$/i;
const CRASHPAD_MANAGED_DIRECTORIES = new Set(['completed', 'new', 'pending']);

export function recognizeManagedArtifactName(
	name: string,
): { kind: ManagedArtifactKind; createdAt: number } | undefined {
	const segment = SEGMENT_PATTERN.exec(name);
	if (segment) return { kind: 'segment', createdAt: Number(segment[1]) };
	const crash = CRASH_PATTERN.exec(name);
	if (crash) return { kind: 'crash', createdAt: Number(crash[1]) };
	const trace = PERFORMANCE_TRACE_PATTERN.exec(name);
	if (trace) return { kind: 'performance-trace', createdAt: Number(trace[1]) };
	return undefined;
}

async function readDirectoryIfPresent(directory: string): Promise<Dirent[]> {
	try {
		const metadata = await lstat(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink())
			throw new Error('managed diagnostics directory is not a real directory');
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

function isInside(root: string, candidate: string): boolean {
	const normalizedRoot = resolve(root);
	const normalizedCandidate = resolve(candidate);
	return normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

export async function listManagedArtifacts(
	directory: string,
	activePath?: string,
): Promise<ManagedArtifact[]> {
	const entries = await readDirectoryIfPresent(directory);
	const artifacts: ManagedArtifact[] = [];
	for (const entry of entries) {
		const recognized = recognizeManagedArtifactName(entry.name);
		if (!recognized || entry.isSymbolicLink() || !entry.isFile()) continue;
		const path = join(directory, entry.name);
		if (!isInside(directory, path) || path === activePath) continue;
		try {
			const metadata = await lstat(path);
			if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
			artifacts.push({
				path,
				name: entry.name,
				kind: recognized.kind,
				createdAt: recognized.createdAt,
				size: metadata.size,
			});
		} catch {
			// A concurrent cleanup may have removed it.
		}
	}
	return artifacts;
}

/**
 * Crashpad chooses dump filenames, so its UUID names are recognized only under the
 * explicitly supplied Electron crashDumps root (or its known queue directories).
 * Settings, attachments, unknown names, directories, and symlinks are preserved.
 */
export async function listCrashpadArtifacts(
	crashpadDirectory: string,
): Promise<ManagedArtifact[]> {
	const artifacts: ManagedArtifact[] = [];
	const roots = [crashpadDirectory];
	const topLevel = await readDirectoryIfPresent(crashpadDirectory);
	for (const entry of topLevel) {
		if (
			!entry.isDirectory() ||
			entry.isSymbolicLink() ||
			!CRASHPAD_MANAGED_DIRECTORIES.has(entry.name)
		)
			continue;
		roots.push(join(crashpadDirectory, entry.name));
	}
	for (const root of roots) {
		const entries = await readDirectoryIfPresent(root);
		for (const entry of entries) {
			if (
				!entry.isFile() ||
				entry.isSymbolicLink() ||
				!CRASHPAD_DUMP_PATTERN.test(entry.name)
			)
				continue;
			const path = join(root, entry.name);
			if (!isInside(crashpadDirectory, path)) continue;
			try {
				const metadata = await lstat(path);
				if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
				const createdAt =
					metadata.birthtimeMs > 0 ? metadata.birthtimeMs : metadata.ctimeMs;
				artifacts.push({
					path,
					name: entry.name,
					kind: 'crash',
					createdAt,
					size: metadata.size,
				});
			} catch {
				// Crashpad may move a queued dump while it is being inspected.
			}
		}
	}
	return artifacts;
}

export interface CleanupResult {
	deleted: string[];
	failed: string[];
	remainingBytes: number;
}

export async function cleanupManagedArtifacts(
	directory: string,
	options: {
		now?: number;
		maxAgeMs?: number;
		aggregateMaxBytes?: number;
		activePath?: string;
		clearAll?: boolean;
	} = {},
): Promise<CleanupResult> {
	const now = options.now ?? Date.now();
	const maxAgeMs = options.maxAgeMs ?? ARTIFACT_MAX_AGE_MS;
	const aggregateMaxBytes =
		options.aggregateMaxBytes ?? ARTIFACT_AGGREGATE_MAX_BYTES;
	const artifacts = (
		await listManagedArtifacts(directory, options.activePath)
	).sort((a, b) => a.createdAt - b.createdAt);
	const deleted: string[] = [];
	const failed: string[] = [];
	let remainingBytes = artifacts.reduce(
		(sum, artifact) => sum + artifact.size,
		0,
	);
	for (const artifact of artifacts) {
		const expired = now - artifact.createdAt >= maxAgeMs;
		const overBudget = remainingBytes > aggregateMaxBytes;
		if (!options.clearAll && !expired && !overBudget) continue;
		try {
			// Re-check immediately before deletion to defeat a file-to-symlink swap.
			const metadata = await lstat(artifact.path);
			if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
			await unlink(artifact.path);
			deleted.push(artifact.name);
			remainingBytes -= artifact.size;
		} catch {
			failed.push(artifact.name);
		}
	}
	return { deleted, failed, remainingBytes };
}

/** Enforce one age and aggregate budget across readable segments and Crashpad dumps. */
export async function cleanupDiagnosticArtifacts(
	directory: string,
	options: {
		crashpadDirectory?: string;
		now?: number;
		maxAgeMs?: number;
		aggregateMaxBytes?: number;
		activePath?: string;
		clearAll?: boolean;
	} = {},
): Promise<CleanupResult> {
	const now = options.now ?? Date.now();
	const maxAgeMs = options.maxAgeMs ?? ARTIFACT_MAX_AGE_MS;
	const aggregateMaxBytes =
		options.aggregateMaxBytes ?? ARTIFACT_AGGREGATE_MAX_BYTES;
	const readable = await listManagedArtifacts(directory, options.activePath);
	const crashpad = options.crashpadDirectory
		? await listCrashpadArtifacts(options.crashpadDirectory)
		: [];
	const artifacts = [...readable, ...crashpad].sort(
		(a, b) => a.createdAt - b.createdAt,
	);
	const deleted: string[] = [];
	const failed: string[] = [];
	let remainingBytes = artifacts.reduce(
		(sum, artifact) => sum + artifact.size,
		0,
	);
	for (const artifact of artifacts) {
		if (
			!options.clearAll &&
			now - artifact.createdAt < maxAgeMs &&
			remainingBytes <= aggregateMaxBytes
		)
			continue;
		try {
			const metadata = await lstat(artifact.path);
			if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
			await unlink(artifact.path);
			deleted.push(artifact.name);
			remainingBytes -= artifact.size;
		} catch {
			failed.push(artifact.name);
		}
	}
	return { deleted, failed, remainingBytes };
}

interface OpenSegment {
	handle: Awaited<ReturnType<typeof open>>;
	path: string;
	createdAt: number;
	size: number;
}

export interface SegmentedWriterOptions {
	directory: string;
	crashpadDirectory?: string;
	launchId: string;
	now?: () => number;
	segmentMaxBytes?: number;
	segmentMaxAgeMs?: number;
	retentionMaxAgeMs?: number;
	aggregateMaxBytes?: number;
	warningIntervalMs?: number;
	onWarning?: (message: string) => void;
}

/** Single-queue JSONL persistence. Write failures are bounded and never escape write(). */
export class SegmentedJsonlWriter {
	private active?: OpenSegment;
	private sequence = 0;
	private queue: Promise<void> = Promise.resolve();
	private initialized = false;
	private available = false;
	private nextInitializationAttemptAt = Number.NEGATIVE_INFINITY;
	private closed = false;
	private lastWarningAt = Number.NEGATIVE_INFINITY;

	constructor(private readonly options: SegmentedWriterOptions) {}

	async initialize(): Promise<void> {
		if (this.available) return;
		const now = (this.options.now ?? Date.now)();
		if (this.initialized && now < this.nextInitializationAttemptAt) return;
		this.initialized = true;
		try {
			await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
			await ensurePrivateDiagnosticsDirectory(this.options.directory);
			const result = await this.cleanup();
			if (result.failed.length > 0)
				this.warn(
					`diagnostic cleanup could not remove ${result.failed.length} artifact(s)`,
				);
			this.available = true;
		} catch (error) {
			this.available = false;
			this.nextInitializationAttemptAt =
				now + (this.options.warningIntervalMs ?? 30_000);
			this.warn(`diagnostic initialization failed: ${safeErrorString(error)}`);
		}
	}

	write(input: DiagnosticEventInput): Promise<void> {
		const operation = this.queue.then(async () => {
			if (this.closed) return;
			try {
				if (!this.available) await this.initialize();
				if (!this.available) return;
				const event = normalizeDiagnosticEvent(input, this.options.launchId, {
					now: this.options.now,
				});
				const line = encodeDiagnosticEvent(event);
				await this.writeLine(line);
			} catch (error) {
				this.warn(`diagnostic write failed: ${safeErrorString(error)}`);
			}
		});
		this.queue = operation.catch(() => undefined);
		return operation;
	}

	rotate(): Promise<void> {
		const operation = this.queue
			.then(async () => {
				await this.closeActive();
				const result = await this.cleanup();
				if (result.failed.length > 0)
					this.warn(
						`diagnostic cleanup could not remove ${result.failed.length} artifact(s)`,
					);
			})
			.catch((error) =>
				this.warn(`diagnostic rotation failed: ${safeErrorString(error)}`),
			);
		this.queue = operation;
		return operation;
	}

	cleanup(): Promise<CleanupResult> {
		return cleanupDiagnosticArtifacts(this.options.directory, {
			crashpadDirectory: this.options.crashpadDirectory,
			now: (this.options.now ?? Date.now)(),
			maxAgeMs: this.options.retentionMaxAgeMs,
			aggregateMaxBytes: this.options.aggregateMaxBytes,
			activePath: this.active?.path,
		});
	}

	clear(): Promise<void> {
		const operation = this.queue
			.then(async () => {
				await this.closeActive();
				const result = await cleanupDiagnosticArtifacts(
					this.options.directory,
					{
						crashpadDirectory: this.options.crashpadDirectory,
						now: (this.options.now ?? Date.now)(),
						activePath: this.active?.path,
						clearAll: true,
					},
				);
				if (result.failed.length > 0)
					this.warn(
						`diagnostic clear could not remove ${result.failed.length} artifact(s)`,
					);
			})
			.catch((error) =>
				this.warn(`diagnostic clear failed: ${safeErrorString(error)}`),
			);
		this.queue = operation;
		return operation;
	}

	close(): Promise<void> {
		const operation = this.queue
			.then(async () => {
				await this.closeActive();
				this.closed = true;
			})
			.catch((error) =>
				this.warn(`diagnostic close failed: ${safeErrorString(error)}`),
			);
		this.queue = operation;
		return operation;
	}

	getActivePath(): string | undefined {
		return this.active?.path;
	}

	private async writeLine(line: string): Promise<void> {
		const bytes = Buffer.from(line, 'utf8');
		const now = (this.options.now ?? Date.now)();
		if (
			this.active &&
			(now - this.active.createdAt >=
				(this.options.segmentMaxAgeMs ?? SEGMENT_MAX_AGE_MS) ||
				this.active.size + bytes.length >
					(this.options.segmentMaxBytes ?? SEGMENT_MAX_BYTES))
		) {
			await this.closeActive();
			const result = await this.cleanup();
			if (result.failed.length > 0)
				this.warn(
					`diagnostic cleanup could not remove ${result.failed.length} artifact(s)`,
				);
		}
		if (!this.active) this.active = await this.openSegment(now);
		let offset = 0;
		while (offset < bytes.length) {
			const result = await this.active.handle.write(
				bytes,
				offset,
				bytes.length - offset,
				null,
			);
			if (result.bytesWritten <= 0)
				throw new Error('zero-byte diagnostic write');
			offset += result.bytesWritten;
		}
		this.active.size += bytes.length;
	}

	private async openSegment(createdAt: number): Promise<OpenSegment> {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const sequence = this.sequence++ % 10_000;
			const safeLaunchId =
				this.options.launchId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) ||
				'launch';
			const name = `terminay-diagnostics-v1-${createdAt}-${safeLaunchId}-${sequence.toString().padStart(4, '0')}.jsonl`;
			const path = join(this.options.directory, name);
			try {
				const flags =
					fsConstants.O_CREAT |
					fsConstants.O_EXCL |
					fsConstants.O_WRONLY |
					(typeof fsConstants.O_NOFOLLOW === 'number'
						? fsConstants.O_NOFOLLOW
						: 0);
				const handle = await open(path, flags, 0o600);
				return { handle, path, createdAt, size: 0 };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			}
		}
		throw new Error('could not allocate a unique diagnostic segment');
	}

	private async closeActive(): Promise<void> {
		const active = this.active;
		this.active = undefined;
		if (!active) return;
		await active.handle.sync().catch(() => undefined);
		await active.handle.close();
	}

	private warn(message: string): void {
		const now = (this.options.now ?? Date.now)();
		if (now - this.lastWarningAt < (this.options.warningIntervalMs ?? 30_000))
			return;
		this.lastWarningAt = now;
		const safe = normalizeString(message, 1024).text.replace(/[\r\n]+/g, ' ');
		if (this.options.onWarning) this.options.onWarning(safe);
		else process.stderr.write(`[Terminay diagnostics] ${safe}\n`);
	}
}

export interface LaunchMarker {
	schemaVersion: 1;
	launchId: string;
	startedAt: string;
	state: 'active' | 'clean';
	endedAt?: string;
}

async function readLaunchMarker(
	path: string,
): Promise<LaunchMarker | undefined> {
	try {
		const metadata = await lstat(path);
		if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096)
			return undefined;
		const parsed = JSON.parse(
			await readFile(path, 'utf8'),
		) as Partial<LaunchMarker>;
		if (
			parsed.schemaVersion !== 1 ||
			typeof parsed.launchId !== 'string' ||
			(parsed.state !== 'active' && parsed.state !== 'clean')
		)
			return undefined;
		return parsed as LaunchMarker;
	} catch {
		return undefined;
	}
}

async function atomicWritePrivateJson(
	path: string,
	value: unknown,
): Promise<void> {
	const directory = resolve(path, '..');
	await ensurePrivateDiagnosticsDirectory(directory);
	const temporaryPath = join(
		directory,
		`.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
	);
	const flags =
		fsConstants.O_CREAT |
		fsConstants.O_EXCL |
		fsConstants.O_WRONLY |
		(typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0);
	try {
		const handle = await open(temporaryPath, flags, 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
			await handle.sync();
		} finally {
			await handle.close();
		}
		const destination = await lstat(path).catch(() => undefined);
		if (destination?.isSymbolicLink())
			throw new Error('launch marker destination is a symbolic link');
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

export async function beginLaunchMarker(
	directory: string,
	launchId: string,
	now = Date.now(),
): Promise<{
	previous?: LaunchMarker;
	previousInterrupted: boolean;
	current: LaunchMarker;
}> {
	const path = join(directory, LAUNCH_MARKER_FILENAME);
	const previous = await readLaunchMarker(path);
	const current: LaunchMarker = {
		schemaVersion: 1,
		launchId: normalizeString(launchId, 128).text,
		startedAt: new Date(now).toISOString(),
		state: 'active',
	};
	await atomicWritePrivateJson(path, current);
	return {
		previous,
		previousInterrupted: previous?.state === 'active',
		current,
	};
}

export async function completeLaunchMarker(
	directory: string,
	launchId: string,
	now = Date.now(),
): Promise<boolean> {
	const path = join(directory, LAUNCH_MARKER_FILENAME);
	const current = await readLaunchMarker(path);
	if (!current || current.launchId !== launchId || current.state !== 'active')
		return false;
	await atomicWritePrivateJson(path, {
		...current,
		state: 'clean',
		endedAt: new Date(now).toISOString(),
	});
	return true;
}

/** Used by tests and diagnostics UI without exposing the path to a renderer. */
export async function readCurrentLaunchMarker(
	directory: string,
): Promise<LaunchMarker | undefined> {
	return readLaunchMarker(join(directory, LAUNCH_MARKER_FILENAME));
}

/** Validate directory permissions after mkdir on platforms that support POSIX modes. */
export async function ensurePrivateDiagnosticsDirectory(
	directory: string,
): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const metadata = await lstat(directory);
	if (!metadata.isDirectory() || metadata.isSymbolicLink())
		throw new Error('diagnostics path is not a directory');
	if (process.platform !== 'win32') await chmod(directory, 0o700);
}
