import { serverTileColor, serverTileInitial } from './settingsPlaces';

export type SettingsRailServer = Readonly<{
	/** The tile's id: the connection's profile id. */
	id: string;
	name: string;
	/** What the tile's colour is derived from: the server id, else the profile. */
	identity: string;
	online: boolean;
}>;

function DeviceGlyph() {
	return (
		<svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="3" y="4" width="18" height="12" rx="2" />
			<path d="M8 20h8" />
			<path d="M12 16v4" />
		</svg>
	);
}

function PlusGlyph() {
	return (
		<svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
			<path d="M12 5v14" />
			<path d="M5 12h14" />
		</svg>
	);
}

/**
 * The places rail of Settings: this device, then every attached server, then
 * Connect a server. Choosing a tile chooses where the settings shown are saved.
 */
export function SettingsPlacesRail({
	deviceName,
	servers,
	selectedId,
	deviceId,
	onSelect,
	onConnectServer,
}: Readonly<{
	deviceName: string;
	servers: readonly SettingsRailServer[];
	selectedId: string;
	deviceId: string;
	onSelect: (id: string) => void;
	onConnectServer: () => void;
}>) {
	const tile = (id: string) => `settings-rail-tile${id === selectedId ? ' settings-rail-tile--selected' : ''}`;
	return (
		<nav className="settings-rail" aria-label="Where settings are saved">
			<button
				type="button"
				className={`${tile(deviceId)} settings-rail-tile--device`}
				aria-pressed={deviceId === selectedId}
				aria-label={deviceName}
				title={deviceName}
				data-settings-place="device"
				onClick={() => onSelect(deviceId)}
			>
				<DeviceGlyph />
			</button>
			{servers.length === 0 ? null : <span className="settings-rail-divider" aria-hidden="true" />}
			{servers.map((server) => (
				<button
					key={server.id}
					type="button"
					className={tile(server.id)}
					style={{ background: serverTileColor(server.identity) }}
					aria-pressed={server.id === selectedId}
					aria-label={`${server.name}, ${server.online ? 'online' : 'offline'}`}
					title={server.name}
					data-settings-place="server"
					data-settings-place-name={server.name}
					onClick={() => onSelect(server.id)}
				>
					<span className="settings-rail-initial" aria-hidden="true">
						{serverTileInitial(server.name)}
					</span>
					<span
						className={`settings-rail-status settings-rail-status--${server.online ? 'online' : 'offline'}`}
						aria-hidden="true"
					/>
				</button>
			))}
			<button
				type="button"
				className="settings-rail-tile settings-rail-tile--connect"
				aria-label="Connect a server"
				title="Connect a server"
				onClick={onConnectServer}
			>
				<PlusGlyph />
			</button>
		</nav>
	);
}
