import {
	AutomationClient,
	MacroClient,
	SettingsClient,
	ShellProfilesClient,
	type TerminayClient,
	TerminayClientFacade,
	WorkflowClient,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnections } from '../shared/connections/ConnectionsContext';
import { type Bundle, bundleSnapshot } from './bundle';
import { type ColumnSnapshot, type ImportExportClients, readColumn } from './kinds';
import type { MatrixColumn } from './matrix';

export const BUNDLE_COLUMN_ID = 'bundle';

type ConnectionClients = Readonly<{
	clients: ImportExportClients;
	/** Calls back whenever one of the five kinds changes on that server. */
	subscribe: (listener: () => void) => () => void;
}>;

/** Each server is reached only through its own client (ADR-0111). */
function createConnectionClients(client: TerminayClient): ConnectionClients {
	const facade = new TerminayClientFacade(client);
	const macros = new MacroClient(facade);
	const workflows = new WorkflowClient(facade);
	const shellProfiles = new ShellProfilesClient(facade);
	const automations = new AutomationClient(facade);
	const settings = new SettingsClient(facade);
	return Object.freeze({
		clients: {
			macros,
			workflows,
			shellProfiles,
			automations,
			settings,
		} as unknown as ImportExportClients,
		subscribe(listener: () => void) {
			const stops: (() => void)[] = [];
			const tryOn = (subscribe: () => () => void) => {
				try {
					stops.push(subscribe());
				} catch {
					// A server without that event is refreshed on the others.
				}
			};
			tryOn(() => macros.onChanged(() => listener()));
			tryOn(() => workflows.onTemplatesChanged(() => listener()));
			tryOn(() => automations.onChanged(() => listener()));
			tryOn(() => settings.onChanged(() => listener()));
			return () => {
				for (const stop of stops) stop();
			};
		},
	});
}

export type ImportExportColumns = Readonly<{
	columns: readonly MatrixColumn[];
	/** The column of the server the window is working in. */
	activeColumnId?: string;
	primaryColumnId?: string;
	clientsFor: (columnId: string) => ImportExportClients | undefined;
	/** Reads every ready column again. */
	refresh: () => void;
	/** Attaches a remembered server to this window. */
	attach: (columnId: string) => void;
	bundle?: ImportedBundle;
	setBundle: (bundle: ImportedBundle | undefined) => void;
}>;

/** A validated bundle and the name of the file it came from. */
export type ImportedBundle = Readonly<{ bundle: Bundle; fileName: string }>;

const PHASE_TEXT: Readonly<Record<string, string>> = Object.freeze({
	connecting: 'Connecting',
	reconnecting: 'Reconnecting',
	unreachable: 'Unreachable',
	incompatible: 'Incompatible',
});

/**
 * One column per attached server, plus an imported bundle. A column is read
 * when its connection becomes ready and again whenever that server reports a
 * change to any of the kinds.
 */
export function useImportExportColumns(): ImportExportColumns {
	const {
		connections,
		activeServerId,
		profiles,
		refreshProfiles,
		supportsAttach,
		attach,
		currentProfileId,
	} = useConnections();
	useEffect(() => {
		if (supportsAttach) refreshProfiles();
	}, [refreshProfiles, supportsAttach]);
	const [snapshots, setSnapshots] = useState<ReadonlyMap<string, ColumnSnapshot>>(
		() => new Map(),
	);
	const [bundle, setBundle] = useState<ImportedBundle>();
	const clientCache = useRef(new WeakMap<TerminayClient, ConnectionClients>());
	const readGeneration = useRef(new Map<string, number>());

	const ready = useMemo(
		() =>
			connections.flatMap((connection) => {
				if (connection.phase !== 'ready' || connection.client === undefined) return [];
				let entry = clientCache.current.get(connection.client);
				if (entry === undefined) {
					entry = createConnectionClients(connection.client);
					clientCache.current.set(connection.client, entry);
				}
				return [{ id: connection.profileId, entry }];
			}),
		[connections],
	);

	const read = useCallback((id: string, clients: ImportExportClients) => {
		const generation = (readGeneration.current.get(id) ?? 0) + 1;
		readGeneration.current.set(id, generation);
		void readColumn(clients).then((snapshot) => {
			if (readGeneration.current.get(id) !== generation) return;
			setSnapshots((current) => new Map(current).set(id, snapshot));
		});
	}, []);

	useEffect(() => {
		const stops: (() => void)[] = [];
		for (const { id, entry } of ready) {
			read(id, entry.clients);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const stop = entry.subscribe(() => {
				if (timer !== undefined) clearTimeout(timer);
				timer = setTimeout(() => read(id, entry.clients), 150);
			});
			stops.push(() => {
				if (timer !== undefined) clearTimeout(timer);
				stop();
			});
		}
		return () => {
			for (const stop of stops) stop();
		};
	}, [read, ready]);

	const columns = useMemo((): MatrixColumn[] => {
		const readyIds = new Set(ready.map(({ id }) => id));
		const serverColumns = connections.map((connection): MatrixColumn => {
			const snapshot = snapshots.get(connection.profileId);
			const isReady = readyIds.has(connection.profileId) && snapshot !== undefined;
			return {
				id: connection.profileId,
				label: connection.label,
				readOnly: false,
				ready: isReady,
				...(isReady
					? { snapshot }
					: {
							phase: readyIds.has(connection.profileId)
								? 'Reading'
								: (PHASE_TEXT[connection.phase] ?? 'Not ready'),
						}),
			};
		});
		// A remembered server this window has not attached is listed so it can
		// be attached from here; until then it has no data.
		const unattached = supportsAttach
			? profiles.filter(
					(profile) =>
						profile.isLocal !== true &&
						profile.attached !== true &&
						profile.id !== currentProfileId &&
						!connections.some(
							(connection) =>
								connection.profileId === profile.id ||
								(profile.serverId !== undefined &&
									connection.serverId === profile.serverId),
						),
				)
			: [];
		const unattachedColumns = unattached.map(
			(profile): MatrixColumn => ({
				id: profile.id,
				label: profile.label,
				readOnly: false,
				ready: false,
				phase: 'Not attached',
				attachable: true,
			}),
		);
		const withRemembered = [...serverColumns, ...unattachedColumns];
		return bundle === undefined
			? withRemembered
			: [
					...withRemembered,
					{
						id: BUNDLE_COLUMN_ID,
						label: bundle.fileName,
						readOnly: true,
						ready: true,
						snapshot: bundleSnapshot(bundle.bundle),
					},
				];
	}, [bundle, connections, currentProfileId, profiles, ready, snapshots, supportsAttach]);

	const clientsFor = useCallback(
		(columnId: string) => ready.find(({ id }) => id === columnId)?.entry.clients,
		[ready],
	);
	const refresh = useCallback(() => {
		for (const { id, entry } of ready) read(id, entry.clients);
	}, [read, ready]);

	const activeColumnId = connections.find(
		(connection) => activeServerId !== undefined && connection.serverId === activeServerId,
	)?.profileId;
	const primaryColumnId = connections.find((connection) => connection.role === 'primary')
		?.profileId;

	return {
		columns,
		...(activeColumnId === undefined ? {} : { activeColumnId }),
		...(primaryColumnId === undefined ? {} : { primaryColumnId }),
		clientsFor,
		refresh,
		attach,
		...(bundle === undefined ? {} : { bundle }),
		setBundle,
	};
}
