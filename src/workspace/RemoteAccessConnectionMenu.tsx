import { ChevronDown } from 'lucide-react';
import type { RefObject } from 'react';
import type { RemoteAccessStatus } from '../types/terminay';

type PairingMode = 'lan' | 'webrtc';
export type ConnectionSwitcherEntry = {
	id: string;
	isLocal: boolean;
	label: string;
	selected: boolean;
	status: string;
};

export function RemoteAccessConnectionMenu(props: {
	connectionSwitcherEntries?: readonly ConnectionSwitcherEntry[];
	currentServerId: string;
	currentServerLabel: string;
	errorMessage?: string | null;
	isOpen: boolean;
	isToggling: boolean;
	menuRef: RefObject<HTMLDivElement | null>;
	onOpenConnection: () => void;
	onDisconnect?: () => void;
	onOpenPairingQr: () => void;
	onSelectConnection?: (profileId: string) => void;
	onSelectAddress: (address: string) => void;
	onSelectMode: (mode: PairingMode) => void;
	onToggleExposure: () => void;
	onToggleMenu: () => void;
	preferredAddress: string | null;
	selectedMode: PairingMode;
	status: RemoteAccessStatus | null;
	statusMessage: string | null;
	tone: string;
	webRtcDisplayUrl: string | null;
}) {
	const { status } = props;
	const switcherEntries = props.connectionSwitcherEntries ?? [];
	const selectedModeUnavailable =
		props.selectedMode === 'webrtc' &&
		!status?.isRunning &&
		status?.webRtcStatus === 'error';
	return (
		<div
			ref={props.menuRef}
			className={`remote-access-status${status?.isRunning ? ' remote-access-status--active' : ''}${props.isOpen ? ' remote-access-status--open' : ''}`}
		>
			<button
				type="button"
				className={`remote-access-button ${props.tone}`.trim()}
				onClick={props.onToggleMenu}
				title="Open connection menu"
				aria-label="Open connection menu"
				aria-haspopup="menu"
				aria-expanded={props.isOpen}
			>
				<span className="remote-access-button__label">
					{props.currentServerLabel}
				</span>
				{status?.isRunning ? (
					<span
						className="remote-access-button__badge remote-access-button__badge--live"
						aria-hidden="true"
					/>
				) : null}
				{status?.configurationIssue || status?.errorMessage ? (
					<span
						className="remote-access-button__badge remote-access-button__badge--warning"
						aria-hidden="true"
					>
						!
					</span>
				) : null}
				<ChevronDown
					className="remote-access-button__chevron"
					size={12}
					aria-hidden="true"
				/>
			</button>
			{props.isOpen ? (
				<div
					className="remote-access-menu"
					role="menu"
					aria-label="Connection menu"
				>
					{switcherEntries.length ? (
						<div className="remote-access-menu__section">
							<div className="remote-access-menu__section-label">
								Connections
							</div>
							{switcherEntries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={`remote-access-menu__connection remote-access-menu__connection--button${entry.selected ? ' remote-access-menu__connection--selected' : ''}`}
									disabled={
										entry.selected || props.onSelectConnection === undefined
									}
									onClick={() => props.onSelectConnection?.(entry.id)}
									role="menuitemradio"
									aria-checked={entry.selected}
								>
									<span className="remote-access-menu__connection-main">
										<span className="remote-access-menu__connection-device">
											{entry.label}
										</span>
										<span className="remote-access-menu__connection-meta">
											{entry.selected ? 'Current' : entry.status}
										</span>
									</span>
									<span className="remote-access-menu__connection-id">
										{entry.isLocal ? 'Local' : entry.id}
									</span>
								</button>
							))}
						</div>
					) : (
						<div className="remote-access-menu__section">
							<div className="remote-access-menu__section-label">
								Current Server
							</div>
							<div className="remote-access-menu__connection">
								<div className="remote-access-menu__connection-main">
									<span className="remote-access-menu__connection-device">
										{props.currentServerLabel}
									</span>
									<span className="remote-access-menu__connection-meta">
										Connected
									</span>
								</div>
								<div className="remote-access-menu__connection-id">
									{props.currentServerId === 'desktop-local'
										? 'This Desktop host'
										: `Server ID: ${props.currentServerId}`}
								</div>
							</div>
						</div>
					)}
					{props.errorMessage ? (
						<div
							className="remote-access-menu__section remote-access-menu__section--error"
							role="alert"
						>
							<div className="remote-access-menu__section-label">
								Connection Error
							</div>
							<div className="remote-access-menu__error">
								{props.errorMessage}
							</div>
						</div>
					) : null}
					{props.onDisconnect ? (
						<div className="remote-access-menu__section">
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={props.onDisconnect}
							>
								<span>Disconnect</span>
								<span className="remote-access-menu__meta">Back</span>
							</button>
						</div>
					) : null}
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">
							{switcherEntries.length ? 'Remote Servers' : 'Connections'}
						</div>
						<button
							type="button"
							className="remote-access-menu__item"
							onClick={props.onOpenConnection}
						>
							<span>Manage connections…</span>
							<span className="remote-access-menu__meta">Open</span>
						</button>
					</div>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={props.onToggleExposure}
						disabled={props.isToggling || selectedModeUnavailable}
					>
						<span>
							{props.isToggling
								? 'Working...'
								: status?.isRunning
									? 'Stop exposing this server'
									: 'Expose this server…'}
						</span>
						<span className="remote-access-menu__meta">
							{status?.isRunning
								? 'Exposed'
								: selectedModeUnavailable
									? 'Unavailable'
									: 'Ready'}
						</span>
					</button>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={() =>
							void window.terminaySettingsWindowHost?.open('remote-access-host')
						}
					>
						<span>Remote Access Settings</span>
						<span className="remote-access-menu__meta">Open</span>
					</button>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={props.onOpenPairingQr}
						disabled={props.isToggling || selectedModeUnavailable}
					>
						<span>
							{status?.isRunning ? 'Show Pairing QR' : 'Expose & show QR'}
						</span>
						<span className="remote-access-menu__meta">
							{status?.isRunning
								? 'Scan'
								: selectedModeUnavailable
									? 'Unavailable'
									: 'Start'}
						</span>
					</button>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">QR Type</div>
						{(['lan', 'webrtc'] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								className={`remote-access-menu__address-btn${props.selectedMode === mode ? ' remote-access-menu__address-btn--active' : ''}`}
								onClick={() => props.onSelectMode(mode)}
							>
								<span className="remote-access-menu__address-text">
									{mode === 'lan' ? 'Local Network' : 'WebRTC Relay'}
								</span>
								{props.selectedMode === mode ? (
									<span
										className="remote-access-menu__address-check"
										aria-hidden="true"
									>
										✓
									</span>
								) : null}
							</button>
						))}
					</div>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">Expose At</div>
						{props.selectedMode === 'webrtc' ? (
							<div className="remote-access-menu__empty">
								{props.webRtcDisplayUrl ??
									'Start remote access to generate a relay pairing link.'}
							</div>
						) : status?.availableAddresses.length ? (
							status.availableAddresses.map((address) => (
								<button
									key={address}
									type="button"
									className={`remote-access-menu__address-btn${address === props.preferredAddress ? ' remote-access-menu__address-btn--active' : ''}`}
									onClick={() => props.onSelectAddress(address)}
								>
									<span className="remote-access-menu__address-text">
										{address}
									</span>
									{address === props.preferredAddress ? (
										<span
											className="remote-access-menu__address-check"
											aria-hidden="true"
										>
											✓
										</span>
									) : null}
								</button>
							))
						) : (
							<div className="remote-access-menu__empty">
								No local addresses available yet.
							</div>
						)}
					</div>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">
							Active Connections
						</div>
						{status?.connections.length ? (
							status.connections.map((connection) => (
								<div
									key={connection.connectionId}
									className="remote-access-menu__connection"
								>
									<div className="remote-access-menu__connection-main">
										<span className="remote-access-menu__connection-device">
											{connection.deviceName}
										</span>
										<span className="remote-access-menu__connection-meta">
											{connection.attachedSessionCount}{' '}
											{connection.attachedSessionCount === 1
												? 'session'
												: 'sessions'}
										</span>
									</div>
									<div className="remote-access-menu__connection-id">
										{connection.connectionId}
									</div>
								</div>
							))
						) : (
							<div className="remote-access-menu__empty">
								No active browser connections.
							</div>
						)}
					</div>
					{props.statusMessage ? (
						<div className="remote-access-menu__section">
							<div className="remote-access-menu__section-label">Status</div>
							<div className="remote-access-menu__empty">
								{props.statusMessage}
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
