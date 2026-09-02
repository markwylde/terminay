import type {
	DocumentationCatalog,
	DocumentationClient,
	FileObservationClient,
	FileWatchEvent,
	FileWatchHandle,
} from '@terminay/client-core';

export const DOCUMENTATION_REFRESH_DELAY_MS = 150;

export type DocumentationRefreshMode = 'coalesced' | 'immediate' | 'fresh';

export interface DocumentationCatalogControllerOptions {
	readonly client: DocumentationClient;
	readonly observationClient?: FileObservationClient;
	readonly projectId: string;
	readonly scopeKey: string;
	readonly expandedFolderIds?: readonly string[];
	readonly onExpandedFolderIdsChange?: (ids: string[]) => void;
	readonly delayMs?: number;
	readonly setTimeoutFn?: (callback: () => void, ms: number) => number;
	readonly clearTimeoutFn?: (id: number) => void;
}

export interface DocumentationCatalogSnapshot {
	readonly catalog?: DocumentationCatalog;
	readonly error?: string;
	readonly loading: boolean;
	readonly partial: boolean;
	readonly selectedPath?: string;
	readonly expandedFolders: ReadonlySet<string>;
}

/** Owns catalog state, expansion, selection, and one coalesced refresh timer.
 * Ordinary watch events keep the last good tree; overflow/resync fetch fresh. */
export class DocumentationCatalogController {
	private catalogValue: DocumentationCatalog | undefined;
	private errorValue: string | undefined;
	private loadingValue = false;
	private selectedPathValue: string | undefined;
	private expandedFoldersValue: Set<string>;
	private requestId = 0;
	private timer: number | undefined;
	private disposed = false;
	private watchHandle: FileWatchHandle | undefined;
	private unsubscribeWatch: (() => void) | undefined;
	private readonly options: DocumentationCatalogControllerOptions;
	private readonly delayMs: number;
	private readonly setTimeoutFn: (callback: () => void, ms: number) => number;
	private readonly clearTimeoutFn: (id: number) => void;
	private readonly listeners = new Set<() => void>();

	constructor(options: DocumentationCatalogControllerOptions) {
		this.options = options;
		this.expandedFoldersValue = new Set(options.expandedFolderIds ?? []);
		this.delayMs = options.delayMs ?? DOCUMENTATION_REFRESH_DELAY_MS;
		this.setTimeoutFn =
			options.setTimeoutFn ?? ((callback, ms) => globalThis.setTimeout(callback, ms) as unknown as number);
		this.clearTimeoutFn =
			options.clearTimeoutFn ?? ((id) => globalThis.clearTimeout(id));
	}

	get snapshot(): DocumentationCatalogSnapshot {
		return {
			catalog: this.catalogValue,
			error: this.errorValue,
			loading: this.loadingValue,
			partial: this.catalogValue?.partial === true,
			selectedPath: this.selectedPathValue,
			expandedFolders: this.expandedFoldersValue,
		};
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async start(): Promise<void> {
		this.refresh('immediate');
		await this.subscribeObservation();
	}

	refresh(mode: DocumentationRefreshMode = 'immediate'): void {
		if (this.disposed) return;
		if (mode === 'coalesced') {
			if (this.timer !== undefined) this.clearTimeoutFn(this.timer);
			this.timer = this.setTimeoutFn(() => {
				this.timer = undefined;
				void this.run('coalesced');
			}, this.delayMs);
			return;
		}
		if (this.timer !== undefined) {
			this.clearTimeoutFn(this.timer);
			this.timer = undefined;
		}
		void this.run(mode);
	}

	handleWatchEvent(event: Pick<FileWatchEvent, 'kind'>): void {
		if (event.kind === 'resync' || event.kind === 'unavailable') this.refresh('fresh');
		else this.refresh('coalesced');
	}

	handleResync(): void {
		this.refresh('fresh');
	}

	toggleFolder(path: string): void {
		const next = new Set(this.expandedFoldersValue);
		if (next.has(path)) next.delete(path);
		else next.add(path);
		this.expandedFoldersValue = next;
		this.options.onExpandedFolderIdsChange?.([...next].sort());
		this.emit();
	}

	select(path: string | undefined): void {
		this.selectedPathValue = path;
		this.emit();
	}

	setExpandedFolderIds(ids: readonly string[]): void {
		this.expandedFoldersValue = new Set(ids);
		this.emit();
	}

	dispose(): void {
		this.disposed = true;
		this.requestId += 1;
		if (this.timer !== undefined) {
			this.clearTimeoutFn(this.timer);
			this.timer = undefined;
		}
		this.unsubscribeWatch?.();
		this.unsubscribeWatch = undefined;
		const handle = this.watchHandle;
		this.watchHandle = undefined;
		if (handle && this.options.observationClient)
			void this.options.observationClient.stopWatch(handle.subscriptionId);
		this.listeners.clear();
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	private async run(mode: DocumentationRefreshMode): Promise<void> {
		const request = ++this.requestId;
		this.loadingValue = true;
		this.emit();
		try {
			const pages: DocumentationCatalog[] = [];
			let cursor: string | undefined;
			do {
				const page = await this.options.client.catalog(this.options.projectId, {
					...(mode === 'fresh' || this.catalogValue === undefined
						? {}
						: { knownRevision: this.catalogValue.revision }),
					...(cursor === undefined ? {} : { cursor }),
				});
				if (this.disposed || request !== this.requestId) return;
				pages.push(page);
				cursor = page.nextCursor;
			} while (cursor !== undefined && pages.at(-1)?.partial === true && pages.length < 8);
			const latest = mergePages(pages);
			if (this.disposed || request !== this.requestId) return;
			this.catalogValue = latest;
			this.errorValue = undefined;
		} catch (reason) {
			if (this.disposed || request !== this.requestId) return;
			this.errorValue = reason instanceof Error ? reason.message : String(reason);
		} finally {
			if (!this.disposed && request === this.requestId) {
				this.loadingValue = false;
				this.emit();
			}
		}
	}

	private async subscribeObservation(): Promise<void> {
		const observationClient = this.options.observationClient;
		if (observationClient === undefined) return;
		try {
			const handle = await observationClient.startWatch(this.options.projectId, '');
			if (this.disposed) {
				await observationClient.stopWatch(handle.subscriptionId);
				return;
			}
			this.watchHandle = handle;
			const batch = await observationClient.readWatch(handle);
			if (batch.resyncRequired) this.refresh('fresh');
			else if (batch.events.length) this.refresh('coalesced');
			this.unsubscribeWatch = await observationClient.subscribeWatch(
				handle,
				(event) => this.handleWatchEvent(event),
				() => this.handleResync(),
			);
		} catch {
			// Missing filesystem observation is an expected remote limit.
		}
	}
}

function mergePages(pages: readonly DocumentationCatalog[]): DocumentationCatalog {
	const latest = pages.at(-1);
	if (latest === undefined) throw new Error('documentation catalog page is missing');
	if (pages.length === 1) return latest;
	const documents = pages.flatMap((page) => page.documents);
	const folders = uniqueFolders(pages.flatMap((page) => page.folders));
	return Object.freeze({
		...latest,
		folders,
		documents,
	});
}

function uniqueFolders(
	folders: readonly DocumentationCatalog['folders'][number][],
): DocumentationCatalog['folders'] {
	const seen = new Set<string>();
	const result = [];
	for (const folder of folders) {
		if (seen.has(folder.relativePath)) continue;
		seen.add(folder.relativePath);
		result.push(folder);
	}
	return Object.freeze(result);
}
