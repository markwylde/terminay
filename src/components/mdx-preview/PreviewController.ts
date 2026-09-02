import type { PreviewHost } from './PreviewHost';
import {
	isPreviewExternalUrl,
	isPreviewMessage,
	isPreviewStorageMutation,
	type MdxPreviewMessage,
} from './previewMessages';
import { previewGuestDocument } from './previewGuest';
import type { PreviewStorageBroker } from './PreviewStorageBroker';
import {
	PREVIEW_RUNTIME_LIMITS,
	nextPreviewRestart,
} from './previewRuntime';

export { PREVIEW_RUNTIME_LIMITS } from './previewRuntime';

export type PreviewRuntimeState =
	| 'loading'
	| 'ready'
	| 'compile-timeout'
	| 'resource-timeout'
	| 'crash'
	| 'unresponsive'
	| 'repeated-restart'
	| 'unavailable'
	| 'closed';

export interface PreviewResource {
	readonly resourceId: string;
	readonly mimeType: string;
	readonly totalLength: number;
}

export interface PreviewControllerOptions {
	readonly runtimeId: string;
	readonly bundle: Uint8Array;
	readonly storageKey: string;
	readonly host: PreviewHost;
	readonly storage: PreviewStorageBroker;
	readonly resources?: readonly PreviewResource[];
	readonly fetchResource?: (
		resourceId: string,
		offset: number,
		length: number,
		signal: AbortSignal,
	) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
	readonly onMessage?: (message: MdxPreviewMessage) => void;
	readonly onExternalUrl?: (url: string) => void;
	readonly now?: () => number;
	readonly setTimeout?: (handler: () => void, ms: number) => number;
	readonly clearTimeout?: (id: number) => void;
	readonly createObjectURL?: (blob: Blob) => string;
	readonly revokeObjectURL?: (url: string) => void;
}

