/**
 * The Updates page of one server in Settings: its release track, the exact
 * version it runs, the newest on its track, and the existing confirmation
 * before it is asked to upgrade (ADR-0062). It reads the status the server
 * publishes and changes nothing but, when confirmed, asks for an upgrade.
 */

import type { ServerUpgradeStatus } from '@terminay/client-core';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { checkForAppUpdate } from '../host/nativeActions';
import { ServerUpdatesPage } from '../components/settings/UpdatesPages';
import { serverUpdatesModel } from '../components/settings/updatesPageModel';
import type { WorkspaceConnection } from '../shared/connections/connectionRegistry';
import { ServerUpgradeDialog } from './ServerUpgradeDialog';
import { requestServerUpgrade } from './serverUpgradeModel.ts';

type StatusStore = Readonly<{
	status: ServerUpgradeStatus | undefined;
	subscribe: (listener: (status: ServerUpgradeStatus | undefined) => void) => () => void;
}>;

const NO_STORE: StatusStore = Object.freeze({
	status: undefined,
	subscribe: () => () => {},
});

function useUpgradeStatus(store: StatusStore | undefined): ServerUpgradeStatus | undefined {
	const source = store ?? NO_STORE;
	return useSyncExternalStore(
		useCallback((listener: () => void) => source.subscribe(() => listener()), [source]),
		() => source.status,
		() => source.status,
	);
}

/** Terminay Desktop's version, which the Local server built into it runs. */
function useDesktopVersion(enabled: boolean): string | undefined {
	const [version, setVersion] = useState<string>();
	useEffect(() => {
		if (!enabled) return;
		let current = true;
		void checkForAppUpdate()
			.then((status) => {
				if (current && status !== null) setVersion(status.currentVersion);
			})
			.catch(() => undefined);
		return () => {
			current = false;
		};
	}, [enabled]);
	return version;
}

export function SettingsServerUpdates({
	connection,
	isLocal,
	onOpenDeviceUpdates,
}: Readonly<{
	connection: WorkspaceConnection;
	/** Named from the host's own connection profile, never from the status. */
	isLocal: boolean;
	onOpenDeviceUpdates: () => void;
}>) {
	const client = connection.context?.serverUpgradeClient;
	const status = useUpgradeStatus(client?.store);
	const [confirming, setConfirming] = useState(false);
	const helloVersion = connection.hello?.serverVersion;
	const desktopVersion = useDesktopVersion(isLocal);
	const model = serverUpdatesModel({
		isLocal,
		...(status === undefined ? {} : { status }),
		...(helloVersion === undefined ? {} : { helloVersion }),
		...(desktopVersion === undefined ? {} : { desktopVersion }),
	});
	return (
		<>
			<ServerUpdatesPage
				model={model}
				serverName={connection.label}
				onUpgrade={() => setConfirming(true)}
				{...(isLocal ? { onOpenDeviceUpdates } : {})}
			/>
			{confirming && status?.available !== undefined ? (
				<ServerUpgradeDialog
					confirmation={{
						entry: {
							profileId: connection.profileId,
							label: connection.label,
							status,
							reachable: connection.phase === 'ready',
						},
						start: (mode) => requestServerUpgrade(client, mode),
						close: () => setConfirming(false),
					}}
				/>
			) : null}
		</>
	);
}
