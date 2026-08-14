import type { ProtocolError, ProtocolId } from '@terminay/protocol';
import type {
	CommandHandler,
	CommandRequest,
	OperationRegistries,
	QueryHandler,
	QueryRequest,
} from '../types.js';
import type { AiService } from './index.js';
import type {
	AiMetadataResult,
	AiMetadataTarget,
	AiProviderInput,
	AiRequestStatusSnapshot,
	DictationResult,
	TerminalTarget,
} from './types.js';
import { AiServiceError } from './types.js';

export const AI_SERVER_OPERATIONS = Object.freeze({
	listModels: 'ai.models.list',
	status: 'ai.request.status',
	runtimeStatus: 'ai.dictation.runtime.status',
	installRuntime: 'ai.dictation.runtime.install',
	credentialStatus: 'ai.dictation.credential.status',
	setCredential: 'ai.dictation.credential.set',
	clearCredential: 'ai.dictation.credential.clear',
	generateMetadata: 'ai.metadata.generate',
	transcribe: 'ai.dictation.transcribe',
	cancel: 'ai.request.cancel',
} as const);

/**
 * Bind the server-owned AI service to the canonical query/command dispatcher.
 * JSON carries request metadata only; dictation audio is the bounded command
 * body and never becomes a JSON status/result field.
 */
export function createAiOperationHandlers(
	service: AiService,
): OperationRegistries {
	const queries: Record<string, QueryHandler> = {
		[AI_SERVER_OPERATIONS.listModels]: async (request) => {
			const payload = exactPayload(request.envelope.payload, ['provider']);
			const provider = stringField(payload, 'provider', 64);
			const models = await service.listModels(provider, request.context.signal);
			return {
				models: models.map((model) => ({ id: model.id, label: model.label })),
			};
		},
		[AI_SERVER_OPERATIONS.status]: (request) => {
			const payload = exactPayload(request.envelope.payload, ['requestId']);
			const snapshot = service.status(stringField(payload, 'requestId', 128));
			return {
				status: snapshot === undefined ? null : statusPayload(snapshot),
			};
		},
		[AI_SERVER_OPERATIONS.runtimeStatus]: async () =>
			runtimeStatusPayload(await service.runtimeStatus()),
		[AI_SERVER_OPERATIONS.credentialStatus]: async () =>
			service.credentialStatus(),
	};

	const commands: Record<string, CommandHandler> = {
		[AI_SERVER_OPERATIONS.generateMetadata]: async (request) => {
			const payload = exactPayload(request.envelope.payload, [
				'requestId',
				'target',
				'targetType',
				'expectedRevision',
				'provider',
				'model',
			]);
			const expectedRevision = optionalUInt(
				payload.expectedRevision,
				'expectedRevision',
			);
			if (
				request.envelope.expectedRevision !== undefined &&
				request.envelope.expectedRevision !== expectedRevision
			)
				throw protocolError('validation', 'metadata revisions do not match');
			const result = await service.generate({
				requestId: stringField(payload, 'requestId', 128),
				clientId: request.context.clientId,
				target: targetField(payload, 'target'),
				targetType: targetTypeField(payload.targetType),
				...(expectedRevision === undefined ? {} : { expectedRevision }),
				...(payload.provider === undefined
					? {}
					: { provider: providerField(payload.provider) }),
				...(payload.model === undefined
					? {}
					: { model: stringField(payload, 'model', 256) }),
				signal: request.context.signal,
			});
			return {
				result: metadataResultPayload(result),
				revision: result.revision,
			};
		},
		[AI_SERVER_OPERATIONS.transcribe]: async (request) => {
			const payload = exactPayload(request.envelope.payload, [
				'requestId',
				'target',
				'mimeType',
				'durationMs',
				'language',
				'model',
				'prompt',
				'appendNewline',
				'peakLevel',
			]);
			const durationMs = optionalUInt(payload.durationMs, 'durationMs');
			const peakLevel = optionalNumber(payload.peakLevel, 'peakLevel');
			const result = await service.transcribe({
				requestId: stringField(payload, 'requestId', 128),
				clientId: request.context.clientId,
				target: targetField(payload, 'target'),
				mimeType: stringField(payload, 'mimeType', 128),
				audio: new Uint8Array(request.body),
				...(durationMs === undefined ? {} : { durationMs }),
				...(payload.language === undefined
					? {}
					: { language: stringField(payload, 'language', 128) }),
				...(payload.model === undefined
					? {}
					: { model: stringField(payload, 'model', 256) }),
				...(payload.prompt === undefined
					? {}
					: { prompt: stringField(payload, 'prompt', 4096) }),
				...(payload.appendNewline === undefined
					? {}
					: { appendNewline: booleanField(payload, 'appendNewline') }),
				...(peakLevel === undefined ? {} : { peakLevel }),
				signal: request.context.signal,
			});
			return dictationResultPayload(result);
		},
		[AI_SERVER_OPERATIONS.cancel]: (request) => {
			const payload = exactPayload(request.envelope.payload, ['requestId']);
			return {
				cancelled: service.cancel(stringField(payload, 'requestId', 128)),
			};
		},
		[AI_SERVER_OPERATIONS.installRuntime]: async (request) => {
			exactPayload(request.envelope.payload, []);
			return runtimeStatusPayload(await service.installRuntime());
		},
		[AI_SERVER_OPERATIONS.setCredential]: async (request) => {
			exactPayload(request.envelope.payload, []);
			return service.setCredential(new Uint8Array(request.body));
		},
		[AI_SERVER_OPERATIONS.clearCredential]: async (request) => {
			exactPayload(request.envelope.payload, []);
			return service.clearCredential();
		},
	};

	const safeQueries = Object.fromEntries(
		Object.entries(queries).map(([operation, handler]) => [
			operation,
			protect(handler),
		]),
	) as Record<string, QueryHandler>;
	const safeCommands = Object.fromEntries(
		Object.entries(commands).map(([operation, handler]) => [
			operation,
			protect(handler),
		]),
	) as Record<string, CommandHandler>;
	const policies: Record<string, { readonly scope: 'read' | 'write' }> = {};
	for (const operation of Object.keys(queries))
		policies[operation] = { scope: 'read' };
	for (const operation of Object.keys(commands))
		policies[operation] = {
			scope:
				operation === AI_SERVER_OPERATIONS.installRuntime ? 'read' : 'write',
		};
	return { queries: safeQueries, commands: safeCommands, policies };
}

