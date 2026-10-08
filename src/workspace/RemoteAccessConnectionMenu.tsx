import { ChevronDown, Settings2 } from 'lucide-react';
import {
	groupLiveConnectionsByDevice,
	liveWindowsLabel,
} from '../shared/liveConnectionsByDevice';
import { type RefObject, useEffect, useState } from 'react';
import { friendlyPairingActionError } from '../shared/pairingActionError';
import { useConnections } from '../shared/connections/ConnectionsContext';
import type { RemoteAccessStatus } from '../types/terminay';
import { ConnectionsControl } from './ConnectionsControl';

export type ConnectionSwitcherEntry = {
	id: string;
	isLocal: boolean;
	label: string;
	selected: boolean;
	status: string;
};

export function RemoteAccessConnectionMenu(props: {
	connectionSwitcherEntries?: readonly ConnectionSwitcherEntry[];
	currentServerLabel: string;
	errorMessage?: string | null;
	isOpen: boolean;
	isToggling: boolean;
	menuRef: RefObject<HTMLDivElement | null>;
	onOpenConnection: () => void;
	onOpenPairingQr: () => void;
	onSelectConnection?: (profileId: string) => void;
	/** Go to a server the window already holds: the same act as activating one
	 * of its tabs. Absent hosts fall back to publishing the active server. */
	onSelectServer?: (serverId: string) => void;
	onSwitchConnections?: () => void;
	onToggleExposure: () => void;
	onToggleMenu: () => void;
	status: RemoteAccessStatus | null;
	tone: string;
}) {
	const { status } = props;
	const {
		connections,
		currentProfileId,
		openServerWindow,
		profiles,
		refreshProfiles,
		selectServer,
	} = useConnections();
	const [switchingProfileId, setSwitchingProfileId] = useState<string>();
	const [switchError, setSwitchError] = useState<string>();
	// A successful switch replaces this document, so only a failure, or opening
	// another window, ever comes back here.
	const act = (profileId: string, action: (id: string) => Promise<void>) => {
		setSwitchError(undefined);
		setSwitchingProfileId(profileId);
		void action(profileId)
			.catch((cause: unknown) =>
				setSwitchError(friendlyPairingActionError(cause)),
			)
			.finally(() => setSwitchingProfileId(undefined));
	};
	// Remembered connections change outside this window: pairing runs in the
	// Remote Control window. Ask the host again whenever the menu opens so a
	// server saved since the last look is listed.
	const { isOpen } = props;
	useEffect(() => {
		if (isOpen) refreshProfiles();
	}, [isOpen, refreshProfiles]);
	useEffect(() => {
		if (!isOpen) setSwitchError(undefined);
	}, [isOpen]);
	const switcherEntries = props.connectionSwitcherEntries ?? [];
	const isExposed = Boolean(status?.isRunning);
	const connectionCount = status?.connections.length ?? 0;
	const webRtcUnavailable =
		!status?.isRunning && status?.webRtcStatus === 'error';
	const connectionSummary =
		connectionCount > 0
			? `, ${connectionCount} active connection${connectionCount === 1 ? '' : 's'}`
			: '';
	const buttonState = `Open connection menu, ${isExposed ? 'Exposed' : 'Offline'}${connectionSummary}`;
	return (
		<div
			ref={props.menuRef}
			className={`remote-access-status${status?.isRunning ? ' remote-access-status--active' : ''}${props.isOpen ? ' remote-access-status--open' : ''}`}
		>
			<button
				type="button"
				className={`remote-access-button ${props.tone}`.trim()}
				onClick={props.onToggleMenu}
				title={buttonState}
				aria-label={buttonState}
				aria-haspopup="menu"
				aria-expanded={props.isOpen}
			>
				{/* Exposure state and the connection count live in the workspace
				    status bar; the header only names the server. */}
				<span className="remote-access-button__label">
					{props.currentServerLabel}
				</span>
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
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-header">
							<div className="remote-access-menu__section-label">
								Connections
							</div>
							<button
								type="button"
								className="remote-access-menu__manage"
								onClick={props.onOpenConnection}
								aria-label="Manage connections"
								title="Remote Control"
							>
								<Settings2 size={14} aria-hidden="true" />
							</button>
						</div>
						{connections.length > 0 ? (
							// A window shows one server: this lists the servers it could
							// show and switches between them.
							<ConnectionsControl
								{...(connections[0] === undefined
									? {}
									: { connection: connections[0] })}
								{...(currentProfileId === undefined ? {} : { currentProfileId })}
								currentServerLabel={props.currentServerLabel}
								{...(selectServer === undefined
									? {}
									: {
											onSwitch: (profileId: string) =>
												act(profileId, selectServer),
										})}
								{...(openServerWindow === undefined
									? {}
									: {
											onOpenWindow: (profileId: string) =>
												act(profileId, openServerWindow),
										})}
								servers={profiles}
								{...(switchError === undefined ? {} : { switchError })}
								{...(switchingProfileId === undefined
									? {}
									: { switchingProfileId })}
							/>
						) : switcherEntries.length ? (
							switcherEntries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={`remote-access-menu__connection remote-access-menu__connection--button remote-access-menu__connection--compact${entry.selected ? ' remote-access-menu__connection--selected' : ''}`}
									disabled={
										entry.selected || props.onSelectConnection === undefined
									}
									onClick={() => props.onSelectConnection?.(entry.id)}
									role="menuitemradio"
									aria-checked={entry.selected}
								>
									<span className="remote-access-menu__connection-device">
										{entry.label}
									</span>
								</button>
							))
						) : (
							<div className="remote-access-menu__connection remote-access-menu__connection--compact">
								<span className="remote-access-menu__connection-device">
									{props.currentServerLabel}
								</span>
							</div>
						)}
						{props.onSwitchConnections ? (
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={props.onSwitchConnections}
							>
								<span>Switch connections</span>
							</button>
						) : null}
					</div>
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
					<div className="remote-access-menu__section">
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
							<span
								className={`remote-access-menu__meta${status?.isRunning ? ' remote-access-menu__meta--live' : ''}`}
							>
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
							onClick={props.onOpenPairingQr}
							disabled={
								props.isToggling || webRtcUnavailable || !status?.isRunning
							}
						>
							<span>Create pairing link</span>
						</button>
						{status?.webRtcStatusMessage || webRtcUnavailable ? (
							<p className="remote-access-menu__diagnostic">
								{status?.webRtcStatusMessage ??
									'The required WebRTC runtime or authenticated signaling registrar is missing.'}
							</p>
						) : null}
					</div>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">
							Active Connections
						</div>
						{status?.connections.length ? (
							groupLiveConnectionsByDevice(status.connections).map((connection) => (
								<div
									key={connection.deviceId}
									className="remote-access-menu__connection remote-access-menu__connection--compact"
								>
									<span className="remote-access-menu__connection-device">
										{connection.deviceName}
										{connection.windowCount > 1
											? ` · ${liveWindowsLabel(connection.windowCount)}`
											: ''}
									</span>
								</div>
							))
						) : (
							<div className="remote-access-menu__empty">
								No active browser connections.
							</div>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}
