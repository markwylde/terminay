/** IPC between Desktop main and its packaged workspace preload. */
export const RECOVER_REMOTE_ENDPOINT = 'server-ui-host:recover-remote-endpoint';
export const REMOTE_ENDPOINT_RECEIVED =
	'server-ui-host:remote-endpoint-received';
export const REMOTE_RESUME = 'server-ui-host:remote-resume';

// Includes hosted signaling, ICE and ticket authentication. Workspace hello
// starts its own deadline after the authenticated endpoint has arrived.
export const DESKTOP_REMOTE_SETUP_TIMEOUT_MS = 90_000;
export const DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS = 5_000;

export type DesktopRemoteRecoveryFailure =
	| 'timeout'
	| 'unavailable'
	| 'endpoint-unavailable'
	| 'pairing-required'
	| 'window-limit'
	| 'retired';

export type DesktopRemoteRecoveryResult =
	| Readonly<{ outcome: 'ready'; generation: number }>
	| Readonly<{ outcome: DesktopRemoteRecoveryFailure }>;

export const DESKTOP_PAIRING_REQUIRED = 'This device must be paired again.';

export class DesktopRemotePairingRequiredError extends Error {
	readonly code = 'pairing-required';
}
