import { botFailure } from './botService/failure.js';
import { createHash } from 'node:crypto';
import {
	type AuthScope,
	canonicalize,
	type CommandResultEnvelope,
	DEFAULT_PROTOCOL_LIMITS,
	type JsonValue,
	type ProtocolError,
	type ProtocolId,
	type QueryResultEnvelope,
	validateEnvelope,
} from '@terminay/protocol';
import {
	forbiddenError,
	scopeAllows,
	unknownOperationError,
	validateIdentity,
} from './auth.js';
import { FileServiceError } from './fileService/types.js';
import { GitServiceError } from './gitService/types.js';
import { TerminalServiceError } from './terminalService/errors.js';
import type {
	BinaryQueryHandlerResult,
	CommandHandler,
	CommandRequest,
	OperationPolicy,
	OperationRegistries,
	QueryHandler,
	QueryRequest,
	RequestContext,
} from './types.js';

/** The transport-neutral operation boundary shared by framed and HTTP clients. */
export interface OperationDispatcher {
	readonly query: (request: QueryRequest) => Promise<QueryDispatchResult>;
	readonly command: (request: CommandRequest) => Promise<CommandResultEnvelope>;
	readonly commandWithOutcome: (request: CommandRequest) => Promise<CommandDispatchResult>;
}

export interface CommandDispatchResult {
	readonly envelope: CommandResultEnvelope;
	/** Only the first execution may commit connection delivery side effects. */
	readonly executed: boolean;
}

interface CommandEntry {
	readonly fingerprint: string;
	readonly completion: Promise<CommandResultEnvelope>;
	result?: CommandResultEnvelope;
}
interface ConnectionCommandLedger {
	readonly entries: Map<ProtocolId, CommandEntry>;
	pending: number;
}

export interface QueryDispatchResult {
	readonly envelope: QueryResultEnvelope;
	readonly body: Uint8Array;
}

export interface OperationDispatcherOptions extends OperationRegistries {
	readonly defaultQueryScope?: AuthScope;
	readonly defaultCommandScope?: AuthScope;
	readonly maxBodyBytes?: number;
}

const MAX_DISPATCHERS = 256;
const MAX_COMMAND_OUTCOMES = 4096;
const MAX_PENDING_COMMANDS = 64;

/**
 * Create the canonical query/command dispatcher.  Transports provide only a
 * validated envelope, bounded body, and authenticated request context; scope,
 * operation lookup, cancellation, deadlines, and command idempotency remain
 * server-owned here.
 */