function runtimeStatusPayload(
	value: import('./parakeetProvider.js').ServerParakeetRuntimeStatus,
): import('@terminay/protocol').JsonValue {
	return {
		state: value.state,
		model: value.model,
		...(value.message === undefined ? {} : { message: value.message }),
		...(value.progress === undefined ? {} : { progress: value.progress }),
		...(value.engine === undefined ? {} : { engine: { ...value.engine } }),
		...(value.modelRevision === undefined
			? {}
			: { modelRevision: value.modelRevision }),
		...(value.modelLicense === undefined
			? {}
			: { modelLicense: value.modelLicense }),
		...(value.audioFormat === undefined
			? {}
			: { audioFormat: value.audioFormat }),
	};
}

function protect<T extends QueryHandler | CommandHandler>(handler: T): T {
	return (async (request: QueryRequest | CommandRequest) => {
		try {
			return await handler(request as never);
		} catch (error) {
			throw toAiProtocolError(error);
		}
	}) as T;
}

function exactPayload(
	value: unknown,
	allowed: readonly string[],
): Record<string, import('@terminay/protocol').JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'AI request payload is invalid');
	const result = value as Record<
		string,
		import('@terminay/protocol').JsonValue
	>;
	for (const key of Object.keys(result))
		if (!allowed.includes(key))
			throw protocolError(
				'validation',
				'AI request payload contains an unsupported field',
			);
	return result;
}

function statusPayload(
	value: AiRequestStatusSnapshot,
): import('@terminay/protocol').JsonValue {
	return {
		requestId: value.requestId,
		kind: value.kind,
		status: value.status,
		target: { ...value.target },
		startedAt: value.startedAt,
		...(value.finishedAt === undefined ? {} : { finishedAt: value.finishedAt }),
		...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
	};
}

function metadataResultPayload(
	value: AiMetadataResult,
): import('@terminay/protocol').JsonValue {
	return {
		requestId: value.requestId,
		target: { ...value.target },
		targetType: value.targetType,
		text: value.text,
		revision: value.revision,
	};
}

function dictationResultPayload(
	value: DictationResult,
): import('@terminay/protocol').JsonValue {
	return {
		requestId: value.requestId,
		target: { ...value.target },
		text: value.text,
		inserted: value.inserted,
	};
}

function targetField(
	payload: Record<string, import('@terminay/protocol').JsonValue>,
	field: string,
): TerminalTarget {
	const value = payload[field];
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'AI target is invalid');
	const target = value as Record<
		string,
		import('@terminay/protocol').JsonValue
	>;
	for (const key of Object.keys(target))
		if (!['serverId', 'projectId', 'panelId', 'sessionId'].includes(key))
			throw protocolError(
				'validation',
				'AI target contains an unsupported field',
			);
	return {
		serverId: idField(target.serverId, 'target.serverId'),
		projectId: idField(target.projectId, 'target.projectId'),
		panelId: idField(target.panelId, 'target.panelId'),
		sessionId: idField(target.sessionId, 'target.sessionId'),
	};
}

