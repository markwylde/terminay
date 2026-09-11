import type {
	LanguageDiagnosticDto,
	LanguagePosition,
} from '@terminay/protocol';

/**
 * The private host/child contract for language sessions.
 *
 * Core owns the application-protocol `language.*` operations; these are the
 * matching private invocations the host makes on the extension child, plus the
 * two notifications the child raises on its own. Every message is validated
 * against a closed schema on both sides: the child is trusted code, but a
 * malformed frame is a protocol disagreement, not input to act on.
 */
export const EXTENSION_LANGUAGE_METHODS = Object.freeze([
	'language.session.start',
	'language.session.stop',
	'language.document.open',
	'language.document.change',
	'language.document.close',
	'language.completion',
	'language.hover',
	'language.definition',
	'language.watched-files.changed',
] as const);

export type ExtensionLanguageMethod =
	(typeof EXTENSION_LANGUAGE_METHODS)[number];

export interface ExtensionLanguageRequest {
	readonly method: ExtensionLanguageMethod;
	readonly input: Record<string, unknown>;
}

export type ExtensionLanguageWatchedFileKind = 'created' | 'changed' | 'deleted';

export interface ExtensionLanguageDiagnosticsNotification {
	readonly sessionId: string;
	readonly path: string;
	readonly revision?: number;
	readonly diagnostics: readonly LanguageDiagnosticDto[];
	readonly isTruncated: boolean;
}

export type ExtensionLanguageSessionExitReason =
	| 'exited'
	| 'start-failed'
	| 'stopped';

export interface ExtensionLanguageSessionExit {
	readonly sessionId: string;
	readonly languageServerId: string;
	readonly reason: ExtensionLanguageSessionExitReason;
	readonly exitCode?: number;
	readonly signal?: string;
	readonly failure?: string;
}

/** How many diagnostics one notification may carry before the host rejects it.
 * Core's per-file cap is the same number; the child truncates and marks. */
export const MAX_EXTENSION_LANGUAGE_DIAGNOSTICS = 500;
const MAX_ID_LENGTH = 200;
const MAX_PATH_LENGTH = 4096;
const MAX_MESSAGE_LENGTH = 4096;
const SEVERITIES = new Set(['error', 'warning', 'information', 'hint']);

export function parseExtensionLanguageRequest(
	value: unknown,
): ExtensionLanguageRequest | undefined {
	const payload = record(value);
	const method = payload?.method;
	const input = record(payload?.input);
	if (
		typeof method !== 'string' ||
		!(EXTENSION_LANGUAGE_METHODS as readonly string[]).includes(method) ||
		input === undefined
	)
		return undefined;
	return Object.freeze({
		method: method as ExtensionLanguageMethod,
		input,
	});
}

export function parseExtensionLanguageDiagnostics(
	value: unknown,
): ExtensionLanguageDiagnosticsNotification | undefined {
	const payload = record(value);
	if (payload === undefined) return undefined;
	if (
		!boundedId(payload.sessionId) ||
		!relativePath(payload.path) ||
		typeof payload.isTruncated !== 'boolean' ||
		!Array.isArray(payload.diagnostics) ||
		payload.diagnostics.length > MAX_EXTENSION_LANGUAGE_DIAGNOSTICS ||
		(payload.revision !== undefined && !nonNegativeInteger(payload.revision))
	)
		return undefined;
	const diagnostics: LanguageDiagnosticDto[] = [];
	for (const entry of payload.diagnostics) {
		const diagnostic = parseDiagnostic(entry);
		if (diagnostic === undefined) return undefined;
		diagnostics.push(diagnostic);
	}
	return Object.freeze({
		sessionId: payload.sessionId as string,
		path: payload.path as string,
		...(payload.revision === undefined
			? {}
			: { revision: payload.revision as number }),
		diagnostics: Object.freeze(diagnostics),
		isTruncated: payload.isTruncated,
	});
}

export function parseExtensionLanguageSessionExit(
	value: unknown,
): ExtensionLanguageSessionExit | undefined {
	const payload = record(value);
	if (payload === undefined) return undefined;
	const reason = payload.reason;
	if (
		!boundedId(payload.sessionId) ||
		!boundedId(payload.languageServerId) ||
		typeof reason !== 'string' ||
		!['exited', 'start-failed', 'stopped'].includes(reason) ||
		(payload.exitCode !== undefined &&
			(typeof payload.exitCode !== 'number' ||
				!Number.isInteger(payload.exitCode))) ||
		(payload.signal !== undefined &&
			(typeof payload.signal !== 'string' || payload.signal.length > 32)) ||
		(payload.failure !== undefined &&
			(typeof payload.failure !== 'string' ||
				payload.failure.length > MAX_MESSAGE_LENGTH))
	)
		return undefined;
	return Object.freeze({
		sessionId: payload.sessionId as string,
		languageServerId: payload.languageServerId as string,
		reason: reason as ExtensionLanguageSessionExitReason,
		...(payload.exitCode === undefined
			? {}
			: { exitCode: payload.exitCode as number }),
		...(payload.signal === undefined
			? {}
			: { signal: payload.signal as string }),
		...(payload.failure === undefined
			? {}
			: { failure: payload.failure as string }),
	});
}

export function parseExtensionLanguagePosition(
	value: unknown,
): LanguagePosition | undefined {
	const position = record(value);
	if (
		position === undefined ||
		!nonNegativeInteger(position.line) ||
		!nonNegativeInteger(position.character)
	)
		return undefined;
	return Object.freeze({
		line: position.line as number,
		character: position.character as number,
	});
}

function parseDiagnostic(value: unknown): LanguageDiagnosticDto | undefined {
	const diagnostic = record(value);
	const range = parseRange(diagnostic?.range);
	if (
		diagnostic === undefined ||
		range === undefined ||
		typeof diagnostic.message !== 'string' ||
		diagnostic.message.length > MAX_MESSAGE_LENGTH ||
		typeof diagnostic.severity !== 'string' ||
		!SEVERITIES.has(diagnostic.severity) ||
		!optionalText(diagnostic.code) ||
		!optionalText(diagnostic.source)
	)
		return undefined;
	return Object.freeze({
		range,
		severity: diagnostic.severity as LanguageDiagnosticDto['severity'],
		message: diagnostic.message,
		...(diagnostic.code === undefined
			? {}
			: { code: diagnostic.code as string }),
		...(diagnostic.source === undefined
			? {}
			: { source: diagnostic.source as string }),
	});
}

function parseRange(value: unknown): LanguageDiagnosticDto['range'] | undefined {
	const range = record(value);
	const start = parseExtensionLanguagePosition(range?.start);
	const end = parseExtensionLanguagePosition(range?.end);
	if (start === undefined || end === undefined) return undefined;
	return Object.freeze({ start, end });
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
function boundedId(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_ID_LENGTH &&
		!value.includes('\0')
	);
}
function relativePath(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PATH_LENGTH &&
		!value.startsWith('/') &&
		!value.includes('\0') &&
		!value.includes('\\') &&
		!value.split('/').some((segment) => segment === '..' || segment === '')
	);
}
function nonNegativeInteger(value: unknown): boolean {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function optionalText(value: unknown): boolean {
	return (
		value === undefined ||
		(typeof value === 'string' && value.length <= MAX_MESSAGE_LENGTH)
	);
}
