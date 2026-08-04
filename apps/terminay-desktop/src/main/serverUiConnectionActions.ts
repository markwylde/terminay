import type { DesktopConnectionHost } from './connectionHost.js';
import {
	type ConnectionProfile,
	createRemoteProfile,
} from './connectionProfiles.js';
import type { WindowSelection } from './windowRegistry.js';

export type DesktopServerUiConnectionAction =
	| { readonly type: 'connection.select'; readonly profileId: string }
	| {
			readonly type: 'connection.remember';
			readonly profile: DesktopServerUiProfile;
	  }
	| {
			readonly type: 'connection.rename';
			readonly profileId: string;
			readonly label: string;
	  }
	| { readonly type: 'connection.forget'; readonly profileId: string }
	| { readonly type: 'connection.revoke'; readonly profileId: string }
	| { readonly type: 'connection.expose'; readonly profileId: string }
	| { readonly type: 'connection.pair'; readonly pairingUrl: string };

export interface DesktopServerUiProfile {
	readonly id: string;
	readonly serverId: string;
	readonly label: string;
	readonly origin: string;
	readonly status:
		| 'connected'
		| 'connecting'
		| 'offline'
		| 'revoked'
		| 'unreachable';
	readonly isLocal?: boolean;
}

export interface DesktopServerUiConnectionAdapters {
	/** Present the exact persisted window binding chosen by the host. */
	readonly present: (selection: WindowSelection) => Promise<void> | void;
	/** Revoke the device/server grant before the local profile is marked revoked. */
	readonly revoke?: (profile: ConnectionProfile) => Promise<void> | void;
	readonly expose?: (profile: ConnectionProfile) => Promise<void> | void;
	/** Consume the one-time URL and return only sanitized profile metadata. */
	readonly pair?: (pairingUrl: string) => Promise<ConnectionProfile>;
}

export interface DesktopServerUiConnectionBinding {
	readonly capabilities: {
		readonly connectionProfiles: boolean;
		readonly serverExposure: boolean;
	};
	readonly profiles: readonly DesktopServerUiProfile[];
	readonly onHostAction: (
		action: DesktopServerUiConnectionAction,
	) => Promise<void>;
}

/**
 * Project the persisted Desktop connection host into the server-UI window.
 * The renderer receives metadata only; all mutations and native-window
 * selection remain in this privileged host adapter.
 */
export function createDesktopServerUiConnectionBinding(
	host: DesktopConnectionHost,
	adapters: DesktopServerUiConnectionAdapters,
): DesktopServerUiConnectionBinding {
	return Object.freeze({
		capabilities: Object.freeze({
			connectionProfiles: host.host.capabilities.has('connectionProfiles'),
			serverExposure: host.host.capabilities.has('serverExposure'),
		}),
		profiles: projectProfiles(host.profiles.list()),
		onHostAction: async (action: DesktopServerUiConnectionAction) => {
			switch (action.type) {
				case 'connection.select': {
					const result = await host.openProfileWindow(action.profileId);
					await adapters.present(result.selection);
					return;
				}
				case 'connection.remember':
					host.profiles.add(createRemoteProfile(action.profile));
					await host.profiles.flush();
					return;
				case 'connection.rename':
					host.profiles.rename(action.profileId, action.label);
					await host.profiles.flush();
					return;
				case 'connection.forget':
					await host.disconnect(action.profileId);
					host.profiles.forget(action.profileId, true);
					await host.profiles.flush();
					return;
				case 'connection.revoke': {
					const profile = requireRemote(host, action.profileId);
					await adapters.revoke?.(profile);
					await host.disconnect(profile.id);
					host.profiles.revoke(profile.id, true);
					await host.profiles.flush();
					return;
				}
				case 'connection.expose': {
					const profile = host.currentConnectionHeader;
					if (profile?.profileId !== action.profileId)
						throw new Error('only the current profile can be exposed');
					const stored = host.profiles.get(action.profileId);
					if (stored === undefined)
						throw new Error('unknown connection profile');
					await adapters.expose?.(stored);
					return;
				}
				case 'connection.pair': {
					if (adapters.pair === undefined)
						throw new Error('pairing is unavailable');
					const profile = await adapters.pair(action.pairingUrl);
					if (
						profile.kind !== 'remote' ||
						profile.immutable ||
						profile.origin.includes('#')
					) {
						throw new Error('pairing returned unsafe profile metadata');
					}
					host.profiles.add(profile);
					await host.profiles.flush();
				}
			}
		},
	});
}

function requireRemote(
	host: DesktopConnectionHost,
	profileId: string,
): ConnectionProfile {
	const profile = host.profiles.get(profileId);
	if (profile === undefined)
		throw new Error(`unknown connection profile: ${profileId}`);
	if (profile.kind !== 'remote' || profile.immutable)
		throw new Error('Local profile cannot be changed');
	return profile;
}

function projectProfiles(
	profiles: readonly ConnectionProfile[],
): readonly DesktopServerUiProfile[] {
	return Object.freeze(
		profiles.map((profile) =>
			Object.freeze({
				id: profile.id,
				serverId: profile.serverId,
				label: profile.label,
				origin: profile.origin,
				status:
					profile.status === 'connected'
						? 'connected'
						: profile.status === 'connecting'
							? 'connecting'
							: profile.status === 'revoked'
								? 'revoked'
								: profile.status === 'failed' ||
										profile.status === 'identity-mismatch' ||
										profile.status === 'incompatible'
									? 'unreachable'
									: 'offline',
				...(profile.kind === 'local' ? { isLocal: true } : {}),
			}),
		),
	);
}