export function createOperationDispatcher(
	options: OperationDispatcherOptions = {},
): OperationDispatcher {
	const maxBodyBytes =
		options.maxBodyBytes ?? DEFAULT_PROTOCOL_LIMITS.maxBodyBytes;
	if (
		!Number.isSafeInteger(maxBodyBytes) ||
		maxBodyBytes <= 0 ||
		maxBodyBytes > DEFAULT_PROTOCOL_LIMITS.maxBodyBytes
	)
		throw new RangeError('maxBodyBytes is invalid');
	const queryLookup = makeLookup<QueryHandler>(options.queries);
	const commandLookup = makeLookup<CommandHandler>(options.commands);
	const policyLookup = makeLookup<OperationPolicy>(options.policies);
	const ledgers = new Map<ProtocolId, ConnectionCommandLedger>();

	const query = async (request: QueryRequest): Promise<QueryDispatchResult> => {
		const { envelope } = request;
		validateRequestContext(request.context);
		if (request.body.byteLength > maxBodyBytes)
			return queryEnvelope({
				type: 'query_result',
				queryId: envelope.queryId,
				ok: false,
				error: resourceError('query body exceeds the server limit'),
			});
		const policy = policyLookup(envelope.operation);
		const handler = queryLookup(envelope.operation) ?? policy?.query;
		if (handler === undefined)
			return queryEnvelope({
				type: 'query_result',
				queryId: envelope.queryId,
				ok: false,
				error: unknownOperationError(envelope.operation),
			});
		const required = policy?.scope ?? options.defaultQueryScope;
		if (
			required !== undefined &&
			!scopeAllows(request.context.authScope, required)
		)
			return queryEnvelope({
				type: 'query_result',
				queryId: envelope.queryId,
				ok: false,
				error: forbiddenError(envelope.operation, required),
			});
		try {
			const value = await invoke(handler, request);
			if (isBinaryQueryResult(value)) {
				if (value.body.byteLength > maxBodyBytes)
					return queryEnvelope({
						type: 'query_result',
						queryId: envelope.queryId,
						ok: false,
						error: resourceError('query result body exceeds the server limit'),
					});
				return {
					envelope: {
						type: 'query_result',
						queryId: envelope.queryId,
						ok: true,
						result: value.result,
						bodyLength: value.body.byteLength,
					},
					body: value.body,
				};
			}
			return queryEnvelope({
				type: 'query_result',
				queryId: envelope.queryId,
				ok: true,
				result: value,
			});
		} catch (error) {
			return queryEnvelope({
				type: 'query_result',
				queryId: envelope.queryId,
				ok: false,
				error: dispatchError(error, 'query failed'),
			});
		}
	};

	const commandWithOutcome = async (
		request: CommandRequest,
	): Promise<CommandDispatchResult> => {
		const { envelope } = request;
		validateRequestContext(request.context);
		const refused = (error: ProtocolError): CommandDispatchResult => ({
			envelope: { type: 'command_result', commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error },
			executed: false,
		});
		if (request.body.byteLength > maxBodyBytes)
			return refused(resourceError('command body exceeds the server limit'));
		let ledger = ledgers.get(request.context.connectionId);
		if (ledger === undefined) {
			if (ledgers.size >= MAX_DISPATCHERS) {
				let retired: ProtocolId | undefined;
				for (const [id, candidate] of ledgers) { if (candidate.pending === 0) { retired = id; break; } }
				if (retired === undefined) return refused(resourceError('command ledger capacity reached'));
				ledgers.delete(retired);
			}
			ledger = { entries: new Map(), pending: 0 };
			ledgers.set(request.context.connectionId, ledger);
		}
		const fingerprint = createHash('sha256').update(canonicalize({
			operation: envelope.operation,
			payload: envelope.payload ?? null,
			expectedRevision: envelope.expectedRevision ?? null,
		})).update(request.body).digest('hex');
		const prior = ledger.entries.get(envelope.commandId);
		if (prior !== undefined) {
			if (prior.fingerprint !== fingerprint)
				return refused({ code: 'conflict', message: 'command identity was reused with different contents', retryable: false });
			try {
				const result = prior.result ?? await invoke(
					async () => await prior.completion as unknown as JsonValue,
					request,
				) as CommandResultEnvelope;
				return { envelope: { ...result, correlationId: envelope.correlationId }, executed: false };
			} catch (error) { return refused(dispatchError(error, 'command wait failed')); }
		}
		if (ledger.pending >= MAX_PENDING_COMMANDS)
			return refused(resourceError('in-flight command limit reached'));
		if (ledger.entries.size >= MAX_COMMAND_OUTCOMES) {
			let retired: ProtocolId | undefined;
			for (const [id, candidate] of ledger.entries) { if (candidate.result !== undefined) { retired = id; break; } }
			if (retired === undefined) return refused(resourceError('command outcome capacity reached'));
			ledger.entries.delete(retired);
		}
		let complete!: (result: CommandResultEnvelope) => void;
		const entry: CommandEntry = { fingerprint, completion: new Promise(resolve => { complete = resolve; }) };
		ledger.entries.set(envelope.commandId, entry);
		ledger.pending++;
		let result: CommandResultEnvelope = { type: 'command_result', commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: { code: 'internal', message: 'command handler boundary failed', retryable: false } };
		try {
			const policy = policyLookup(envelope.operation);
			const handler = commandLookup(envelope.operation) ?? policy?.command;
			if (handler === undefined)
				result = {
					type: 'command_result',
					commandId: envelope.commandId,
					correlationId: envelope.correlationId,
					ok: false,
					error: unknownOperationError(envelope.operation),
				};
			else {
				const required = policy?.scope ?? options.defaultCommandScope;
				if (
					required !== undefined &&
					!scopeAllows(request.context.authScope, required)
				)
					result = {
						type: 'command_result',
						commandId: envelope.commandId,
						correlationId: envelope.correlationId,
						ok: false,
						error: forbiddenError(envelope.operation, required),
					};
				else {
					try {
						const value = await invoke(handler, request);
						const normalized = asHandlerResult(value);
						result = {
							type: 'command_result',
							commandId: envelope.commandId,
							correlationId: envelope.correlationId,
							ok: true,
							...(normalized.result === undefined
								? {}
								: { result: normalized.result }),
							...(normalized.revision === undefined
								? {}
								: { revision: normalized.revision }),
						};
					} catch (error) {
						result = {
							type: 'command_result',
							commandId: envelope.commandId,
							correlationId: envelope.correlationId,
							ok: false,
							error: dispatchError(error, 'command failed'),
						};
					}
				}
			}
			try { validateEnvelope(result); } catch {
				result = { type: 'command_result', commandId: envelope.commandId, correlationId: envelope.correlationId, ok: false, error: { code: 'validation', message: 'command returned an invalid result', retryable: false } };
			}
		} catch {
			// Even an unexpected policy/registry error must settle deduplicated waiters.
		} finally {
			entry.result = result;
			ledger.pending--;
			complete(result);
		}
		return { envelope: result, executed: true };
	};

	return { query, command: async request => (await commandWithOutcome(request)).envelope, commandWithOutcome };
}

