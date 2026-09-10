/**
 * Where attached connections come from.
 *
 * Hosts are protocol-blind. They own every credential and every transport and
 * hand this bundle one opaque byte endpoint per connection through the
 * versioned `connections` host capability. Nothing in here decodes a frame or
 * knows a device key; it asks the host to open a profile and wraps whatever
 * byte channel comes back.
 *
 * Two hosts implement it. Desktop main answers `connections.attach` with a
 * connection id whose bytes flow on its byte bridge. A browser session's
 * manager answers through the framed-host schema with a `MessagePort`. A host
 * that offers neither supports the primary connection only, which is the state
 * every host is in until its side of this change lands.
 */

import type {
	ByteTransport,
	TerminayHostConnectionStatus,
	TerminayHostContext,
	TerminayWorkspaceComposition,
} from '@terminay/protocol';
import {
	acquireDesktopAttachedTransport,
	type DesktopByteBridge,
} from '../../web/desktopByteTransport';
import type { SessionTransportHost } from '../../web/sessionTransportHost';

/** One remembered profile, as the connections control shows it. Both hosts
 * project the same sanitized fields: no origin, credential, or workspace
 * value crosses into the bundle. */
export type ConnectionProfileSummary = Readonly<{
	id: string;
	label: string;
	status: TerminayHostConnectionStatus;
	isLocal?: boolean;
	serverId?: string;
	/** True while this window already holds a connection to the profile. */
	attached?: boolean;
}>;

export type AttachedTransport = Readonly<{
	transport: ByteTransport;
	label: string;
	origin?: string;
	/** The host's own idea of which server this profile reaches, when it has
	 * one. The hello is still what decides; this only labels the wait. */
	serverId?: string;
}>;

/** What the workspace needs from a host to run more than one connection. */
export interface WorkspaceConnectionHost {
	/** False when this host has no `connections` capability: the window runs
	 * its primary connection and the connections control offers no attaching. */
	readonly supportsAttach: boolean;
	listProfiles(): Promise<readonly ConnectionProfileSummary[]>;
	attach(profileId: string): Promise<AttachedTransport>;
	detach(profileId: string): Promise<void>;
	readComposition(): Promise<TerminayWorkspaceComposition | undefined>;
	writeComposition(composition: TerminayWorkspaceComposition): Promise<void>;
	subscribeProfiles?(
		listener: (profiles: readonly ConnectionProfileSummary[]) => void,
	): () => void;
}

export const NO_ATTACHED_CONNECTIONS: WorkspaceConnectionHost = Object.freeze({
	supportsAttach: false,
	listProfiles: async () => Object.freeze([]),
	attach: async () => {
		throw new Error('This host cannot attach a second server.');
	},
	detach: async () => undefined,
	readComposition: async () => undefined,
	writeComposition: async () => undefined,
});

type HostActionRequester = Readonly<{
	requestAction(
		action: unknown,
		options?: Readonly<{ userGesture?: boolean }>,
	): Promise<unknown>;
}>;

/**
 * Desktop.
 *
 * Main answers `connections.attach` with a connection id, and the preload's
 * byte bridge turns that id into its own channel. The primary endpoint is
 * untouched, so a failing attached server cannot disturb the window's own
 * connection.
 */
