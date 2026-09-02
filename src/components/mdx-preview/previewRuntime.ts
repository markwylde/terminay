export const PREVIEW_RUNTIME_LIMITS = Object.freeze({
	readyTimeoutMs: 10_000,
	resourceTimeoutMs: 15_000,
	compileTimeoutMs: 15_000,
	maxAutomaticRestarts: 3,
});

export type PreviewFailureState =
	| 'compile-timeout'
	| 'resource-timeout'
	| 'crash'
	| 'unresponsive'
	| 'repeated-restart';

export function nextPreviewRestart(restarts: number): 'restart' | 'repeated-restart' {
	return restarts >= PREVIEW_RUNTIME_LIMITS.maxAutomaticRestarts
		? 'repeated-restart'
		: 'restart';
}

export function previewAcceptsFilesystemPath(value: unknown): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		('path' in value || 'filePath' in value || 'fsPath' in value)
	);
}

export class PreviewResourceLease {
	readonly objectUrls: string[] = [];
	readonly listeners: Array<() => void> = [];
	timer: number | undefined;
	readonly abort = new AbortController();
	trackUrl(url: string): void {
		this.objectUrls.push(url);
	}
	track(cleanup: () => void): void {
		this.listeners.push(cleanup);
	}
	dispose(revoke: (url: string) => void): void {
		this.abort.abort();
		for (const url of this.objectUrls) revoke(url);
		this.objectUrls.length = 0;
		for (const listener of this.listeners) listener();
		this.listeners.length = 0;
		this.timer = undefined;
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
}
