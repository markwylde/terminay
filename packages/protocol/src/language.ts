import type { JsonValue } from './errors.js';
import type { ProtocolId } from './types.js';

/** Hello capability advertised by a server that hosts language sessions. */
export const LANGUAGE_CAPABILITY = 'language.v1' as const;

/** Core-owned language operations. Extensions never register these; the
 * server resolves paths and forwards to the session behind them. */
export const LANGUAGE_OPERATIONS = Object.freeze({
	capabilities: 'language.capabilities',
	documentOpen: 'language.document.open',
	documentChange: 'language.document.change',
	documentClose: 'language.document.close',
	completion: 'language.completion',
	hover: 'language.hover',
	definition: 'language.definition',
	diagnosticsEvent: 'language.diagnostics',
} as const);

/** Per-operation result caps. Results are truncated server-side and marked,
 * never left to the frame limit. */
export const MAX_LANGUAGE_RESULT_BYTES = 256 * 1024;
export const MAX_LANGUAGE_COMPLETION_ITEMS = 200;
export const MAX_LANGUAGE_DIAGNOSTICS_PER_FILE = 500;
export const MAX_LANGUAGE_DEFINITION_LOCATIONS = 50;
/** Largest document text a client may open or change in one request. */
export const MAX_LANGUAGE_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_LANGUAGE_PATH_LENGTH = 4096;

export interface LanguagePosition {
	/** Zero-based line. */
	readonly line: number;
	/** Zero-based UTF-16 character offset within the line. */
	readonly character: number;
}

export interface LanguageRange {
	readonly start: LanguagePosition;
	readonly end: LanguagePosition;
}

/** Identifies one document of one project at one client revision. */
export interface LanguageDocumentRef {
	readonly projectId: ProtocolId;
	/** Project-relative POSIX path. Never a host path. */
	readonly path: string;
	/** Client-owned monotonically increasing document revision. */
	readonly revision: number;
}

export type LanguageSessionState = 'none' | 'starting' | 'ready' | 'unavailable';

export interface LanguageFeatureSet {
	readonly completion: boolean;
	readonly hover: boolean;
	readonly definition: boolean;
	readonly diagnostics: boolean;
}

export interface LanguageCapabilitiesDto {
	readonly projectId: ProtocolId;
	readonly path: string;
	/** Absent when no installed language server serves this file. */
	readonly languageServerId?: string;
	readonly languageId?: string;
	readonly state: LanguageSessionState;
	/** Why the session is `unavailable`, from a fixed vocabulary the server
	 * chooses: `launch-failed`, `crashed`, `stopped`, or `capacity`. The
	 * underlying failure text can name host paths and never crosses the wire,
	 * so a client shows this as a code, not as a message. */
	readonly reason?: string;
	readonly features: LanguageFeatureSet;
}

export type LanguageCompletionKind =
	| 'text' | 'method' | 'function' | 'constructor' | 'field' | 'variable' | 'class'
	| 'interface' | 'module' | 'property' | 'unit' | 'value' | 'enum' | 'keyword'
	| 'snippet' | 'color' | 'file' | 'reference' | 'folder' | 'enumMember'
	| 'constant' | 'struct' | 'event' | 'operator' | 'typeParameter';

export interface LanguageCompletionItemDto {
	readonly label: string;
	readonly kind?: LanguageCompletionKind;
	readonly detail?: string;
	/** Plain text to insert; defaults to the label. */
	readonly insertText?: string;
	readonly sortText?: string;
	readonly filterText?: string;
	/** Markdown documentation, bounded by the result cap. */
	readonly documentation?: string;
}

export interface LanguageCompletionResultDto extends LanguageDocumentRef {
	readonly items: readonly LanguageCompletionItemDto[];
	readonly isIncomplete: boolean;
	readonly isTruncated: boolean;
}

export interface LanguageHoverResultDto extends LanguageDocumentRef {
	/** Markdown, or null when nothing is known at the position. */
	readonly contents: string | null;
	readonly range?: LanguageRange;
	readonly isTruncated: boolean;
}

export interface LanguageLocationDto {
	/** Project-relative path of the target file. */
	readonly path: string;
	readonly range: LanguageRange;
}

export interface LanguageDefinitionResultDto extends LanguageDocumentRef {
	readonly locations: readonly LanguageLocationDto[];
	readonly isTruncated: boolean;
}

export type LanguageDiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface LanguageDiagnosticDto {
	readonly range: LanguageRange;
	readonly severity: LanguageDiagnosticSeverity;
	readonly message: string;
	readonly code?: string;
	readonly source?: string;
}

/** Payload of the `language.diagnostics` journal event. */
export interface LanguageDiagnosticsEventDto {
	readonly serverId?: ProtocolId;
	readonly projectId: ProtocolId;
	readonly path: string;
	/** The client revision the diagnostics were computed against, when the
	 * document is open; absent for files the session read from disk. */
	readonly revision?: number;
	readonly diagnostics: readonly LanguageDiagnosticDto[];
	readonly isTruncated: boolean;
}

