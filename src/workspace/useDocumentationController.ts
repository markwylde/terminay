import type { DocumentationClient, FileObservationClient } from '@terminay/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	DocumentationCatalogController,
	type DocumentationCatalogSnapshot,
} from './DocumentationCatalogController';

/** Keeps the Markdown catalog server-owned while retaining the last good tree
 * during file-system churn. It watches the project root rather than expanding
 * Explorer folders in the renderer. */
export function useDocumentationController(options: {
	readonly enabled: boolean;
	readonly client?: DocumentationClient;
	readonly observationClient?: FileObservationClient;
	readonly projectId: string;
	readonly scopeKey: string;
	readonly expandedFolderIds: readonly string[];
	readonly onExpandedFolderIdsChange: (ids: string[]) => void;
}) {
	const {
		enabled,
		client,
		observationClient,
		projectId,
		scopeKey,
		expandedFolderIds,
		onExpandedFolderIdsChange,
	} = options;
	const [snapshot, setSnapshot] = useState<DocumentationCatalogSnapshot>({
		loading: false,
		partial: false,
		expandedFolders: new Set(expandedFolderIds),
	});
	const controllerRef = useRef<DocumentationCatalogController | undefined>(undefined);

	useEffect(() => {
		if (!enabled || client === undefined) {
			controllerRef.current?.dispose();
			controllerRef.current = undefined;
			setSnapshot({
				loading: false,
				partial: false,
				expandedFolders: new Set(expandedFolderIds),
			});
			return;
		}
		const controller = new DocumentationCatalogController({
			client,
			observationClient,
			projectId,
			scopeKey,
			expandedFolderIds,
			onExpandedFolderIdsChange,
		});
		controllerRef.current = controller;
		const unsubscribe = controller.subscribe(() => setSnapshot(controller.snapshot));
		setSnapshot(controller.snapshot);
		void controller.start();
		return () => {
			unsubscribe();
			controller.dispose();
			if (controllerRef.current === controller) controllerRef.current = undefined;
		};
	}, [client, enabled, observationClient, onExpandedFolderIdsChange, projectId, scopeKey]);

	useEffect(() => {
		controllerRef.current?.setExpandedFolderIds(expandedFolderIds);
	}, [expandedFolderIds]);

	const toggleFolder = useCallback((path: string) => {
		controllerRef.current?.toggleFolder(path);
	}, []);

	return {
		catalog: snapshot.catalog,
		error: snapshot.error,
		expandedFolders: snapshot.expandedFolders,
		loading: snapshot.loading,
		refresh: () => controllerRef.current?.refresh('fresh'),
		toggleFolder,
	} as const;
}
