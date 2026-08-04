import type { JsonValue, ProtocolId } from "@terminay/protocol";
import type { BinaryCommandTransport, QueryCommandTransport } from "./queryCommand.js";
import type { CommandOptions, QueryOptions } from "./types.js";

export const AI_OPERATIONS = Object.freeze({
	listModels: "ai.models.list",
	status: "ai.request.status",
	generateMetadata: "ai.metadata.generate",
	transcribe: "ai.dictation.transcribe",
	cancel: "ai.request.cancel",
} as const);

export type AiMetadataTargetType = "title" | "note";
export type AiProvider = "codex" | "claude-code";

export interface AiTargetIdentity {
	readonly serverId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly panelId: ProtocolId;
	readonly sessionId: ProtocolId;
}

export interface AiMetadataGenerateRequest {
	readonly requestId: ProtocolId;
	readonly target: AiTargetIdentity;
	readonly targetType: AiMetadataTargetType;
	readonly expectedRevision?: number;
	readonly provider?: AiProvider;
	readonly model?: string;
}

export interface AiDictationUploadRequest {
	readonly requestId: ProtocolId;
	readonly target: AiTargetIdentity;
	readonly mimeType: string;
	readonly durationMs?: number;
	readonly language?: string;
	readonly model?: string;
	readonly prompt?: string;
	readonly appendNewline?: boolean;
	readonly peakLevel?: number;
	readonly audio: Uint8Array;
}

export interface AiModel {
	readonly id: string;
	readonly label: string;
}

/**
 * Shared AI contract. It carries only opaque target identities and bounded
 * request metadata. Provider credentials, CLI settings, replay context, and
 * raw provider output remain server-owned.
 */
export class TerminayAiClient {
	constructor(private readonly transport: QueryCommandTransport) {}

	async listModels(provider: AiProvider, options: QueryOptions = {}): Promise<readonly AiModel[]> {
		const value = await this.transport.query<JsonValue>(AI_OPERATIONS.listModels, { provider: boundedProvider(provider) }, options);
		if (!isRecord(value) || !Array.isArray(value.models)) throw new TypeError("AI model response is invalid");
		return Object.freeze(value.models.map(readModel));
	}

	async status(requestId: ProtocolId, options: QueryOptions = {}): Promise<JsonValue> {
		return this.transport.query(AI_OPERATIONS.status, { requestId: boundedId(requestId, "requestId") }, options);
	}

	async generateMetadata(request: AiMetadataGenerateRequest, options: CommandOptions = {}): Promise<JsonValue> {
		const payload = metadataPayload(request);
		return this.transport.command(AI_OPERATIONS.generateMetadata, payload, {
			...options,
			...(request.expectedRevision === undefined || options.expectedRevision !== undefined ? {} : { expectedRevision: request.expectedRevision }),
		});
	}

	async transcribe(request: AiDictationUploadRequest, options: CommandOptions = {}): Promise<JsonValue> {
		const binary = this.transport as Partial<BinaryCommandTransport>;
		if (typeof binary.commandWithBody !== "function") throw new Error("the connected server transport does not support dictation upload");
		return binary.commandWithBody(AI_OPERATIONS.transcribe, dictationPayload(request), copyAudio(request.audio), options);
	}

	async cancel(requestId: ProtocolId, options: CommandOptions = {}): Promise<JsonValue> {
		return this.transport.command(AI_OPERATIONS.cancel, { requestId: boundedId(requestId, "requestId") }, options);
	}
}

function metadataPayload(request: AiMetadataGenerateRequest): JsonValue {
	if (!isRecord(request)) throw new TypeError("AI metadata request is invalid");
	const target = targetPayload(request.target);
	if (request.targetType !== "title" && request.targetType !== "note") throw new TypeError("AI metadata target type is invalid");
	return {
		requestId: boundedId(request.requestId, "requestId"),
		target,
		targetType: request.targetType,
		...(request.expectedRevision === undefined ? {} : { expectedRevision: boundedRevision(request.expectedRevision) }),
		...(request.provider === undefined ? {} : { provider: boundedProvider(request.provider) }),
		...(request.model === undefined ? {} : { model: boundedText(request.model, "model", 256) }),
	};
}

function dictationPayload(request: AiDictationUploadRequest): JsonValue {
	if (!isRecord(request)) throw new TypeError("dictation request is invalid");
	if (request.audio instanceof Uint8Array === false) throw new TypeError("dictation audio is invalid");
	return {
		requestId: boundedId(request.requestId, "requestId"),
		target: targetPayload(request.target),
		mimeType: boundedMime(request.mimeType),
		...(request.durationMs === undefined ? {} : { durationMs: boundedDuration(request.durationMs) }),
		...(request.language === undefined ? {} : { language: boundedText(request.language, "language", 128) }),
		...(request.model === undefined ? {} : { model: boundedText(request.model, "model", 256) }),
		...(request.prompt === undefined ? {} : { prompt: boundedText(request.prompt, "prompt", 4096) }),
		...(request.appendNewline === undefined ? {} : { appendNewline: request.appendNewline === true }),
		...(request.peakLevel === undefined ? {} : { peakLevel: boundedPeakLevel(request.peakLevel) }),
	};
}

function targetPayload(target: AiTargetIdentity): JsonValue {
	if (!isRecord(target)) throw new TypeError("AI target is invalid");
	return {
		serverId: boundedId(target.serverId, "target.serverId"),
		projectId: boundedId(target.projectId, "target.projectId"),
		panelId: boundedId(target.panelId, "target.panelId"),
		sessionId: boundedId(target.sessionId, "target.sessionId"),
	};
}

function boundedProvider(value: AiProvider): AiProvider {
	if (value !== "codex" && value !== "claude-code") throw new TypeError("AI provider is invalid");
	return value;
}

function boundedId(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

function boundedText(value: unknown, label: string, max: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || /[\0\r\n]/u.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

function boundedMime(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 128 || !/^audio\/[A-Za-z0-9.+-]+(?:;[A-Za-z0-9 =._-]+)?$/u.test(value)) throw new TypeError("dictation MIME type is invalid");
	return value.toLowerCase();
}

function boundedDuration(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > 60_000) throw new RangeError("dictation duration is invalid");
	return value as number;
}

function boundedPeakLevel(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("dictation peak level is invalid");
	return value;
}

function boundedRevision(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) throw new RangeError("metadata revision is invalid");
	return value as number;
}

function copyAudio(value: Uint8Array): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength === 0 || value.byteLength > 8 * 1024 * 1024) throw new RangeError("dictation audio is outside the client limit");
	return new Uint8Array(value);
}

function readModel(value: JsonValue): AiModel {
	if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string" || value.id.length === 0 || value.id.length > 256 || value.label.length === 0 || value.label.length > 256) throw new TypeError("AI model is invalid");
	return Object.freeze({ id: value.id, label: value.label });
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