export interface LanguageDocumentOpenRequest extends LanguageDocumentRef {
	readonly languageId: string;
	readonly text: string;
}

export interface LanguageDocumentChangeRequest extends LanguageDocumentRef {
	readonly text: string;
}

export interface LanguagePositionRequest extends LanguageDocumentRef {
	readonly position: LanguagePosition;
}

const COMPLETION_KINDS: ReadonlySet<string> = new Set<LanguageCompletionKind>([
	'text', 'method', 'function', 'constructor', 'field', 'variable', 'class',
	'interface', 'module', 'property', 'unit', 'value', 'enum', 'keyword',
	'snippet', 'color', 'file', 'reference', 'folder', 'enumMember',
	'constant', 'struct', 'event', 'operator', 'typeParameter',
]);
const SEVERITIES: ReadonlySet<string> = new Set(['error', 'warning', 'information', 'hint']);
const STATES: ReadonlySet<string> = new Set(['none', 'starting', 'ready', 'unavailable']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isBoundedId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === 'string';
}

/** A project-relative path: POSIX separators, no absolute prefix, no escape. */
export function isLanguagePath(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LANGUAGE_PATH_LENGTH) return false;
	if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:/u.test(value)) return false;
	if (value.includes('\0') || value.includes('\\')) return false;
	return !value.split('/').some((segment) => segment === '..' || segment === '');
}

export function parseLanguagePosition(value: unknown): LanguagePosition {
	if (!isRecord(value) || !isNonNegativeInteger(value.line) || !isNonNegativeInteger(value.character))
		throw new TypeError('invalid language position');
	return { line: value.line, character: value.character };
}

export function parseLanguageRange(value: unknown): LanguageRange {
	if (!isRecord(value)) throw new TypeError('invalid language range');
	const start = parseLanguagePosition(value.start);
	const end = parseLanguagePosition(value.end);
	if (end.line < start.line || (end.line === start.line && end.character < start.character))
		throw new TypeError('invalid language range');
	return { start, end };
}

export function parseLanguageDocumentRef(value: unknown): LanguageDocumentRef {
	if (!isRecord(value) || !isBoundedId(value.projectId) || !isLanguagePath(value.path) || !isNonNegativeInteger(value.revision))
		throw new TypeError('invalid language document reference');
	return { projectId: value.projectId, path: value.path, revision: value.revision };
}

export function parseLanguagePositionRequest(value: unknown): LanguagePositionRequest {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value)) throw new TypeError('invalid language request');
	return { ...ref, position: parseLanguagePosition(value.position) };
}

function parseDocumentText(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('language document text must be a string');
	if (new TextEncoder().encode(value).byteLength > MAX_LANGUAGE_DOCUMENT_BYTES)
		throw new RangeError('language document exceeds the size limit');
	return value;
}

export function parseLanguageDocumentOpenRequest(value: unknown): LanguageDocumentOpenRequest {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value) || typeof value.languageId !== 'string' || value.languageId.length === 0 || value.languageId.length > 64)
		throw new TypeError('invalid language document open request');
	return { ...ref, languageId: value.languageId, text: parseDocumentText(value.text) };
}

export function parseLanguageDocumentChangeRequest(value: unknown): LanguageDocumentChangeRequest {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value)) throw new TypeError('invalid language document change request');
	return { ...ref, text: parseDocumentText(value.text) };
}

function parseFeatureSet(value: unknown): LanguageFeatureSet {
	if (!isRecord(value)) throw new TypeError('invalid language feature set');
	const flag = (key: keyof LanguageFeatureSet): boolean => value[key] === true;
	return { completion: flag('completion'), hover: flag('hover'), definition: flag('definition'), diagnostics: flag('diagnostics') };
}

export function parseLanguageCapabilitiesDto(value: unknown): LanguageCapabilitiesDto {
	if (!isRecord(value) || !isBoundedId(value.projectId) || !isLanguagePath(value.path)
		|| typeof value.state !== 'string' || !STATES.has(value.state)
		|| !isOptionalString(value.languageServerId) || !isOptionalString(value.languageId) || !isOptionalString(value.reason))
		throw new TypeError('invalid language capabilities');
	return {
		projectId: value.projectId,
		path: value.path,
		...(value.languageServerId === undefined ? {} : { languageServerId: value.languageServerId }),
		...(value.languageId === undefined ? {} : { languageId: value.languageId }),
		state: value.state as LanguageSessionState,
		...(value.reason === undefined ? {} : { reason: value.reason }),
		features: parseFeatureSet(value.features),
	};
}

