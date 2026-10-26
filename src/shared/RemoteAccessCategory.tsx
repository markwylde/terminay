import { type ReactNode, useEffect } from 'react';
import { useConnections } from './connections/ConnectionsContext';
import type {
	ConnectionsSettingsPresentation,
	SharedConnectionsRouteBodyProps,
} from './SharedConnectionsRouteBody';
import { SharedConnectionsRouteBody } from './SharedConnectionsRouteBody';

export type RemoteAccessRouteProps = Omit<
	SharedConnectionsRouteBodyProps,
	| 'state'
	| 'embedded'
	| 'presentation'
	| 'servers'
	| 'onRenameServer'
	| 'onForgetServer'
	| 'onServersChanged'
	| 'settings'
> &
	Readonly<{ exposurePanel?: ReactNode }>;

/** The Remote Access category of Settings: this server's exposure and the saved servers. */
export function RemoteAccessCategory({
	settings,
	...props
}: RemoteAccessRouteProps &
	Readonly<{ settings: ConnectionsSettingsPresentation }>) {
	// The saved servers are the host's remembered profiles: the same list the
	// connection menu offers to attach. They do not follow the server selector.
	const { profiles, refreshProfiles, renameProfile, forgetProfile } =
		useConnections();
	useEffect(() => {
		refreshProfiles();
	}, [refreshProfiles]);
	return (
		<SharedConnectionsRouteBody
			presentation="settings"
			state="ready"
			settings={settings}
			{...(props.profileStore === undefined
				? {
						servers: profiles,
						onServersChanged: refreshProfiles,
						...(renameProfile === undefined
							? {}
							: { onRenameServer: renameProfile }),
						...(forgetProfile === undefined
							? {}
							: { onForgetServer: forgetProfile }),
					}
				: {})}
			{...props}
		/>
	);
}