function queryEnvelope(envelope: QueryResultEnvelope): QueryDispatchResult {
	return { envelope, body: new Uint8Array() };
}
function isBinaryQueryResult(
	value: JsonValue | BinaryQueryHandlerResult,
): value is BinaryQueryHandlerResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		'body' in value &&
		value.body instanceof Uint8Array &&
		'result' in value
	);
}

function makeLookup<T>(
	collection: ReadonlyMap<string, T> | Record<string, T> | undefined,
): (key: string) => T | undefined {
	if (collection === undefined) return () => undefined;
	if (typeof (collection as ReadonlyMap<string, T>).get === 'function')
		return (key) => (collection as ReadonlyMap<string, T>).get(key);
	return (key) => (collection as Record<string, T>)[key];
}

function asHandlerResult(
	value:
		| JsonValue
		| { readonly result?: JsonValue; readonly revision?: number },
): { readonly result?: JsonValue; readonly revision?: number } {
	if (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		('result' in value || 'revision' in value)
	)
		return value as { result?: JsonValue; revision?: number };
	return { result: value as JsonValue };
}

async function invoke<T extends QueryHandler | CommandHandler>(
	handler: T,
	request: QueryRequest | CommandRequest,
): Promise<
	| JsonValue
	| BinaryQueryHandlerResult
	| { readonly result?: JsonValue; readonly revision?: number }