function parseCompletionItem(value: unknown): LanguageCompletionItemDto {
	if (!isRecord(value) || typeof value.label !== 'string' || value.label.length === 0
		|| (value.kind !== undefined && (typeof value.kind !== 'string' || !COMPLETION_KINDS.has(value.kind)))
		|| !isOptionalString(value.detail) || !isOptionalString(value.insertText) || !isOptionalString(value.sortText)
		|| !isOptionalString(value.filterText) || !isOptionalString(value.documentation))
		throw new TypeError('invalid language completion item');
	return {
		label: value.label,
		...(value.kind === undefined ? {} : { kind: value.kind as LanguageCompletionKind }),
		...(value.detail === undefined ? {} : { detail: value.detail }),
		...(value.insertText === undefined ? {} : { insertText: value.insertText }),
		...(value.sortText === undefined ? {} : { sortText: value.sortText }),
		...(value.filterText === undefined ? {} : { filterText: value.filterText }),
		...(value.documentation === undefined ? {} : { documentation: value.documentation }),
	};
}

export function parseLanguageCompletionResultDto(value: unknown): LanguageCompletionResultDto {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > MAX_LANGUAGE_COMPLETION_ITEMS
		|| typeof value.isIncomplete !== 'boolean' || typeof value.isTruncated !== 'boolean')
		throw new TypeError('invalid language completion result');
	return { ...ref, items: value.items.map(parseCompletionItem), isIncomplete: value.isIncomplete, isTruncated: value.isTruncated };
}

export function parseLanguageHoverResultDto(value: unknown): LanguageHoverResultDto {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value) || (value.contents !== null && typeof value.contents !== 'string') || typeof value.isTruncated !== 'boolean')
		throw new TypeError('invalid language hover result');
	return {
		...ref,
		contents: value.contents as string | null,
		...(value.range === undefined ? {} : { range: parseLanguageRange(value.range) }),
		isTruncated: value.isTruncated,
	};
}

function parseLocation(value: unknown): LanguageLocationDto {
	if (!isRecord(value) || !isLanguagePath(value.path)) throw new TypeError('invalid language location');
	return { path: value.path, range: parseLanguageRange(value.range) };
}

export function parseLanguageDefinitionResultDto(value: unknown): LanguageDefinitionResultDto {
	const ref = parseLanguageDocumentRef(value);
	if (!isRecord(value) || !Array.isArray(value.locations) || value.locations.length > MAX_LANGUAGE_DEFINITION_LOCATIONS
		|| typeof value.isTruncated !== 'boolean')
		throw new TypeError('invalid language definition result');
	return { ...ref, locations: value.locations.map(parseLocation), isTruncated: value.isTruncated };
}

export function parseLanguageDiagnosticDto(value: unknown): LanguageDiagnosticDto {
	if (!isRecord(value) || typeof value.message !== 'string' || typeof value.severity !== 'string' || !SEVERITIES.has(value.severity)
		|| !isOptionalString(value.code) || !isOptionalString(value.source))
		throw new TypeError('invalid language diagnostic');
	return {
		range: parseLanguageRange(value.range),
		severity: value.severity as LanguageDiagnosticSeverity,
		message: value.message,
		...(value.code === undefined ? {} : { code: value.code }),
		...(value.source === undefined ? {} : { source: value.source }),
	};
}

export function parseLanguageDiagnosticsEventDto(value: unknown): LanguageDiagnosticsEventDto {
	if (!isRecord(value) || !isBoundedId(value.projectId) || !isLanguagePath(value.path)
		|| (value.serverId !== undefined && !isBoundedId(value.serverId))
		|| (value.revision !== undefined && !isNonNegativeInteger(value.revision))
		|| !Array.isArray(value.diagnostics) || value.diagnostics.length > MAX_LANGUAGE_DIAGNOSTICS_PER_FILE
		|| typeof value.isTruncated !== 'boolean')
		throw new TypeError('invalid language diagnostics event');
	return {
		...(value.serverId === undefined ? {} : { serverId: value.serverId }),
		projectId: value.projectId,
		path: value.path,
		...(value.revision === undefined ? {} : { revision: value.revision }),
		diagnostics: value.diagnostics.map(parseLanguageDiagnosticDto),
		isTruncated: value.isTruncated,
	};
}

/** Truncates a JSON-serialisable result to the language byte cap by dropping
 * trailing items from `key`, marking the result. Callers pass the array key.
 * A result that is still over the cap with no items left is returned empty and
 * marked truncated: a client is better served by a marked empty answer than by
 * a thrown request. */
export function truncateLanguageResult<T extends Record<string, JsonValue> & { readonly isTruncated: boolean }>(
	result: T,
	key: keyof T & string,
	maxBytes = MAX_LANGUAGE_RESULT_BYTES,
): T {
	const encoder = new TextEncoder();
	let current = result;
	while (encoder.encode(JSON.stringify(current)).byteLength > maxBytes) {
		const items = current[key];
		if (!Array.isArray(items) || items.length === 0) {
			return { ...current, [key]: [], isTruncated: true } as T;
		}
		current = { ...current, [key]: items.slice(0, Math.max(0, Math.floor(items.length / 2))), isTruncated: true };
	}
	return current;
}
