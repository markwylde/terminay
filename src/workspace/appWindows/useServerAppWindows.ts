/**
 * App windows on every attached server, kept current.
 *
 * Windows are server-owned (ADR-0037): this is a read-through projection per
 * connection that serves `app-windows.v1`. Journal events carry only ids, so
 * each one is a cue to refetch the list. A server without the capability, or a
 * client without authority, simply has no windows.
 */

import {
	APP_WINDOW_MIRROR_CAPABILITY,
	APP_WINDOWS_CAPABILITY,
	type AppWindow,
	AppWindowClient,
	type TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { AppWindowMirrorHub } from './mirror/mirrorHub.ts';
import { createWindowLoader } from './windowLoader.ts';

export type AppWindowConnectionEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type ServerAppWindows = Readonly<{
	serverId: string;
	/** Oldest first. */
	windows: readonly AppWindow[];
	client: AppWindowClient;
	/** Present when this server mirrors views to the clients not in control. */
	mirror?: AppWindowMirrorHub;
	/** False until the first list has been read from this server. */
	loaded: boolean;
}>;

type Controller = Readonly<{
	applicationClient: TerminayClient;
	dispose: () => void;
}>;

function startController(
	entry: AppWindowConnectionEntry & { applicationClient: TerminayClient },
	publish: (serverId: string, next: ServerAppWindows | undefined) => void,
): Controller {
	const client = new AppWindowClient(
		new TerminayClientFacade(entry.applicationClient),
	);
	let mirror: AppWindowMirrorHub | undefined;
	if (entry.capabilities?.includes(APP_WINDOW_MIRROR_CAPABILITY) === true) {
		try {
			mirror = new AppWindowMirrorHub(client);
		} catch {
			// A transport without subscriptions shows windows without mirrors.
		}
	}
	const shared = mirror === undefined ? {} : { mirror };
	const loader = createWindowLoader<AppWindow>({
		list: () => client.list(),
		publish: (windows, loaded) =>
			publish(
				entry.serverId,
				Object.freeze({ serverId: entry.serverId, windows, client, loaded, ...shared }),
			),
	});
	let unsubscribe: (() => void) | undefined;
	try {
		// A change, and a notice that changes were missed, both mean: read again.
		unsubscribe = client.onChanged(() => void loader.load());
	} catch {
		// A transport without subscriptions still answers the initial read.
	}
	void loader.load();
	return Object.freeze({
		applicationClient: entry.applicationClient,
		dispose: () => {
			loader.dispose();
			unsubscribe?.();
			mirror?.dispose();
		},
	});
}

/** App windows of every attached server that serves them, by server id. */
export function useServerAppWindows(
	entries: readonly AppWindowConnectionEntry[],
): ReadonlyMap<string, ServerAppWindows> {
	const [byServer, setByServer] = useState<ReadonlyMap<string, ServerAppWindows>>(
		() => new Map(),
	);
	const controllers = useRef(new Map<string, Controller>());

	useEffect(() => {
		const publish = (serverId: string, next: ServerAppWindows | undefined) =>
			setByServer((previous) => {
				const map = new Map(previous);
				if (next === undefined) map.delete(serverId);
				else map.set(serverId, next);
				return map;
			});
		const wanted = new Map<
			string,
			AppWindowConnectionEntry & { applicationClient: TerminayClient }
		>();
		for (const entry of entries) {
			if (entry.applicationClient === undefined) continue;
			if (entry.capabilities?.includes(APP_WINDOWS_CAPABILITY) !== true) continue;
			wanted.set(entry.serverId, {
				...entry,
				applicationClient: entry.applicationClient,
			});
		}
		for (const [serverId, controller] of [...controllers.current]) {
			const entry = wanted.get(serverId);
			if (entry?.applicationClient === controller.applicationClient) continue;
			controller.dispose();
			controllers.current.delete(serverId);
			publish(serverId, undefined);
		}
		for (const [serverId, entry] of wanted) {
			if (controllers.current.has(serverId)) continue;
			controllers.current.set(serverId, startController(entry, publish));
		}
	}, [entries]);

	useEffect(
		() => () => {
			for (const controller of controllers.current.values()) controller.dispose();
			controllers.current.clear();
		},
		[],
	);

	return byServer;
}

export const AppWindowsContext = createContext<ReadonlyMap<string, ServerAppWindows>>(
	new Map(),
);

/** The windows one terminal owns, oldest first. */
export function useTerminalAppWindows(
	serverId: string | undefined,
	sessionId: string | undefined,
): readonly AppWindow[] {
	const byServer = useContext(AppWindowsContext);
	const server = serverId === undefined ? undefined : byServer.get(serverId);
	return useMemo(
		() =>
			server === undefined || sessionId === undefined
				? EMPTY
				: server.windows.filter((window) => window.terminalSessionId === sessionId),
		[server, sessionId],
	);
}

/** How many windows the terminals of one project own. */
export function useProjectAppWindowCount(
	serverId: string | undefined,
	projectId: string | undefined,
): number {
	const byServer = useContext(AppWindowsContext);
	const server = serverId === undefined ? undefined : byServer.get(serverId);
	return useMemo(
		() =>
			server === undefined || projectId === undefined
				? 0
				: server.windows.filter((window) => window.projectId === projectId).length,
		[server, projectId],
	);
}

const EMPTY: readonly AppWindow[] = Object.freeze([]);

/** `serverId:sessionId`, the key a pane and its windows share. */
export function appWindowPaneKey(serverId: string, sessionId: string): string {
	return `${serverId}:${sessionId}`;
}