export class PreviewController {
	state: PreviewRuntimeState = 'loading';
	private readonly objectUrls: string[] = [];
	private readonly listeners: Array<() => void> = [];
	private timer: number | undefined;
	private abort: AbortController = new AbortController();
	private restarts = 0;
	private destroyed = false;
	private readonly options: PreviewControllerOptions;
	constructor(options: PreviewControllerOptions) {
		this.options = options;
		if (!options.host.capability.available) this.state = 'unavailable';
	}
	get leaks(): {
		readonly objectUrls: number;
		readonly listeners: number;
		readonly timer: boolean;
		readonly aborted: boolean;
	} {
		return {
			objectUrls: this.objectUrls.length,
			listeners: this.listeners.length,
			timer: this.timer !== undefined,
			aborted: this.abort.signal.aborted,
		};
	}
	track(cleanup: () => void): void {
		this.listeners.push(cleanup);
	}
	async attach(frame: {
		srcdoc: string;
		contentWindow: Window | null;
		setAttribute(name: string, value: string): void;
	}): Promise<void> {
		if (this.state === 'unavailable' || !this.options.host.capability.available) {
			this.state = 'unavailable';
			return;
		}
		if (this.destroyed) return;
		frame.setAttribute('sandbox', this.options.host.capability.sandbox);
		const bundle = await this.materialize();
		if (this.destroyed) return;
		const createObjectURL =
			this.options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
		const copy = bundle.buffer.slice(
			bundle.byteOffset,
			bundle.byteOffset + bundle.byteLength,
		) as ArrayBuffer;
		const sourceUrl = createObjectURL(
			new Blob([copy], { type: 'text/javascript' }),
		);
		this.objectUrls.push(sourceUrl);
		frame.srcdoc = previewGuestDocument(
			this.options.runtimeId,
			sourceUrl,
			this.options.storage.snapshot(this.options.storageKey),
		);
		this.watchReady();
	}
	handleMessage(
		event: { source: unknown; data: unknown },
		source: unknown,
	): void {
		if (this.destroyed || event.source !== source) return;
		if (isPreviewStorageMutation(event.data, this.options.runtimeId)) {
			this.options.storage.persist(this.options.storageKey, event.data);
			return;
		}
		if (isPreviewExternalUrl(event.data, this.options.runtimeId)) {
			this.options.onExternalUrl?.(event.data.url);
			return;
		}
		if (!isPreviewMessage(event.data, this.options.runtimeId)) return;
		if (event.data.kind === 'ready') {
			this.state = 'ready';
			this.clearTimer();
		}
		this.options.onMessage?.(event.data);
	}
	fail(
		state:
			| 'compile-timeout'
			| 'resource-timeout'
			| 'crash'
			| 'unresponsive',
	): void {
		if (this.destroyed) return;
		this.destroyRuntime();
		if (nextPreviewRestart(this.restarts) === 'repeated-restart') {
			this.state = 'repeated-restart';
			this.options.onMessage?.({
				version: 1,
				kind: 'diagnostic',
				runtimeId: this.options.runtimeId,
				message: 'Preview crashed repeatedly. Restart it to try again.',
			});
			return;
		}
		this.restarts += 1;
		this.abort = new AbortController();
		this.state = state;
	}
	dispose(): void {
		this.destroyed = true;
		this.state = 'closed';
		this.destroyRuntime();
		this.options.host.destroy();
	}
	private async materialize(): Promise<Uint8Array> {
		const copied = new Uint8Array(this.options.bundle.byteLength);
		copied.set(this.options.bundle);
		const resources = this.options.resources ?? [];
		if (resources.length === 0 || this.options.fetchResource === undefined)
			return copied;
		let source = new TextDecoder().decode(copied);
		for (const resource of resources) {
			if (this.abort.signal.aborted) throw this.abort.signal.reason;
			const loaded = await this.withTimeout(
				this.options.fetchResource(
					resource.resourceId,
					0,
					resource.totalLength,
					this.abort.signal,
				),
				PREVIEW_RUNTIME_LIMITS.resourceTimeoutMs,
				'resource-timeout',
			);
			const createObjectURL =
				this.options.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
			const copy = loaded.bytes.buffer.slice(
				loaded.bytes.byteOffset,
				loaded.bytes.byteOffset + loaded.bytes.byteLength,
			) as ArrayBuffer;
			const url = createObjectURL(
				new Blob([copy], { type: loaded.mimeType || resource.mimeType }),
			);
			this.objectUrls.push(url);
			source = source.replaceAll(
				`__terminay_resource_${resource.resourceId}__`,
				url,
			);
		}
		return new TextEncoder().encode(source);
	}
	private watchReady(): void {
		const setTimer =
			this.options.setTimeout ??
			((handler, ms) => window.setTimeout(handler, ms));
		this.timer = setTimer(() => {
			if (this.state === 'ready' || this.destroyed) return;
			this.fail('unresponsive');
			this.options.onMessage?.({
				version: 1,
				kind: 'diagnostic',
				runtimeId: this.options.runtimeId,
				message: 'Preview did not become ready. Restart it to try again.',
			});
		}, PREVIEW_RUNTIME_LIMITS.readyTimeoutMs);
	}
	private async withTimeout<T>(
		operation: Promise<T>,
		ms: number,
		state: 'compile-timeout' | 'resource-timeout',
	): Promise<T> {
		const setTimer =
			this.options.setTimeout ??
			((handler, delay) => window.setTimeout(handler, delay));
		let id = 0;
		const timeout = new Promise<never>((_, reject) => {
			id = setTimer(() => {
				this.fail(state);
				reject(new Error(state));
			}, ms);
		});
		try {
			return await Promise.race([operation, timeout]);
		} finally {
			this.clearTimeoutId(id);
		}
	}
	private destroyRuntime(): void {
		this.abort.abort();
		this.clearTimer();
		const revoke =
			this.options.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));
		for (const url of this.objectUrls) revoke(url);
		this.objectUrls.length = 0;
		for (const listener of this.listeners) listener();
		this.listeners.length = 0;
	}
	private clearTimer(): void {
		if (this.timer === undefined) return;
		this.clearTimeoutId(this.timer);
		this.timer = undefined;
	}
	private clearTimeoutId(id: number): void {
		(this.options.clearTimeout ?? ((timer) => window.clearTimeout(timer)))(id);
	}
}

