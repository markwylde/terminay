/**
 * The window's connections, as React sees them.
 *
 * Everything below this provider reads its client from the connection that
 * owns what it is showing — the active tab's server — rather than from one
 * ambient client. A surface that cannot find its connection renders inert;
 * that is the same state an unreachable or incompatible server is in, and it
 * is deliberately not an error.
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import type {
	ConnectionRegistry,
	ConnectionsSnapshot,
	WorkspaceConnection,
} from './connectionRegistry';
import {
	buildComposition,
	type CompositionPersistence,
	type CompositionSession,
	type CompositionTabHandle,
	createCompositionSession,
	NO_COMPOSITION_PERSISTENCE,
} from './composition';
import type {
	ConnectionProfileSummary,
	WorkspaceConnectionHost,
} from './hostConnections';

export type ConnectionsContextValue = Readonly<{
	/** The connection whose bundle this window runs. */
	primary?: WorkspaceConnection;
	/** Primary first, then attached in attach order. */
	connections: readonly WorkspaceConnection[];
	byServerId: ReadonlyMap<string, WorkspaceConnection>;
	/** False when this host has no `connections` capability. The control then
	 * shows the one connection and offers no attaching. */
	supportsAttach: boolean;
	/** Remembered profiles this window could attach. */
	profiles: readonly ConnectionProfileSummary[];
	refreshProfiles: () => void;
	attach: (profileId: string) => void;
	detach: (profileId: string) => Promise<void>;
	/** The window's remembered tab order across every attached server. A hint
	 * validated against what exists, never an instruction. */
	tabOrder: readonly CompositionTabHandle[];
	/** Record a new order. Persisted through the host beside window geometry;
	 * never sent to a server. */
	setTabOrder: (order: readonly CompositionTabHandle[]) => void;
	/** True once the remembered composition has been read back, so the strip
	 * does not persist a default order over a real one. */
	compositionRestored: boolean;
	/** The server the window is currently working in: the active tab's. Every
	 * per-server surface defaults to it, so opening Settings shows the server
	 * the person was already looking at. */
	activeServerId?: string;
	/** Published by the workspace as the active tab moves. */
	setActiveServerId: (serverId: string | undefined) => void;
}>;

const EMPTY: ConnectionsContextValue = Object.freeze({
	connections: Object.freeze([]),
	byServerId: new Map<string, WorkspaceConnection>(),
	supportsAttach: false,
	profiles: Object.freeze([]),
	refreshProfiles: () => undefined,
	attach: () => undefined,
	detach: async () => undefined,
	tabOrder: Object.freeze([]),
	setTabOrder: () => undefined,
	compositionRestored: false,
	setActiveServerId: () => undefined,
});

const ConnectionsContext = createContext<ConnectionsContextValue>(EMPTY);

