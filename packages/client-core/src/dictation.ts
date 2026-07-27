import type { ProtocolId } from '@terminay/protocol';

export type DictationCaptureStatus =
	| 'idle'
	| 'recording'
	| 'ready'
	| 'cancelled';
export type DictationCancelReason =
	| 'cancelled'
	| 'disconnected'
	| 'target_changed';
export type DictationCredentialStatus = 'configured' | 'not-configured';

/** Immutable target captured when the user presses Start Dictation. */
export interface DictationTargetIdentity {
	readonly serverId: ProtocolId;
	readonly projectId: ProtocolId;
	readonly panelId: ProtocolId;
	readonly sessionId: ProtocolId;
}

/** Safe selected-server/provider disclosure. It never contains credentials. */
export interface DictationDisclosure {
	readonly serverLabel: string;
	readonly provider: string;
	readonly credentialStatus: DictationCredentialStatus;
	readonly confirmed: boolean;
}

export interface DictationCaptureLimits {
	readonly maxDurationMs?: number;
	readonly maxBytes?: number;
	readonly mimeTypes?: readonly string[];
}

export interface DictationCaptureClientOptions extends DictationCaptureLimits {
	readonly now?: () => number;
	readonly createRequestId?: () => string;
}

export interface DictationCaptureSnapshot {
	readonly status: DictationCaptureStatus;
	readonly target?: DictationTargetIdentity;
	readonly requestId?: string;
	readonly mimeType?: string;
	readonly startedAt?: number;
	readonly durationMs: number;
	readonly bytes: number;
	readonly cancelReason?: DictationCancelReason;
}

/** Binary request handed to a protocol transport after local capture stops. */
export interface DictationUploadRequest {
	readonly requestId: string;
	readonly target: DictationTargetIdentity;
	readonly mimeType: string;
	readonly durationMs: number;
	readonly audio: Uint8Array;
	readonly disclosure: DictationDisclosure;
}

