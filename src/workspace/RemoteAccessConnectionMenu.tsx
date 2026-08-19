import { ChevronDown, Settings2 } from 'lucide-react';
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
	currentServerLabel: string;
	errorMessage?: string | null;
	isOpen: boolean;
	isToggling: boolean;
	menuRef: RefObject<HTMLDivElement | null>;
	onOpenConnection: () => void;
	onOpenPairingQr: () => void;
	onSelectConnection?: (profileId: string) => void;
	onToggleExposure: () => void;
	onToggleMenu: () => void;
	status: RemoteAccessStatus | null;
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
						{switcherEntries.length ? (
							switcherEntries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									className={`remote-access-menu__connection remote-access-menu__connection--button remote-access-menu__connection--compact${entry.selected ? ' remote-access-menu__connection--selected' : ''}`}
									disabled={
										entry.selected ||
										props.onSelectConnection === undefined
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
										? 'Unavailable'
										: 'Ready'}
							</span>
						</button>
						<button
							type="button"
							className="remote-access-menu__item"
							onClick={props.onOpenPairingQr}
							disabled={
								props.isToggling ||
								webRtcUnavailable ||
								!status?.isRunning
							}
						>
							<span>Create pairing link</span>
						</button>
					</div>
					<div className="remote-access-menu__section">
						<div className="remote-access-menu__section-label">
							Active Connections
						</div>
						{status?.connections.length ? (
							status.connections.map((connection) => (
								<div
									key={connection.connectionId}
									className="remote-access-menu__connection remote-access-menu__connection--compact"
								>
									<span className="remote-access-menu__connection-device">
										{connection.deviceName}
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