export function createDesktopConnectionHost(
	context: TerminayHostContext,
	host: HostActionRequester,
	bytes: DesktopByteBridge | undefined,
): WorkspaceConnectionHost {
	const supportsAttach =
		context.capabilities.connections !== undefined &&
		bytes !== undefined &&
		bytes.version >= 2 &&
		typeof bytes.openConnection === 'function';
	const requestAction = async (action: unknown): Promise<unknown> =>
		host.requestAction(
			{
				bridgeVersion: context.hostBridgeVersion,
				profileId: context.profileId,
				schemaVersion: context.schemaVersion,
				serverId: context.serverId,
				sourceId: context.sourceId,
				userGesture: true,
				windowId: context.windowId,
				action,
			},
			{ userGesture: true },
		);
	const connectionHost: WorkspaceConnectionHost = {
		supportsAttach,
		listProfiles: async () => {
			const known = readProfiles(context.profiles) ?? Object.freeze([]);
			if (!supportsAttach) return known;
			const result = await requestAction({ type: 'connections.list' }).catch(
				() => undefined,
			);
			return readProfiles(result) ?? known;
		},
		attach: async (profileId) => {
			const attachment = readAttachment(
				await requestAction({ type: 'connections.attach', profileId }),
			);
			if (attachment === undefined)
				throw new Error('The host did not open a connection for that profile.');
			const transport = await acquireDesktopAttachedTransport(
				bytes,
				attachment.connectionId,
			);
			const profile = (context.profiles ?? []).find(
				(entry) => entry.id === profileId,
			);
			return Object.freeze({
				transport,
				label: profile?.label ?? profileId,
				...(attachment.serverId === undefined
					? {}
					: { serverId: attachment.serverId }),
			});
		},
		detach: async (profileId) => {
			if (!supportsAttach) return;
			await requestAction({ type: 'connections.detach', profileId }).catch(
				() => undefined,
			);
		},
		// The host hands the restored composition back in the bootstrap context,
		// beside window geometry. There is nothing further to ask it for.
		readComposition: async () => context.composition,
		writeComposition: async (composition) => {
			if (!supportsAttach) return;
			await requestAction({
				type: 'connections.composition.write',
				composition,
			}).catch(() => undefined);
		},
	};
	return Object.freeze(connectionHost);
}

/** A browser session. The manager holds every origin's credential and opens
 * the attached transport itself, so no server's code is on another server's
 * credential path. */
export function createBrowserConnectionHost(
	host: SessionTransportHost,
): WorkspaceConnectionHost {
	const supportsAttach = typeof host.connectAttached === 'function';
	const connectionHost: WorkspaceConnectionHost = {
		supportsAttach,
		listProfiles: async () =>
			readProfiles(await host.listConnections?.().catch(() => undefined)) ??
			Object.freeze([]),
		attach: async (profileId) => {
			if (host.connectAttached === undefined)
				throw new Error('This browser session cannot attach a second server.');
			const opened = await host.connectAttached(profileId);
			return Object.freeze({
				transport: opened.transport,
				label: profileId,
				serverId: opened.serverId,
			});
		},
		detach: async (profileId) => {
			await host.detachConnection?.(profileId).catch(() => undefined);
		},
		readComposition: async () =>
			host.readComposition === undefined
				? undefined
				: await host.readComposition().catch(() => undefined),
		writeComposition: async (composition) => {
			await host.writeComposition?.(composition).catch(() => undefined);
		},
		...(host.subscribeConnections === undefined
			? {}
			: {
					subscribeProfiles: (listener) =>
						host.subscribeConnections!((profiles) => {
							listener(readProfiles(profiles) ?? Object.freeze([]));
						}),
				}),
	};
	return Object.freeze(connectionHost);
}

function readAttachment(
	value: unknown,
): Readonly<{ connectionId: string; serverId?: string }> | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.connectionId !== 'string' || record.connectionId === '')
		return undefined;
	return Object.freeze({
		connectionId: record.connectionId,
		...(typeof record.serverId === 'string'
			? { serverId: record.serverId }
			: {}),
	});
}

const CONNECTION_STATUSES: ReadonlySet<string> = new Set([
	'connected',
	'connecting',
	'offline',
	'unavailable',
	'unauthenticated',
	'incompatible',
]);

/** Both hosts answer with the same sanitized shape; anything that is not one
 * is dropped rather than half-trusted. */
function readProfiles(
	value: unknown,
): readonly ConnectionProfileSummary[] | undefined {
	const list = Array.isArray(value)
		? value
		: typeof value === 'object' && value !== null
			? (value as Record<string, unknown>).profiles
			: undefined;
	if (!Array.isArray(list)) return undefined;
	const profiles: ConnectionProfileSummary[] = [];
	for (const entry of list) {
		if (typeof entry !== 'object' || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.id !== 'string' || typeof record.label !== 'string')
			continue;
		const status =
			typeof record.status === 'string' && CONNECTION_STATUSES.has(record.status)
				? (record.status as TerminayHostConnectionStatus)
				: 'unavailable';
		profiles.push(
			Object.freeze({
				id: record.id,
				label: record.label,
				status,
				...(record.isLocal === true ? { isLocal: true } : {}),
				...(typeof record.serverId === 'string'
					? { serverId: record.serverId }
					: {}),
				...(typeof record.attached === 'boolean'
					? { attached: record.attached }
					: {}),
			}),
		);
	}
	return Object.freeze(profiles);
}