const DEFAULT_MAX_DURATION_MS = 60_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MIME_TYPES = Object.freeze([
	'audio/webm',
	'audio/webm;codecs=opus',
	'audio/mp4',
	'audio/mpeg',
	'audio/wav',
]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const PROVIDER_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u;

/**
 * Browser-safe capture state machine. It owns no MediaRecorder or microphone
 * object; shared UI feeds bounded chunks into it and sends only the immutable
 * upload request returned by `finish` to a selected server transport.
 */
export class DictationCaptureClient {
	private readonly maxDurationMs: number;
	private readonly maxBytes: number;
	private readonly mimeTypes: ReadonlySet<string>;
	private readonly now: () => number;
	private readonly createRequestId: () => string;
	private statusValue: DictationCaptureStatus = 'idle';
	private targetValue: DictationTargetIdentity | undefined;
	private requestIdValue: string | undefined;
	private disclosureValue: DictationDisclosure | undefined;
	private mimeTypeValue: string | undefined;
	private startedAtValue: number | undefined;
	private cancelReasonValue: DictationCancelReason | undefined;
	private chunks: Uint8Array[] = [];
	private bytesValue = 0;

	constructor(options: DictationCaptureClientOptions = {}) {
		this.maxDurationMs = positiveLimit(
			options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS,
			'maxDurationMs',
		);
		this.maxBytes = positiveLimit(
			options.maxBytes ?? DEFAULT_MAX_BYTES,
			'maxBytes',
		);
		const mimeTypes = options.mimeTypes ?? DEFAULT_MIME_TYPES;
		if (
			!Array.isArray(mimeTypes) ||
			mimeTypes.length === 0 ||
			mimeTypes.length > 32
		)
			throw new RangeError('dictation MIME type list is invalid');
		this.mimeTypes = new Set(
			mimeTypes.map((value) => normalizeMimeType(value)),
		);
		this.now = options.now ?? (() => Date.now());
		this.createRequestId =
			options.createRequestId ??
			(() => {
				const random =
					typeof globalThis.crypto?.randomUUID === 'function'
						? globalThis.crypto.randomUUID()
						: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
				return `dictation-${random}`.slice(0, 128);
			});
	}

	get status(): DictationCaptureStatus {
		return this.statusValue;
	}

	snapshot(): DictationCaptureSnapshot {
		const durationMs =
			this.startedAtValue === undefined
				? 0
				: Math.max(0, this.now() - this.startedAtValue);
		return Object.freeze({
			status: this.statusValue,
			...(this.targetValue === undefined
				? {}
				: { target: copyTarget(this.targetValue) }),
			...(this.requestIdValue === undefined
				? {}
				: { requestId: this.requestIdValue }),
			...(this.mimeTypeValue === undefined
				? {}
				: { mimeType: this.mimeTypeValue }),
			...(this.startedAtValue === undefined
				? {}
				: { startedAt: this.startedAtValue }),
			durationMs,
			bytes: this.bytesValue,
			...(this.cancelReasonValue === undefined
				? {}
				: { cancelReason: this.cancelReasonValue }),
		});
	}

	begin(
		target: DictationTargetIdentity,
		disclosure: DictationDisclosure,
		options: { readonly mimeType?: string } = {},
	): DictationCaptureSnapshot {
		if (this.statusValue === 'recording')
			throw new Error('dictation capture is already active');
		const normalizedTarget = normalizeTarget(target);
		const normalizedDisclosure = normalizeDisclosure(disclosure);
		const mimeType =
			options.mimeType === undefined
				? undefined
				: this.requireMimeType(options.mimeType);
		const requestId = this.createRequestId();
		if (typeof requestId !== 'string' || !ID_PATTERN.test(requestId))
			throw new TypeError('dictation request id is invalid');
		this.statusValue = 'recording';
		this.targetValue = normalizedTarget;
		this.requestIdValue = requestId;
		this.disclosureValue = normalizedDisclosure;
		this.mimeTypeValue = mimeType;
		this.startedAtValue = this.now();
		this.cancelReasonValue = undefined;
		this.chunks = [];
		this.bytesValue = 0;
		return this.snapshot();
	}

	append(chunk: Uint8Array): DictationCaptureSnapshot {
		this.requireRecording();
		this.enforceDuration();
		if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0)
			throw new TypeError('dictation audio chunk is invalid');
		if (this.bytesValue + chunk.byteLength > this.maxBytes)
			throw new RangeError('dictation audio exceeds the client byte limit');
		const copy = chunk.slice();
		this.chunks.push(copy);
		this.bytesValue += copy.byteLength;
		return this.snapshot();
	}

	finish(
		options: { readonly mimeType?: string; readonly durationMs?: number } = {},
	): DictationUploadRequest {
		this.requireRecording();
		this.enforceDuration();
		if (this.chunks.length === 0 || this.bytesValue === 0)
			throw new Error('dictation audio is empty');
		const mimeType = this.requireMimeType(
			options.mimeType ?? this.mimeTypeValue ?? '',
		);
		const durationMs =
			options.durationMs ??
			(this.startedAtValue === undefined
				? 0
				: this.now() - this.startedAtValue);
		if (
			!Number.isSafeInteger(durationMs) ||
			durationMs <= 0 ||
			durationMs > this.maxDurationMs
		)
			throw new RangeError('dictation duration exceeds the client limit');
		const audio = new Uint8Array(this.bytesValue);
		let offset = 0;
		for (const chunk of this.chunks) {
			audio.set(chunk, offset);
			offset += chunk.byteLength;
		}
		this.mimeTypeValue = mimeType;
		this.statusValue = 'ready';
		const request = Object.freeze({
			requestId: this.requestIdValue as string,
			target: copyTarget(this.targetValue as DictationTargetIdentity),
			mimeType,
			durationMs,
			audio,
			disclosure: copyDisclosure(this.disclosureValue as DictationDisclosure),
		});
		this.chunks = [];
		return request;
	}

	cancel(
		reason: DictationCancelReason = 'cancelled',
	): DictationCaptureSnapshot {
		if (this.statusValue !== 'recording') return this.snapshot();
		if (
			reason !== 'cancelled' &&
			reason !== 'disconnected' &&
			reason !== 'target_changed'
		)
			throw new TypeError('dictation cancellation reason is invalid');
		this.statusValue = 'cancelled';
		this.cancelReasonValue = reason;
		this.chunks = [];
		this.bytesValue = 0;
		return this.snapshot();
	}

	reset(): DictationCaptureSnapshot {
		this.statusValue = 'idle';
		this.targetValue = undefined;
		this.requestIdValue = undefined;
		this.disclosureValue = undefined;
		this.mimeTypeValue = undefined;
		this.startedAtValue = undefined;
		this.cancelReasonValue = undefined;
		this.chunks = [];
		this.bytesValue = 0;
		return this.snapshot();
	}

	private requireRecording(): void {
		if (this.statusValue === 'cancelled')
			throw new Error(
				`dictation capture was ${this.cancelReasonValue ?? 'cancelled'}`,
			);
		if (this.statusValue !== 'recording')
			throw new Error('dictation capture is not recording');
	}

	private enforceDuration(): void {
		if (
			this.startedAtValue !== undefined &&
			this.now() - this.startedAtValue > this.maxDurationMs
		) {
			this.cancel('cancelled');
			throw new RangeError('dictation duration exceeds the client limit');
		}
	}

	private requireMimeType(value: string): string {
		const normalized = normalizeMimeType(value);
		if (!this.mimeTypes.has(normalized))
			throw new TypeError('dictation MIME type is unsupported');
		return normalized;
	}
}

