/**
 * The device clipboard as this host offers it to a remote desktop, whichever
 * desktop that is: a bot's or a server's.
 */

import type { RemoteDesktopClipboardHost } from '@terminay/remote-desktop/ui';
import {
	desktopClipboardSharing,
	desktopClipboardUploadRoute,
	writeClipboardText,
} from './nativeActions';

/** Desktop's clipboard read for the paste shortcut: text only, never copied
 * files or images. Undefined in a browser, which uses the native paste. */
export function readDesktopClipboardText():
	| (() => Promise<string | undefined>)
	| undefined {
	const route = desktopClipboardUploadRoute();
	if (route === undefined) return undefined;
	return async () => {
		const contents = await route.read();
		return contents.kind === 'text' ? contents.text : undefined;
	};
}

export const desktopClipboardHost: RemoteDesktopClipboardHost = {
	sharing: desktopClipboardSharing,
	writeText: writeClipboardText,
	readText: readDesktopClipboardText,
};
