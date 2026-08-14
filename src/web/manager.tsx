import {
	consumeLegacyManagerMigration,
	WEB_MANAGER_ORIGIN,
	WebConnectionHost,
} from '@terminay/web';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SharedConnectionsRouteBody } from '../shared/SharedConnectionsRouteBody';
import '../shared/SharedProductionRoutes.css';
import './index.css';

function createHost(): WebConnectionHost {
	const host = new WebConnectionHost({
		managerOrigin: WEB_MANAGER_ORIGIN,
		openWindow: (url, target) => {
			if (target === '_blank') window.open(url, target, 'noopener,noreferrer');
			else window.location.assign(url);
		},
	});
	const migration = consumeLegacyManagerMigration({ window, host });
	if (migration.status === 'recovery') {
		(
			window as Window & { __terminayLegacyMigrationError?: string }
		).__terminayLegacyMigrationError = migration.message;
	}
	return host;
}

function Manager(): React.JSX.Element {
	const [host, setHost] = useState(createHost);

	useEffect(() => {
		const rebuildFromStorage = () => setHost(createHost());
		window.addEventListener('storage', rebuildFromStorage);
		return () => window.removeEventListener('storage', rebuildFromStorage);
	}, []);

	return (
		<div className="browser-host-shell">
			<SharedConnectionsRouteBody
				state="ready"
				profileStore={host.profiles}
				canPair
				onSelect={(profile) => {
					host.open(profile.id);
				}}
				onPairingHandoff={(pairingUrl) => window.location.assign(pairingUrl)}
				onRemember={(profile) => {
					host.addConnection(profile);
				}}
				onRename={(profile, label) => {
					host.rename(profile.id, label);
				}}
				onForget={(profile) => {
					host.forget(profile.id, true);
				}}
			/>
		</div>
	);
}

const root = document.getElementById('web-root');
if (root === null)
	throw new Error('Terminay browser manager root is missing.');
createRoot(root).render(<Manager />);
