export * from './bounds.js';
export * from './cliProvider.js';
export * from './credentials.js';
export * from './dictation.js';
export * from './metadata.js';
export * from './openAiDictationProvider.js';
export * from './parakeetProvider.js';
export * from './parakeetRuntime.js';
export * from './protocol.js';
export * from './replay.js';
export * from './targets.js';
export * from './types.js';

import { DictationService } from './dictation.js';
import { AiMetadataService } from './metadata.js';
import type {
	ServerParakeetDictationProvider,
	ServerParakeetRuntimeStatus,
} from './parakeetProvider.js';
import type {
	AiMetadataRequest,
	AiMetadataResult,
	AiMetadataServiceOptions,
	AiRequestStatusSnapshot,
	DictationResult,
	DictationServiceOptions,
	DictationTranscribeRequest,
} from './types.js';

export interface AiServiceOptions extends AiMetadataServiceOptions {
	readonly dictationProvider?: DictationServiceOptions['provider'];
	readonly dictationSettings?: DictationServiceOptions['settings'];
	readonly dictationRuntime?: Pick<
		ServerParakeetDictationProvider,
		'status' | 'install'
	>;
	readonly dictationCredential?: {
		status(): { readonly configured: boolean };
		set(value: Uint8Array): Promise<{ readonly configured: boolean }>;
		clear(): Promise<{ readonly configured: boolean }>;
	};
}

/** Convenience composition for protocol/runtime hosts. It does not add any
 * transport or Electron dependency; callers may use the focused services when
 * they need separate lifecycle wiring. */
export class AiService {
	readonly metadata: AiMetadataService;
	readonly dictation: DictationService | undefined;
	private readonly dictationRuntime: AiServiceOptions['dictationRuntime'];
	private readonly dictationCredential: AiServiceOptions['dictationCredential'];

	constructor(options: AiServiceOptions) {
		this.dictationRuntime = options.dictationRuntime;
		this.dictationCredential = options.dictationCredential;
		this.metadata = new AiMetadataService(options);
		this.dictation =
			options.dictationProvider === undefined
				? undefined
				: new DictationService({
						serverId: options.serverId,
						authority: options.authority,
						provider: options.dictationProvider,
						credentialResolver: options.credentialResolver,
						settings: options.dictationSettings,
						limits: options.limits,
						now: options.now,
						logger: options.logger,
					});
	}

	runtimeStatus(): Promise<ServerParakeetRuntimeStatus> {
		if (this.dictationRuntime === undefined)
			throw new Error('dictation runtime is not configured');
		return this.dictationRuntime.status();
	}

	installRuntime(): Promise<ServerParakeetRuntimeStatus> {
		if (this.dictationRuntime === undefined)
			throw new Error('dictation runtime is not configured');
		return this.dictationRuntime.install();
	}

	credentialStatus() {
		return this.dictationCredential?.status() ?? { configured: false };
	}
	setCredential(value: Uint8Array) {
		if (this.dictationCredential === undefined)
			throw new Error('dictation credential management is unavailable');
		return this.dictationCredential.set(value);
	}
	clearCredential() {
		if (this.dictationCredential === undefined)
			throw new Error('dictation credential management is unavailable');
		return this.dictationCredential.clear();
	}

	generate(request: AiMetadataRequest): Promise<AiMetadataResult> {
		return this.metadata.generate(request);
	}

	transcribe(request: DictationTranscribeRequest): Promise<DictationResult> {
		if (this.dictation === undefined)
			throw new Error('dictation provider is not configured');
		return this.dictation.transcribe(request);
	}

	listModels(provider: string, signal?: AbortSignal) {
		return this.metadata.listModels(provider, signal);
	}

	status(requestId: string): AiRequestStatusSnapshot | undefined {
		return this.metadata.status(requestId) ?? this.dictation?.status(requestId);
	}

	cancel(requestId: string): boolean {
		return (
			this.metadata.cancel(requestId) ||
			(this.dictation?.cancel(requestId) ?? false)
		);
	}
}

export const ServerAiService = AiService;
