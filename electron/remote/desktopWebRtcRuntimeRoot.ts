import path from 'node:path';

export interface DesktopWebRtcRuntimeRootOptions {
	readonly isPackaged: boolean;
	readonly resourcesPath: string;
	readonly environment?: Readonly<Record<string, string | undefined>>;
}

/**
 * Resolve only the selected-runtime directory layout already governed by
 * electron-builder and the standalone launcher. This does not enable WebRTC:
 * callers must still supply an authenticated hosted signaling registrar.
 */
export function resolveDesktopWebRtcRuntimeRoot(
	options: DesktopWebRtcRuntimeRootOptions,
): string | undefined {
	if (typeof options.resourcesPath !== 'string' || !path.isAbsolute(options.resourcesPath)) {
		throw new TypeError('Desktop resources path must be absolute.');
	}
	if (options.isPackaged) {
		return path.join(options.resourcesPath, 'webrtc-runtime');
	}
	const configured =
		options.environment?.TERMINAY_WEBRTC_RUNTIME_ROOT?.trim() ??
		process.env.TERMINAY_WEBRTC_RUNTIME_ROOT?.trim();
	if (!configured) return undefined;
	if (!path.isAbsolute(configured) || configured.includes('\0')) {
		throw new TypeError(
			'TERMINAY_WEBRTC_RUNTIME_ROOT must be an absolute runtime directory.',
		);
	}
	return path.normalize(configured);
}
