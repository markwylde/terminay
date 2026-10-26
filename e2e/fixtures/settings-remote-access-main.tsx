import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
	REMOTE_ACCESS_EXPOSURE_ID,
	type SavedServerSummary,
	SharedConnectionsRouteBody,
} from '../../src/shared/SharedConnectionsRouteBody';
import { SharedSettingsRouteBody } from '../../src/shared/SharedSettingsRouteBody';
import '../../src/settings.css';

/**
 * Settings › Remote Access as Desktop presents it: the saved servers are the
 * host's remembered profiles, and rename and forget are host actions. The host
 * is played here by local state, so the page can be driven without Electron.
 * A two-server selector stands in for the Settings server selector: it renames
 * This server and never changes the saved servers.
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

const selectableServers = ['Local', 'studio.example'] as const;

function Fixture() {
	const [servers, setServers] = useState(initialServers);
	const [selectedId, setSelectedId] = useState<string>(
		REMOTE_ACCESS_EXPOSURE_ID,
	);
	const [selectedServer, setSelectedServer] =
		useState<(typeof selectableServers)[number]>('Local');
	return (
		<SharedConnectionsRouteBody
			presentation="settings"
			state="ready"
			canPair
			servers={servers}
			{...(version === undefined ? {} : { appVersion: version })}
			exposurePanel={<p>Exposure panel for {selectedServer}</p>}
			settings={{
				exposureLabel: selectedServer,
				exposureStatus: 'Not exposed',
				exposureActive: false,
				exposureDetail: (
					<section className="settings-section" aria-label="Remote exposure">
						<h3 className="settings-section-title">Remote exposure</h3>
						<p>Expose on startup</p>
					</section>
				),
				selectedId,
				onSelect: setSelectedId,
				render: ({ list, detail, detailTitle }) => (
					<SharedSettingsRouteBody
						query=""
						categories={[{ id: 'remote', label: 'Remote Access' }]}
						activeCategoryId="remote"
						status="Saved"
						onQueryChange={() => undefined}
						onCategorySelect={() => undefined}
						sidebarAction={
							<label>
								Server
								<select
									aria-label="Server"
									value={selectedServer}
									onChange={(event) =>
										setSelectedServer(
											event.target.value as (typeof selectableServers)[number],
										)
									}
								>
									{selectableServers.map((name) => (
										<option key={name} value={name}>
											{name}
										</option>
									))}
								</select>
							</label>
						}
						listColumn={list}
						listTitle="Remote Access"
						detailTitle={detailTitle}
					>
						{detail}
					</SharedSettingsRouteBody>
				),
			}}
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
