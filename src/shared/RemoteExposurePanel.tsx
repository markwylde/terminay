import { useState } from 'react';
import type { RemotePairingPinClient } from '../remotePairingPin';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import { useRemoteAccessController } from '../workspace/useRemoteAccessController';
import { RemotePairingModal } from './RemotePairingModal';

export function RemoteExposurePanel({
	openSettings,
	pairingPinClient,
	statusClient,
}: Readonly<{
	openSettings: (sectionId: string) => Promise<void>;
	pairingPinClient?: RemotePairingPinClient;
	statusClient?: RemoteAccessStatusClient;
}>) {
	const remote = useRemoteAccessController(
		pairingPinClient,
		statusClient,
		openSettings,
	);
	const [busyDeviceId, setBusyDeviceId] = useState<string>();
	const [busyConnectionId, setBusyConnectionId] = useState<string>();
	const status = remote.status;
	const pairedDevices = status?.pairedDevices ?? [];
	const activeConnections = status?.connections ?? [];
	const webRtcUnavailable =
		!status?.isRunning && status?.webRtcStatus === 'error';
	const summary = status?.isRunning
		? 'This server is ready for remote connections.'
		: webRtcUnavailable
			? 'Remote access could not start.'
			: 'Remote access is ready.';
	const description = status?.isRunning
		? 'Create a pairing link for a new browser or Desktop, then manage trusted devices here.'
		: webRtcUnavailable
			? (status?.errorMessage ??
				'WebRTC exposure is unavailable. Check Remote Access settings.')
			: 'Expose this server to create a secure WebRTC pairing link.';

	const revokeDevice = async (deviceId: string) => {
		setBusyDeviceId(deviceId);
		try {
			await remote.revokeDevice(deviceId);
		} finally {
			setBusyDeviceId(undefined);
		}
	};

	const closeConnection = async (connectionId: string) => {
		setBusyConnectionId(connectionId);
		try {
			await remote.closeConnection(connectionId);
		} finally {
			setBusyConnectionId(undefined);
		}
	};

	return (
		<section
			className="settings-section"
			aria-label="Server exposure"
		>
			<header className="settings-remote-panel-header">
				<div>
					<p className="settings-remote-kicker">
						Exposure · {status?.isRunning ? 'Active' : 'Stopped'}
					</p>
					<h4>{summary}</h4>
					<p>{description}</p>
				</div>
				<button
					type="button"
					className="settings-primary-button"
					onClick={() => void remote.toggleExposure()}
					disabled={remote.isToggling || webRtcUnavailable}
				>
					{remote.isToggling
						? 'Working…'
						: status?.isRunning
							? 'Stop exposure'
							: 'Expose this server…'}
				</button>
			</header>
			{remote.statusMessage ? (
				<p className="settings-section-desc" role="status">
					{remote.statusMessage}
				</p>
			) : null}
			<div className="settings-remote-stack">
				<section className="settings-remote-card settings-remote-card--exposure">
					<div>
						<span className="settings-remote-card-label">
							WebRTC exposure
						</span>
						<p className="settings-remote-card-subtitle">
							Terminay uses an authenticated WebRTC connection. The
							pairing link enrolls one device; later visits use that
							device’s identity.
						</p>
					</div>
					<div className="settings-remote-exposure-actions">
						<div className="settings-remote-stat">
							<span>Trusted browsers</span>
							<strong>{pairedDevices.length}</strong>
						</div>
						<div className="settings-remote-stat">
							<span>Live connections</span>
							<strong>{activeConnections.length}</strong>
						</div>
						{status?.isRunning ? (
							<button
								type="button"
								className="settings-secondary-button"
								onClick={() => void remote.openPairingQr()}
								disabled={remote.isToggling || webRtcUnavailable}
							>
								Create pairing link
							</button>
						) : null}
					</div>
				</section>
				<section className="settings-remote-card settings-remote-card--list">
					<header className="settings-remote-card-header">
						<div>
							<span className="settings-remote-card-label">
								Trusted browsers
							</span>
							<p className="settings-remote-card-subtitle">
								Authorized devices that can open remote sessions.
							</p>
						</div>
					</header>
					<div className="settings-remote-list">
						{pairedDevices.length === 0 ? (
							<p className="settings-remote-empty">
								No trusted browsers yet.
							</p>
						) : (
							pairedDevices.map((device) => (
								<div
									key={device.deviceId}
									className="settings-remote-device"
								>
									<div className="settings-remote-device-main">
										<div className="settings-remote-device-title-row">
											<strong>{device.name}</strong>
										</div>
										<p className="settings-remote-device-details">
											Last seen {formatSeen(device.lastSeenAt)}
										</p>
									</div>
									<button
										type="button"
										className="settings-danger-button"
										disabled={busyDeviceId === device.deviceId}
										onClick={() => void revokeDevice(device.deviceId)}
									>
										Revoke
									</button>
								</div>
							))
						)}
					</div>
				</section>
				<section className="settings-remote-card settings-remote-card--list">
					<header className="settings-remote-card-header">
						<div>
							<span className="settings-remote-card-label">
								Active connections
							</span>
							<p className="settings-remote-card-subtitle">
								Live sessions currently streaming to remote clients.
							</p>
						</div>
					</header>
					<div className="settings-remote-list">
						{activeConnections.length === 0 ? (
							<p className="settings-remote-empty">
								No active browser connections.
							</p>
						) : (
							activeConnections.map((connection) => (
								<div
									key={connection.connectionId}
									className="settings-remote-item"
								>
									<strong>{connection.deviceName}</strong>
									<button
										type="button"
										className="settings-secondary-button"
										disabled={
											busyConnectionId === connection.connectionId
										}
										onClick={() =>
											void closeConnection(connection.connectionId)
										}
									>
										Close
									</button>
								</div>
							))
						)}
					</div>
				</section>
			</div>
			{remote.isPairingModalOpen ? (
				<RemotePairingModal
					expiresAt={remote.pairingExpiresAt}
					onClose={remote.closePairingModal}
					pairingUrl={remote.pairingUrl}
					qrCodeDataUrl={remote.visibleQrCodeDataUrl}
					sessionOrigin={remote.pairingSessionOrigin}
					statusMessage={remote.status?.webRtcStatusMessage}
					success={remote.pairingOutcome === 'success'}
				/>
			) : null}
			{remote.isPinModalOpen ? (
				<div
					className="settings-modal-backdrop"
					onMouseDown={() => remote.closePinModal(false)}
				>
					<form
						className="settings-pin-modal"
						onSubmit={remote.submitPin}
						onMouseDown={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="remote-exposure-pin-title"
					>
						<div className="settings-pin-modal-header">
							<h2 id="remote-exposure-pin-title">Remote Pairing PIN</h2>
							<button
								type="button"
								onClick={() => remote.closePinModal(false)}
								aria-label="Close Remote Pairing PIN"
							>
								x
							</button>
						</div>
						<p>
							Choose a 6-digit PIN. Your browser will use this after
							scanning a pairing link.
						</p>
						<label className="settings-pin-modal-field">
							<span>Pairing PIN</span>
							<input
								className="settings-input-text"
								type="password"
								value={remote.pinInput}
								onChange={(event) => {
									remote.setPinInput(
										event.target.value.replace(/\D/g, '').slice(0, 6),
									);
									remote.setPinError(null);
								}}
								inputMode="numeric"
								pattern="[0-9]{6}"
								autoComplete="off"
								spellCheck={false}
								autoFocus
							/>
						</label>
						{remote.pinError ? (
							<p className="settings-pin-modal-error">{remote.pinError}</p>
						) : null}
						<button
							type="submit"
							className="settings-primary-button"
							disabled={remote.isSavingPin || remote.pinInput.length !== 6}
						>
							{remote.isSavingPin ? 'Saving…' : 'Save PIN'}
						</button>
					</form>
				</div>
			) : null}
		</section>
	);
}

function formatSeen(value: string | null): string {
	if (value === null) return 'never';
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return 'unknown';
	return parsed.toLocaleString();
}
