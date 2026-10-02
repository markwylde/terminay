import type {
	PairingAttemptApproval,
	PairingAttemptProgress,
} from './pairingAttemptState';

export const PAIRING_CONNECTION_LOST_COPY =
	'The connection was lost. Your server is saved; retry it from the connections list.';

/** Where a Desktop pairing attempt is, in the order it actually happens. */
export function PairingAttemptStatus({
	approval,
	busy,
	progress,
}: Readonly<{
	approval: PairingAttemptApproval | null;
	busy: boolean;
	progress: PairingAttemptProgress | null;
}>) {
	return (
		<>
			{approval ? (
				<div
					className="shared-connections__match-code"
					role="status"
					aria-live="polite"
				>
					<p>
						Confirm this code on the exposing computer to finish pairing{' '}
						<strong>{approval.deviceName}</strong>.
					</p>
					<p className="shared-connections__match-code-value">
						{approval.matchCode}
					</p>
				</div>
			) : null}
			{busy && !approval && progress === null ? (
				<p role="status">Contacting the server…</p>
			) : null}
			{progress === 'connecting' && !approval ? (
				<p role="status">Approved. Connecting to the server…</p>
			) : null}
			{progress === 'connection-degraded' ? (
				<p role="status">
					The WebRTC network path is disconnected; Terminay is trying to
					recover. If it persists, check the server's UDP reachability.
				</p>
			) : null}
			{progress === 'connection-lost' ? (
				<p role="alert">{PAIRING_CONNECTION_LOST_COPY}</p>
			) : null}
		</>
	);
}
