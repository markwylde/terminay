import type {
	DocumentationCatalog,
	DocumentationClient,
	FileObservationClient,
	FileWatchHandle,
} from '@terminay/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_DELAY_MS = 150;

/** Keeps the Markdown catalog server-owned while retaining the last good tree
 * during file-system churn.  It deliberately watches the project root rather
 * than expanding Explorer folders in the renderer. */
export function useDocumentationController(options: {
	readonly enabled: boolean;
	readonly watchEnabled?: boolean;
	readonly client?: DocumentationClient;
	readonly observationClient?: FileObservationClient;
	readonly projectId: string;
	readonly scopeKey: string;
	readonly expandedFolderIds: readonly string[];
	readonly onExpandedFolderIdsChange: (ids: string[]) => void;
	readonly onCatalogLoaded?: (hasDocuments: boolean) => void;
}) {
	const {
		enabled,
		watchEnabled = enabled,
		client,
		observationClient,
		projectId,
		scopeKey,
		expandedFolderIds,
		onExpandedFolderIdsChange,
		onCatalogLoaded,
	} = options;
	const [catalog, setCatalog] = useState<DocumentationCatalog | undefined>(
		undefined,
	);
	const [error, setError] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(false);
	const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(
		() => new Set(expandedFolderIds),
	);
	const requestRef = useRef(0);
	const timerRef = useRef<number | undefined>(undefined);
	const catalogRef = useRef<DocumentationCatalog | undefined>(undefined);
	const onCatalogLoadedRef = useRef(onCatalogLoaded);
	catalogRef.current = catalog;
	onCatalogLoadedRef.current = onCatalogLoaded;
	const refresh = useCallback(
		(immediate = true) => {
			if (!enabled || client === undefined) return;
			const run = () => {
				const request = ++requestRef.current;
				setLoading(true);
				void client
					.catalog(projectId, catalogRef.current?.revision)
					.then((next) => {
						if (request !== requestRef.current) return;
						setCatalog(next);
						onCatalogLoadedRef.current?.(next.documents.length > 0);
						setError(undefined);
					})
					.catch((reason: unknown) => {
						if (request !== requestRef.current) return;
						setError(reason instanceof Error ? reason.message : String(reason));
					})
					.finally(() => {
						if (request === requestRef.current) setLoading(false);
					});
			};
			if (immediate) {
				run();
				return;
			}
			if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
			timerRef.current = window.setTimeout(() => {
				timerRef.current = undefined;
				run();
			}, REFRESH_DELAY_MS);
		},
		[client, enabled, projectId, scopeKey],
	);
	useEffect(() => {
		setCatalog(undefined);
		setError(undefined);
		if (enabled) refresh();
	}, [enabled, projectId, scopeKey, refresh]);
	useEffect(
		() => setExpandedFolders(new Set(expandedFolderIds)),
		[expandedFolderIds],
	);
	useEffect(() => {
		if (!watchEnabled || observationClient === undefined || client === undefined)
			return;
		let disposed = false;
		let handle: FileWatchHandle | undefined;
		let unsubscribe: (() => void) | undefined;
		void observationClient
			.startWatch(projectId, '')
			.then(async (next) => {
				if (disposed) {
					await observationClient.stopWatch(next.subscriptionId);
					return;
				}
				handle = next;
				const batch = await observationClient.readWatch(next);
				if (batch.resyncRequired || batch.events.length) refresh(false);
				unsubscribe = await observationClient.subscribeWatch(
					next,
					() => {
						window.dispatchEvent(
							new CustomEvent('terminay-documentation-change', {
								detail: { projectId },
							}),
						);
						refresh(false);
					},
					() => {
						window.dispatchEvent(
							new CustomEvent('terminay-documentation-change', {
								detail: { projectId },
							}),
						);
						refresh(false);
					},
				);
			})
			.catch((reason: unknown) => {
				if (!disposed)
					setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			disposed = true;
			if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
			unsubscribe?.();
			if (handle) void observationClient.stopWatch(handle.subscriptionId);
		};
	}, [client, observationClient, projectId, refresh, scopeKey, watchEnabled]);
	const toggleFolder = useCallback(
		(path: string) =>
			setExpandedFolders((current) => {
				const next = new Set(current);
				next.has(path) ? next.delete(path) : next.add(path);
				onExpandedFolderIdsChange([...next].sort());
				return next;
			}),
		[onExpandedFolderIdsChange],
	);
	return {
		catalog,
		error,
		expandedFolders,
		loading,
		refresh: () => refresh(true),
		toggleFolder,
	} as const;
}