export function ConnectionsProvider({
	children,
	composition = NO_COMPOSITION_PERSISTENCE,
	host,
	registry,
}: Readonly<{
	children: ReactNode;
	/** Where this window's composition lives between runs. */
	composition?: CompositionPersistence;
	/** Absent while the primary is still connecting: the host that hands out
	 * attached connections is only known once the bootstrap says which it is. */
	host?: WorkspaceConnectionHost;
	registry: ConnectionRegistry;
}>) {
	const snapshot = useConnectionsSnapshot(registry);
	const [profiles, setProfiles] = useState<readonly ConnectionProfileSummary[]>(
		EMPTY.profiles,
	);
	const attach = useCallback(
		(profileId: string) => {
			registry.attach(profileId);
		},
		[registry],
	);
	const detach = useCallback(
		async (profileId: string) => {
			await registry.detach(profileId);
			// Detaching closes this window's connection and nothing on the server,
			// so the profile stays offerable straight away.
			await host?.detach(profileId).catch(() => undefined);
		},
		[host, registry],
	);
	const refreshProfiles = useCallback(() => {
		if (host === undefined) return;
		void host
			.listProfiles()
			.then(setProfiles)
			.catch(() => undefined);
	}, [host]);
	useEffect(() => {
		refreshProfiles();
		return host?.subscribeProfiles?.(setProfiles);
	}, [host, refreshProfiles]);
	const [activeServerId, setActiveServerId] = useState<string>();
	const [tabOrder, setRememberedTabOrder] = useState<
		readonly CompositionTabHandle[]
	>(EMPTY.tabOrder);
	// Restoring the composition has exactly one owner: this effect. It reads the
	// record, re-attaches the servers the window had, and only then declares the
	// composition restored. The session refuses to persist until then, so no
	// render order can write an empty attached set over a real one, and a window
	// that changes where its composition lives starts a new session rather than
	// carrying the old one's open gate.
	const session = useMemo(
		() => createCompositionSession(composition),
		[composition],
	);
	const [restoredSession, setRestoredSession] = useState<CompositionSession>();
	const compositionRestored = restoredSession === session;
	useEffect(() => {
		let cancelled = false;
		void session
			.restore((restored) => {
				if (cancelled) return;
				setRememberedTabOrder(restored.tabOrder);
				// Servers that cannot be reached come back attached and
				// unreachable, with their tabs greyed, rather than silently
				// disappearing from the strip.
				for (const attachment of restored.attached)
					registry.attach(attachment.profileId);
			})
			.then(() => {
				if (!cancelled) setRestoredSession(() => session);
			});
		return () => {
			cancelled = true;
		};
	}, [registry, session]);
	const primaryProfileId = snapshot.primary?.profileId;
	const attachedProfileIds = snapshot.connections
		.filter((connection) => connection.role === 'attached')
		.map((connection) => connection.profileId)
		.join('\u0000');
	const setTabOrder = useCallback(
		(order: readonly CompositionTabHandle[]) => {
			setRememberedTabOrder(order);
		},
		[],
	);
	// The composition is written whenever what it describes changes: the
	// attached set, or the order the tabs are in.
	useEffect(() => {
		if (!compositionRestored || primaryProfileId === undefined) return;
		session.persist(
			buildComposition(
				primaryProfileId,
				attachedProfileIds.length === 0
					? []
					: attachedProfileIds
							.split('\u0000')
							.map((profileId) => ({ profileId })),
				tabOrder,
			),
		);
	}, [
		attachedProfileIds,
		compositionRestored,
		primaryProfileId,
		session,
		tabOrder,
	]);
	const value = useMemo<ConnectionsContextValue>(
		() =>
			Object.freeze({
				connections: snapshot.connections,
				byServerId: snapshot.byServerId,
				supportsAttach: host?.supportsAttach === true,
				profiles,
				refreshProfiles,
				attach,
				detach,
				tabOrder,
				setTabOrder,
				compositionRestored,
				setActiveServerId,
				...(activeServerId === undefined ? {} : { activeServerId }),
				...(snapshot.primary === undefined
					? {}
					: { primary: snapshot.primary }),
			}),
		[
			activeServerId,
			attach,
			compositionRestored,
			detach,
			host,
			profiles,
			refreshProfiles,
			setTabOrder,
			snapshot,
			tabOrder,
		],
	);
	return (
		<ConnectionsContext.Provider value={value}>
			{children}
		</ConnectionsContext.Provider>
	);
}

/** Subscribe to a registry without a provider, for entries that own one. */
export function useConnectionsSnapshot(
	registry: ConnectionRegistry,
): ConnectionsSnapshot {
	return useSyncExternalStore(
		useCallback((listener) => registry.subscribe(listener), [registry]),
		useCallback(() => registry.snapshot, [registry]),
		useCallback(() => registry.snapshot, [registry]),
	);
}

export function useConnections(): ConnectionsContextValue {
	return useContext(ConnectionsContext);
}

/** The connection that owns a server's projects, panels, and terminals.
 * Undefined once that server is detached, which is what makes the surfaces
 * reading it fall back to inert rather than to another server's state. */
export function useServerConnection(
	serverId: string | undefined,
): WorkspaceConnection | undefined {
	const { byServerId, primary } = useConnections();
	if (serverId === undefined) return primary;
	return byServerId.get(serverId);
}

/** True when the window is showing tabs from more than one server, which is
 * the only time a surface names the server it is talking about. */
export function useNamesServers(): boolean {
	return useConnections().connections.length > 1;
}