function normalizeTarget(
	value: DictationTargetIdentity,
): DictationTargetIdentity {
	if (typeof value !== 'object' || value === null)
		throw new TypeError('dictation target is invalid');
	for (const name of ['serverId', 'projectId', 'panelId', 'sessionId'] as const)
		if (typeof value[name] !== 'string' || !ID_PATTERN.test(value[name]))
			throw new TypeError(`dictation ${name} is invalid`);
	return Object.freeze({
		serverId: value.serverId,
		projectId: value.projectId,
		panelId: value.panelId,
		sessionId: value.sessionId,
	});
}

function normalizeDisclosure(value: DictationDisclosure): DictationDisclosure {
	if (
		typeof value !== 'object' ||
		value === null ||
		typeof value.serverLabel !== 'string' ||
		value.serverLabel.length === 0 ||
		value.serverLabel.length > 160 ||
		hasControl(value.serverLabel) ||
		typeof value.provider !== 'string' ||
		!PROVIDER_PATTERN.test(value.provider) ||
		value.credentialStatus !== 'configured' ||
		value.confirmed !== true
	)
		throw new Error('dictation server/provider disclosure must be confirmed');
	for (const key of Object.keys(value)) {
		const normalizedKey = key.replace(/[-_]/gu, '').toLowerCase();
		if (
			['apikey', 'token', 'secret', 'password', 'credential'].includes(
				normalizedKey,
			)
		)
			throw new Error('dictation disclosure cannot contain credentials');
	}
	return Object.freeze({
		serverLabel: value.serverLabel,
		provider: value.provider,
		credentialStatus: 'configured',
		confirmed: true,
	});
}

function normalizeMimeType(value: string): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 128 ||
		!/^audio\/[A-Za-z0-9.+-]+(?:;[A-Za-z0-9 =._-]+)?$/u.test(value)
	)
		throw new TypeError('dictation MIME type is invalid');
	return value.toLowerCase();
}

function copyTarget(value: DictationTargetIdentity): DictationTargetIdentity {
	return Object.freeze({ ...value });
}
function copyDisclosure(value: DictationDisclosure): DictationDisclosure {
	return Object.freeze({ ...value });
}
function hasControl(value: string): boolean {
	return [...value].some((character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 0x20 || code === 0x7f;
	});
}
function positiveLimit(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
