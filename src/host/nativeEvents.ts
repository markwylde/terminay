import type { TerminayHostEvent } from '@terminay/protocol';

type NativeEventBridge = Readonly<{
	subscribeEvent(
		listener: (event: TerminayHostEvent) => Promise<void> | void,
	): () => void;
}>;

export function subscribeTerminalZoom(
	listener: (zoomLevel: number) => void,
): () => void {
	const host = window.terminayHost as unknown as NativeEventBridge | undefined;
	if (host === undefined) return () => undefined;
	return host.subscribeEvent((message) => {
		if (message.event.type === 'terminal.zoom') {
			listener(message.event.zoomLevel);
		}
	});
}

export function subscribeWorkspaceDragState(
	listener: (active: boolean) => void,
): () => void {
	const host = window.terminayHost as unknown as NativeEventBridge | undefined;
	if (host === undefined) return () => undefined;
	return host.subscribeEvent((message) => {
		if (message.event.type === 'workspace.drag-state') {
			listener(message.event.active);
		}
	});
}

export function subscribeDeviceTerminalSettings(
	listener: (settings: import('@terminay/protocol').JsonValue) => void,
): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const host = window.terminayHost as unknown as NativeEventBridge | undefined;
	if (host === undefined) return () => undefined;
	return host.subscribeEvent((message) => {
		if (message.event.type === 'device.settings.changed') {
			listener(message.event.settings);
		}
	});
}

export function subscribeDesktopPerformanceLogging(
	listener: (enabled: boolean) => void,
): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const host = window.terminayHost as unknown as NativeEventBridge | undefined;
	if (host === undefined) return () => undefined;
	return host.subscribeEvent((message) => {
		if (message.event.type === 'diagnostics.performance-logging.changed') {
			listener(message.event.enabled);
		}
	});
}

/** Desktop is waiting for the exposing computer to approve the match code it
 * shows here. Browser hosts never receive this event: their session shell
 * renders the code itself. */
export function subscribePairingApproval(
	listener: (
		approval: Readonly<{ deviceName: string; matchCode: string; expiresAt: string }>,
	) => void,
): () => void {
	if (typeof window === 'undefined') return () => undefined;
	const host = window.terminayHost as unknown as NativeEventBridge | undefined;
	if (host === undefined) return () => undefined;
	return host.subscribeEvent((message) => {
		if (message.event.type === 'connection.pairing-approval') {
			listener({
				deviceName: message.event.deviceName,
				matchCode: message.event.matchCode,
				expiresAt: message.event.expiresAt,
			});
		}
	});
}
