import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
	type SavedServerSummary,
	SharedConnectionsRouteBody,
} from '../../src/shared/SharedConnectionsRouteBody';
import '../../src/settings.css';
import '../../src/shared/RemoteControlWindow.css';

/**
 * Remote Control as Desktop presents it: the saved servers are the host's
 * remembered profiles, and rename and forget are host actions. The host is
 * played here by local state, so the page can be driven without Electron.
 */
const query = new URLSearchParams(window.location.search);
const version = query.get('version') ?? undefined;
const initialServers: readonly SavedServerSummary[] =
	query.get('servers') === 'none'
		? [{ id: 'local', label: 'Local', isLocal: true }]
		: [
				{ id: 'local', label: 'Local', isLocal: true },
				{ id: 'remote:studio', label: 'studio.example' },
				{ id: 'remote:old', label: 'Old build box' },
			];

const hostActions: string[] = [];
Object.assign(window, { __remoteControlHostActions: hostActions });

function Fixture() {
	const [servers, setServers] = useState(initialServers);
	return (
		<SharedConnectionsRouteBody
			presentation="management"
			state="ready"
			canPair
			servers={servers}
			{...(version === undefined ? {} : { appVersion: version })}
			exposurePanel={<p>Exposure panel</p>}
			onRenameServer={async (id, label) => {
				hostActions.push(`rename:${id}:${label}`);
				setServers((current) =>
					current.map((server) =>
						server.id === id ? { ...server, label } : server,
					),
				);
			}}
			onForgetServer={async (id) => {
				hostActions.push(`forget:${id}`);
				setServers((current) => current.filter((server) => server.id !== id));
			}}
			onServersChanged={() => hostActions.push('refresh')}
			onPairingHandoff={async ({ pairingUrl }) => {
				hostActions.push(`pair:${pairingUrl}`);
				setServers((current) => [
					...current,
					{ id: 'remote:new', label: new URL(pairingUrl).host },
				]);
			}}
		/>
	);
}

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<Fixture />);
