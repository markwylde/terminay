import { type ReactNode, useEffect } from 'react';
import { useConnections } from './connections/ConnectionsContext';
import type { SharedConnectionsRouteBodyProps } from './SharedConnectionsRouteBody';
import { SharedConnectionsRouteBody } from './SharedConnectionsRouteBody';
import '../settings.css';
import './RemoteControlWindow.css';

/** Settings-family chrome for the shared connections route. */
export function RemoteControlWindow(
	props: Omit<
		SharedConnectionsRouteBodyProps,
		| 'state'
		| 'embedded'
		| 'presentation'
		| 'servers'
		| 'onRenameServer'
		| 'onForgetServer'
		| 'onServersChanged'
	> &
		Readonly<{ exposurePanel?: ReactNode }>,
) {
	// The saved servers are the host's remembered profiles: the same list the
	// connection menu offers to attach.
	const { profiles, refreshProfiles, renameProfile, forgetProfile } =
		useConnections();
	useEffect(() => {
		refreshProfiles();
	}, [refreshProfiles]);
	return (
		<SharedConnectionsRouteBody
			presentation="management"
			state="ready"
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
