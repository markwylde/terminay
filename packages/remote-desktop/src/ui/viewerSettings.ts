/**
 * How the viewer is set for one stream, apart from the viewer itself so it
 * can be reasoned about and tested without a browser.
 */

import type { RfbByteStream } from '../client/rfbChannel.js';
import type { DesktopMode } from '../index.js';

export type RemoteDesktopMode = DesktopMode;

/** A byte stream, and the mode it was opened in when its opener knows. */
export interface RemoteDesktopStream extends RfbByteStream {
	readonly mode?: RemoteDesktopMode;
}

/**
 * How the viewer is set for one stream. Input, clipboard sharing, and
 * resizing the desktop belong to a controlling stream that is not a
 * thumbnail; every stream is scaled to fit, which is all a viewer gets and
 * what a controller falls back to when the desktop keeps its size.
 */
export function remoteDesktopViewerSettings(options: {
	readonly requested: RemoteDesktopMode;
	/** The mode the stream itself reports, which wins over the request. */
	readonly granted?: RemoteDesktopMode | undefined;
	readonly thumbnail: boolean;
	readonly resize: boolean;
}): {
	readonly mode: RemoteDesktopMode;
	readonly viewOnly: boolean;
	readonly scaleViewport: boolean;
	readonly resizeSession: boolean;
	readonly clipboard: boolean;
} {
	const mode: RemoteDesktopMode = options.thumbnail
		? 'view-only'
		: (options.granted ?? options.requested);
	const controls = mode === 'control';
	return {
		mode,
		viewOnly: !controls,
		scaleViewport: true,
		resizeSession: controls && options.resize,
		clipboard: controls,
	};
}
