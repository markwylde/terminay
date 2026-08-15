import { ChevronDown } from 'lucide-react';
import type { RefObject } from 'react';
import type { RemoteAccessStatus } from '../types/terminay';

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
	onOpenSettings: () => void;
	onSelectConnection?: (profileId: string) => void;
	onToggleExposure: () => void;
	onToggleMenu: () => void;
	status: RemoteAccessStatus | null;
	statusMessage: string | null;
	tone: string;
}) {
	const { status } = props;
	const switcherEntries = props.connectionSwitcherEntries ?? [];
	const webRtcUnavailable =
		!status?.isRunning && status?.webRtcStatus === 'error';
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
							<span>Remote Control</span>
							<span className="remote-access-menu__meta">Open</span>
						</button>
					</div>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={props.onToggleExposure}
						disabled={props.isToggling || webRtcUnavailable}
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
								: webRtcUnavailable
									? 'Unavailable in this build'
									: 'Ready'}
						</span>
					</button>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={props.onOpenSettings}
					>
						<span>Remote Access Settings</span>
						<span className="remote-access-menu__meta">Open</span>
					</button>
					<button
						type="button"
						className="remote-access-menu__item"
						onClick={props.onOpenPairingQr}
						disabled={
							props.isToggling || webRtcUnavailable || !status?.isRunning
						}
					>
						<span>Show pairing link and QR</span>
						<span className="remote-access-menu__meta">
							{status?.isRunning
								? 'Scan'
								: webRtcUnavailable
									? 'Unavailable in this build'
									: 'Expose first'}
						</span>
					</button>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">
							WebRTC exposure
						</div>
						<div className="remote-access-menu__empty">
							{status?.webRtcStatusMessage ??
								(webRtcUnavailable
									? 'The required WebRTC runtime or authenticated signaling registrar is missing.'
									: "Ready to expose without changing this window's private Local connection.")}
						</div>
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