> {
	const parent = request.context.signal;
	if (parent.aborted) throw cancelledError();
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let removeAbort = (): void => undefined;
	let rejectAbort: ((error: ProtocolError) => void) | undefined;
	const interrupted = new Promise<never>((_, reject) => {
		rejectAbort = reject;
	});
	// Reject the caller before notifying the handler. A handler is allowed to
	// synchronously resolve from its abort listener; letting that resolution win
	// the race would turn a cancelled request into a successful result.
	const onAbort = (): void => {
		rejectAbort?.(cancelledError());
		controller.abort(parent.reason);
	};
	parent.addEventListener('abort', onAbort, { once: true });
	removeAbort = () => parent.removeEventListener('abort', onAbort);
	const remaining =
		request.context.deadline === undefined
			? undefined
			: request.context.deadline - Date.now();
	if (remaining !== undefined && remaining <= 0) {
		removeAbort();
		throw deadlineError();
	}
	if (remaining !== undefined) {
		timeout = setTimeout(() => {
			rejectAbort?.(deadlineError());
			controller.abort('deadline');
		}, remaining);
	}
	const boundedRequest = {
		...request,
		context: { ...request.context, signal: controller.signal },
	} as QueryRequest & CommandRequest;
	try {
		return await Promise.race([
			Promise.resolve(handler(boundedRequest as never)),
			interrupted,
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		removeAbort();
	}
}

function validateRequestContext(context: RequestContext): void {
	validateIdentity(context.clientId, context.authScope);
	if (
		context.deadline !== undefined &&
		(!Number.isSafeInteger(context.deadline) || context.deadline < 0)
	)
		throw new TypeError('invalid request deadline');
}

function resourceError(message: string): ProtocolError {
	return { code: 'resource', message, retryable: true };
}
function cancelledError(): ProtocolError {
	return { code: 'cancelled', message: 'operation cancelled', retryable: true };
}
function deadlineError(): ProtocolError {
	return {
		code: 'deadline',
		message: 'operation deadline exceeded',
		retryable: true,
	};
}

function dispatchError(error: unknown, fallback: string): ProtocolError {
	const bot = botFailure(error);
	if (bot) return bot;
	if (isProtocolError(error))
		return {
			code: error.code,
			message: error.message.slice(0, 4096),
			...(error.details === undefined ? {} : { details: error.details }),
			...(error.retryable === undefined ? {} : { retryable: error.retryable }),
			...(error.supportedMin === undefined
				? {}
				: { supportedMin: error.supportedMin }),
			...(error.supportedMax === undefined
				? {}
				: { supportedMax: error.supportedMax }),
		};
	if (error instanceof TerminalServiceError) return terminalServiceError(error);
	if (error instanceof FileServiceError) return fileServiceError(error);
	if (error instanceof GitServiceError) return gitServiceError(error);
	// The client sees only the fallback; the operator needs the cause.
	console.error(`[terminay] ${fallback}:`, error);
	return { code: 'internal', message: fallback, retryable: false };
}

function terminalServiceError(error: TerminalServiceError): ProtocolError {
	switch (error.code) {
		case 'session_exited':
		case 'session_interrupted':
		case 'session_not_found':
			return { code: 'not_found', message: error.message, retryable: false };
		case 'forbidden':
			return { code: 'forbidden', message: error.message, retryable: false };
		case 'project_awaiting_start':
			return {
				code: 'conflict',
				message: error.message,
				retryable: false,
				details: { reason: 'project_awaiting_start' },
			};
		case 'invalid_identity':
		case 'invalid_dimensions':
		case 'invalid_position':
		case 'invalid_bytes':
		case 'invalid_cwd':
		case 'invalid_environment':
			return { code: 'validation', message: error.message, retryable: false };
		default:
			// TerminalService already bounds its details. Preserve them for the
			// project-scoped caller so a shell launch failure remains diagnosable
			// instead of collapsing into the same generic spawn message.
			return {
				code: 'internal',
				message: error.message,
				retryable: false,
				...(error.details === undefined
					? {}
					: { details: { ...error.details } as JsonValue }),
			};
	}
}

/** FileServiceError has deliberately richer domain codes than the transport.
 * Convert it here so every file adapter returns a safe, actionable protocol
 * result instead of being collapsed into the dispatcher fallback. */
function fileServiceError(error: FileServiceError): ProtocolError {
	switch (error.code) {
		case 'invalid_path':
		case 'invalid_range':
			return {
				code: 'validation',
				message: 'file request is invalid',
				retryable: false,
			};
		case 'path_escape':
			return {
				code: 'forbidden',
				message: 'file path is outside the authorized project',
				retryable: false,
			};
		case 'path_missing':
		case 'not_directory':
		case 'not_file':
		case 'session_closed':
			return {
				code: 'not_found',
				message: 'requested file resource is unavailable',
				retryable: true,
			};
		case 'range_too_large':
		case 'draft_too_large':
			return {
				code: 'resource',
				message: 'file operation exceeds the server limit',
				retryable: false,
			};
		case 'revision_conflict':
		case 'save_precondition':
		case 'not_dirty':
		case 'confirmation_required':
			return {
				code: 'conflict',
				message: 'file state changed; refresh and retry',
				retryable: true,
			};
		case 'read_failed':
		case 'write_failed':
			return {
				code: 'internal',
				message: 'file operation could not be completed',
				retryable: false,
			};
	}
}

function gitServiceError(error: GitServiceError): ProtocolError {
	switch (error.code) {
		case 'cancelled':
			return { code: 'cancelled', message: error.message, retryable: true };
		case 'provider-timeout':
			return { code: 'deadline', message: error.message, retryable: true };
		case 'path-escape':
			return { code: 'forbidden', message: error.message, retryable: false };
		case 'invalid-project':
		case 'invalid-operation':
		case 'invalid-proposal':
			return { code: 'validation', message: error.message, retryable: false };
		case 'worktree-not-found':
		case 'proposal-not-found':
			return { code: 'not_found', message: error.message, retryable: true };
		case 'output-too-large':
			return { code: 'resource', message: error.message, retryable: false };
		case 'stale-revision':
		case 'proposal-stale':
		case 'proposal-replayed':
		case 'repository-mismatch':
		case 'worktree-dirty':
		case 'worktree-locked':
		case 'worktree-bare':
		case 'worktree-main':
			return { code: 'conflict', message: error.message, retryable: true };
		default:
			return {
				code: 'internal',
				message: error.message.slice(0, 4096),
				retryable: false,
			};
	}
}

function isProtocolError(value: unknown): value is ProtocolError {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.code === 'string' &&
		[
			'validation',
			'unauthorized',
			'forbidden',
			'not_found',
			'conflict',
			'cancelled',
			'deadline',
			'resource',
			'unavailable',
			'incompatible',
			'internal',
		].includes(candidate.code) &&
		typeof candidate.message === 'string' &&
		candidate.message.length > 0
	);
}
