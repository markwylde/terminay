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