function targetTypeField(
	value: import('@terminay/protocol').JsonValue | undefined,
): AiMetadataTarget {
	if (value !== 'title' && value !== 'note')
		throw protocolError('validation', 'AI metadata target is invalid');
	return value;
}

function providerField(
	value: import('@terminay/protocol').JsonValue,
): AiProviderInput {
	if (value !== 'codex' && value !== 'claude-code' && value !== 'claudeCode')
		throw protocolError('validation', 'AI provider is invalid');
	return value;
}

function stringField(
	payload: Record<string, import('@terminay/protocol').JsonValue>,
	field: string,
	max: number,
): string {
	const value = payload[field];
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > max ||
		/[\0\r\n]/u.test(value)
	)
		throw protocolError('validation', `AI ${field} is invalid`);
	return value;
}

function idField(
	value: import('@terminay/protocol').JsonValue | undefined,
	field: string,
): ProtocolId {
	if (
		typeof value !== 'string' ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	)
		throw protocolError('validation', `AI ${field} is invalid`);
	return value;
}

function optionalUInt(
	value: import('@terminay/protocol').JsonValue | undefined,
	field: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw protocolError('validation', `AI ${field} is invalid`);
	return value as number;
}

function optionalNumber(
	value: import('@terminay/protocol').JsonValue | undefined,
	field: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	)
		throw protocolError('validation', `AI ${field} is invalid`);
	return value;
}

function booleanField(
	payload: Record<string, import('@terminay/protocol').JsonValue>,
	field: string,
): boolean {
	const value = payload[field];
	if (typeof value !== 'boolean')
		throw protocolError('validation', `AI ${field} is invalid`);
	return value;
}

function protocolError(
	code: ProtocolError['code'],
	message: string,
	retryable = false,
): ProtocolError {
	return { code, message: message.slice(0, 256), retryable };
}

/** Convert private AI errors to the small public protocol error vocabulary. */
export function toAiProtocolError(error: unknown): ProtocolError {
	if (isProtocolError(error)) return error;
	if (!(error instanceof AiServiceError))
		return protocolError('internal', 'AI operation failed');
	const code = error.code;
	if (
		code === 'invalid_request' ||
		code === 'empty_output' ||
		code === 'audio_empty' ||
		code === 'audio_inaudible' ||
		code === 'audio_type_unsupported'
	)
		return protocolError('validation', publicMessage(code));
	if (code === 'not_authorized')
		return protocolError('forbidden', publicMessage(code));
	if (code === 'revision_conflict')
		return protocolError('conflict', publicMessage(code), true);
	if (
		code === 'target_unavailable' ||
		code === 'provider_unavailable' ||
		code === 'provider_disabled'
	)
		return protocolError('unavailable', publicMessage(code), true);
	if (code === 'target_exited')
		return protocolError('not_found', publicMessage(code));
	if (code === 'cancelled' || code === 'provider_cancelled')
		return protocolError('cancelled', publicMessage(code), true);
	if (code === 'provider_timeout' || code === 'audio_timeout')
		return protocolError('deadline', publicMessage(code), true);
	if (
		code === 'provider_output_too_large' ||
		code === 'audio_output_too_large' ||
		code === 'audio_too_large' ||
		code === 'audio_duration_exceeded'
	)
		return protocolError('resource', publicMessage(code), true);
	return protocolError('internal', 'AI operation failed');
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
		typeof candidate.message === 'string'
	);
}

function publicMessage(code: string): string {
	return (
		(
			{
				invalid_request: 'AI request is invalid.',
				empty_output: 'The provider returned no usable text.',
				audio_empty: 'Dictation audio is empty.',
				audio_inaudible: 'Dictation audio contains no audible speech.',
				audio_type_unsupported: 'Dictation audio type is unsupported.',
				not_authorized: 'The client is not authorized for this target.',
				revision_conflict:
					'The target metadata changed while the request was running.',
				target_unavailable: 'The target is unavailable.',
				provider_unavailable: 'The selected provider is unavailable.',
				provider_disabled: 'The selected provider is disabled.',
				target_exited: 'The target terminal has exited.',
				cancelled: 'The AI request was cancelled.',
				provider_cancelled: 'The provider request was cancelled.',
				provider_timeout: 'The provider request timed out.',
				audio_timeout: 'The dictation request timed out.',
				provider_output_too_large:
					'The provider result exceeded the server limit.',
				audio_output_too_large: 'The transcript exceeded the server limit.',
				audio_too_large: 'The audio exceeded the server limit.',
				audio_duration_exceeded:
					'The recording exceeded the server duration limit.',
			} as Record<string, string>
		)[code] ?? 'AI operation failed.'
	);
}
