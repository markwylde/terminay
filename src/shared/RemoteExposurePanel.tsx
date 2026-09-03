import { useState } from 'react';
import type { RemoteAccessStatusClient } from '../services/remoteAccessStatusClient';
import { useRemoteAccessController } from '../workspace/useRemoteAccessController';
import { RemotePairingModal } from './RemotePairingModal';

export function RemoteExposurePanel({
	openSettings,
	statusClient,
}: Readonly<{
	openSettings: (sectionId: string) => Promise<void>;
	statusClient?: RemoteAccessStatusClient;
}>) {
	const remote = useRemoteAccessController(statusClient, openSettings);
	const [confirmReset, setConfirmReset] = useState(false);
	const [busyDeviceId, setBusyDeviceId] = useState<string>();
	const [busyConnectionId, setBusyConnectionId] = useState<string>();
	const status = remote.status;
	const pairedDevices = status?.pairedDevices ?? [];
	const activeConnections = status?.connections ?? [];
	const pendingApprovals = remote.pendingApprovals;
	const webRtcUnavailable =
		!status?.isRunning && status?.webRtcStatus === 'error';
	const summary = status?.isRunning
		? 'This server is ready for remote connections.'
		: webRtcUnavailable
			? 'Remote access could not start.'
			: 'Remote access is ready.';
	const description = status?.isRunning
		? 'Create a pairing link for a new browser or Desktop, approve its match code here, then manage trusted devices.'
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
		<section className="settings-section" aria-label="Server exposure">
			<header className="settings-remote-panel-header">
				<div>
					<p className="settings-remote-kicker">
						Exposure · {status?.isRunning ? 'Active' : 'Stopped'}
					</p>
					<h4>{summary}</h4>
					<p>{description}</p>
				</div>
				<div className="settings-remote-panel-header-actions">
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
				</div>
			</header>
			{remote.statusMessage ? (
				<p className="settings-section-desc" role="status">
					{remote.statusMessage}
				</p>
			) : null}
			<div className="settings-remote-stack">
				<section className="settings-remote-card settings-remote-card--exposure">
					<div>
						<span className="settings-remote-card-label">WebRTC exposure</span>
						<p className="settings-remote-card-subtitle">
							Terminay uses an authenticated WebRTC connection. The pairing link
							enrolls one device; later visits use that device’s identity.
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
				{pendingApprovals.length > 0 ? (
					<section
						className="settings-remote-card settings-remote-card--list"
						aria-label="Devices waiting for approval"
					>
						<header className="settings-remote-card-header">
							<div>
								<span className="settings-remote-card-label">
									Waiting for approval
								</span>
								<p className="settings-remote-card-subtitle">
									Approve only when the code on the device matches the code
									shown here.
								</p>
							</div>
						</header>
						<div className="settings-remote-list">
							{pendingApprovals.map((approval) => (
								<div
									key={approval.approvalId}
									className="settings-remote-device settings-remote-approval"
								>
									<div className="settings-remote-device-main">
										<div className="settings-remote-device-title-row">
											<strong>{approval.deviceName}</strong>
										</div>
										<p className="settings-remote-device-details">
											Match code{' '}
											<code className="settings-remote-match-code">
												{approval.matchCode}
											</code>
											{' · '}expires {formatSeen(approval.expiresAt)}
										</p>
									</div>
									<div className="settings-remote-approval-actions">
										<button
											type="button"
											className="settings-primary-button"
											disabled={remote.busyApprovalId === approval.approvalId}
											onClick={() => void remote.approveDevice(approval.approvalId)}
										>
											Approve
										</button>
										<button
											type="button"
											className="settings-danger-button"
											disabled={remote.busyApprovalId === approval.approvalId}
											onClick={() => void remote.denyDevice(approval.approvalId)}
										>
											Deny
										</button>
									</div>
								</div>
							))}
						</div>
					</section>
				) : null}
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
							<p className="settings-remote-empty">No trusted browsers yet.</p>
						) : (
							pairedDevices.map((device) => (
								<div key={device.deviceId} className="settings-remote-device">
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
										disabled={busyConnectionId === connection.connectionId}
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
				<section
					className="settings-remote-card settings-remote-card--list"
					aria-label="Server identity"
				>
					<header className="settings-remote-card-header">
						<div>
							<span className="settings-remote-card-label">Server identity</span>
							<p className="settings-remote-card-subtitle">
								Resetting creates a new server key, revokes every paired
								device, and requires each one to pair again.
							</p>
						</div>
					</header>
					<div className="settings-remote-exposure-actions">
						{confirmReset ? (
							<>
								<p className="settings-remote-device-details" role="status">
									{pairedDevices.length}{' '}
									{pairedDevices.length === 1 ? 'device' : 'devices'} will lose
									trust and must pair again.
								</p>
								<button
									type="button"
									className="settings-danger-button"
									disabled={remote.isResettingIdentity}
									onClick={() => {
										setConfirmReset(false);
										void remote.resetIdentity();
									}}
								>
									{remote.isResettingIdentity ? 'Resetting…' : 'Confirm reset'}
								</button>
								<button
									type="button"
									className="settings-secondary-button"
									onClick={() => setConfirmReset(false)}
								>
									Cancel
								</button>
							</>
						) : (
							<button
								type="button"
								className="settings-secondary-button"
								disabled={remote.isResettingIdentity}
								onClick={() => setConfirmReset(true)}
							>
								Reset server identity…
							</button>
						)}
					</div>
				</section>
			</div>
			{remote.isPairingModalOpen ? (
				<RemotePairingModal
					busy={remote.busyApprovalId !== null}
					expiresAt={remote.pairingExpiresAt}
					onApprove={(approvalId) => void remote.approveDevice(approvalId)}
					onClose={remote.closePairingModal}
					onDeny={(approvalId) => void remote.denyDevice(approvalId)}
					pairingUrl={remote.pairingUrl}
					pendingApproval={remote.pendingApproval}
					qrCodeDataUrl={remote.visibleQrCodeDataUrl}
					statusMessage={remote.status?.webRtcStatusMessage}
					success={remote.pairingOutcome === 'success'}
				/>
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
