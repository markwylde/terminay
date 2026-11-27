/**
 * A remote desktop drawn by noVNC over a Terminay byte stream.
 *
 * The canvas knows nothing about what the desktop belongs to. Its owner opens
 * the stream, and says how the device clipboard is reached. Each mode is its
 * own server stream, so changing the mode opens a new one; in view-only mode
 * the server discards input and the viewer also sets noVNC's own flag.
 */

import RFB from '@novnc/novnc';
import { useEffect, useRef } from 'react';
import { RfbStreamChannel } from '../client/rfbChannel.js';
import { attachDesktopClipboard } from './desktopClipboard.js';
import {
	attachDesktopClipboardSharing,
	type DesktopClipboardSharing,
} from './desktopClipboardSharing.js';

import {
	type RemoteDesktopMode,
	type RemoteDesktopStream,
	remoteDesktopViewerSettings,
} from './viewerSettings.js';

export type RemoteDesktopSharingState =
	| 'syncing'
	| 'active'
	| 'inactive'
	| 'unavailable';

export type RemoteDesktopState = 'connecting' | 'open' | 'closed' | 'failed';

/** How the canvas reaches the device clipboard. Read at each connection. */
export interface RemoteDesktopClipboardHost {
	/** The host's two-way sync, or undefined where the host has none. */
	readonly sharing: () => DesktopClipboardSharing | undefined;
	readonly writeText: (text: string) => Promise<void>;
	/** The host's clipboard read for the paste shortcut. Undefined in a
	 * browser, which uses the native paste. */
	readonly readText: () => (() => Promise<string | undefined>) | undefined;
}

export interface RemoteDesktopClassNames {
	readonly root: string;
	/** Added to the root for a thumbnail. */
	readonly thumbnail: string;
	readonly layer: string;
	readonly pasteCatcher: string;
}

let generation = 0;

export function RemoteDesktopCanvas({
	open,
	streamKey,
	mode,
	thumbnail = false,
	attempt = 0,
	clipboard,
	classNames,
	describeFailure,
	rootAttributes,
	resize = false,
	onState,
	onPasteTooLarge,
	onSharing,
}: Readonly<{
	/** Opens one stream. `generation` rises with every call on this page.
	 * A stream that says its own `mode` is shown in that mode: where the
	 * server decides who controls, the mode asked for is only a request. */
	open: (
		generation: number,
		mode: RemoteDesktopMode,
		thumbnail: boolean,
	) => Promise<RemoteDesktopStream>;
	/** Changes when the canvas should show a different desktop. */
	streamKey: string;
	mode: RemoteDesktopMode;
	thumbnail?: boolean;
	attempt?: number;
	clipboard: RemoteDesktopClipboardHost;
	classNames: RemoteDesktopClassNames;
	describeFailure: (cause: unknown) => string;
	/** Extra attributes for the root element, such as test hooks. */
	rootAttributes?: Readonly<Record<string, string>>;
	/** Ask the desktop to take the size of this element while this client
	 * controls it. A viewer, and a desktop that refuses, is scaled to fit. */
	resize?: boolean;
	onState?: (state: RemoteDesktopState, error?: string) => void;
	onPasteTooLarge?: () => void;
	onSharing?: (state: RemoteDesktopSharingState) => void;
}>) {
	const host = useRef<HTMLDivElement>(null);
	const opener = useRef(open);
	opener.current = open;
	const clipboardHost = useRef(clipboard);
	clipboardHost.current = clipboard;
	const names = useRef(classNames);
	names.current = classNames;
	const failure = useRef(describeFailure);
	failure.current = describeFailure;
	const report = useRef(onState);
	report.current = onState;
	const tooLarge = useRef(onPasteTooLarge);
	tooLarge.current = onPasteTooLarge;
	const sharingReport = useRef(onSharing);
	sharingReport.current = onSharing;
	const resizes = useRef(resize);
	resizes.current = resize;
	// The thumbnail is always view-only. Otherwise each mode is its own
	// server stream, so the server enforces view-only.
	const streamMode: RemoteDesktopMode = thumbnail ? 'view-only' : mode;
	// Connections drawn into stacked layers. A new stream draws hidden behind
	// the one on screen and replaces it once connected, so switching modes or
	// reconnecting never flashes an empty frame.
	const layers = useRef<DesktopLayer[]>([]);

	// streamKey and attempt are not read below: each asks for a new stream.
	useEffect(() => {
		const root = host.current;
		if (root === null) return;
		const el = document.createElement('div');
		el.className = names.current.layer;
		el.style.visibility = layers.current.length > 0 ? 'hidden' : 'visible';
		root.appendChild(el);
		const layer: DesktopLayer = { el, shown: false };
		layers.current.push(layer);
		const others = () => layers.current.filter((l) => l !== layer);
		const show = () => {
			if (layer.retired) return;
			layer.shown = true;
			el.style.visibility = 'visible';
			for (const old of others()) retire(layers.current, old);
			report.current?.('open');
		};
		if (layers.current.length === 1) report.current?.('connecting');
		opener
			.current(++generation, streamMode, thumbnail)
			.then((stream) => {
				if (layer.retired) {
					void stream.close();
					return;
				}
				const channel = new RfbStreamChannel(stream);
				const rfb = new RFB(el, channel, { shared: true });
				layer.rfb = rfb;
				layer.channel = channel;
				const settings = remoteDesktopViewerSettings({
					requested: streamMode,
					granted: stream.mode,
					thumbnail,
					resize: resizes.current,
				});
				rfb.viewOnly = settings.viewOnly;
				rfb.scaleViewport = settings.scaleViewport;
				rfb.resizeSession = settings.resizeSession;
				rfb.focusOnClick = !thumbnail;
				rfb.background = '#0d0f12';
				// Clipboard sharing is control mode only (ADR-0129). View-only
				// streams never read or write either clipboard.
				if (settings.clipboard) {
					const sharingHost = clipboardHost.current.sharing();
					let sharingState: RemoteDesktopSharingState = sharingHost
						? 'syncing'
						: 'unavailable';
					const sharing = sharingHost
						? attachDesktopClipboardSharing(rfb, sharingHost, {
								onState: (next) => {
									sharingState = next;
									sharingReport.current?.(next);
								},
								onTooLarge: () => tooLarge.current?.(),
							})
						: undefined;
					layer.sharing = sharing;
					sharingReport.current?.(sharingState);
					const select = () => {
						if (!sharing?.selected()) sharing?.claim();
					};
					el.addEventListener('pointerdown', select, { capture: true });
					el.addEventListener('focusin', select, { capture: true });
					layer.detachSharing = () => {
						el.removeEventListener('pointerdown', select, { capture: true });
						el.removeEventListener('focusin', select, { capture: true });
						sharing?.dispose();
					};
					rfb.addEventListener('connect', () => sharing?.claim());
					// The paste shortcut lands here: an editable target is what
					// makes Chromium (and macOS Edit › Paste) raise a native paste.
					const catcher = document.createElement('textarea');
					catcher.className = names.current.pasteCatcher;
					catcher.tabIndex = -1;
					catcher.setAttribute('aria-hidden', 'true');
					catcher.autocomplete = 'off';
					catcher.spellcheck = false;
					el.appendChild(catcher);
					layer.detachClipboard = attachDesktopClipboard(el, rfb, {
						sharingOwnsClipboard: () =>
							sharing !== undefined && sharingState !== 'unavailable',
						isMac: /mac|iphone|ipad|ipod/i.test(navigator.platform),
						focusedInside: () => el.contains(document.activeElement),
						documentFocused: () => document.hasFocus(),
						visible: () => document.visibilityState === 'visible',
						writeHostClipboard: (text) =>
							clipboardHost.current.writeText(text),
						onPasteTooLarge: () => tooLarge.current?.(),
						pasteRoot: document,
						readHostText: clipboardHost.current.readText(),
						catcher: {
							focus: () => catcher.focus({ preventScroll: true }),
							restore: () => {
								catcher.value = '';
								if (document.activeElement === catcher) rfb.focus();
							},
						},
					});
				}
				// Give noVNC a moment to paint its first frame before swapping.
				rfb.addEventListener('connect', () => setTimeout(show, 150));
				rfb.addEventListener('disconnect', () => {
					if (layer.retired) return;
					retire(layers.current, layer);
					if (layers.current.length === 0) report.current?.('closed');
				});
				channel.start();
			})
			.catch((cause: unknown) => {
				if (layer.retired) return;
				// Never leave a stream of the wrong mode on screen.
				for (const l of [...layers.current]) retire(layers.current, l);
				report.current?.('failed', failure.current(cause));
			});
		return () => {
			// A layer still connecting is abandoned. The one on screen stays
			// until its replacement connects, or until the canvas unmounts.
			layer.detachSharing?.();
			layer.detachClipboard?.();
			if (!layer.shown) retire(layers.current, layer);
		};
	}, [streamKey, streamMode, thumbnail, attempt]);

	useEffect(
		() => () => {
			for (const l of [...layers.current]) retire(layers.current, l);
		},
		[],
	);

	return (
		<div
			className={`${classNames.root}${thumbnail ? ` ${classNames.thumbnail}` : ''}`}
			ref={host}
			{...rootAttributes}
		/>
	);
}

type DesktopLayer = {
	el: HTMLDivElement;
	shown: boolean;
	retired?: boolean;
	rfb?: RFB;
	channel?: RfbStreamChannel;
	detachClipboard?: () => void;
	detachSharing?: () => void;
	sharing?: ReturnType<typeof attachDesktopClipboardSharing>;
};

function retire(list: DesktopLayer[], layer: DesktopLayer): void {
	if (layer.retired) return;
	layer.retired = true;
	const at = list.indexOf(layer);
	if (at >= 0) list.splice(at, 1);
	layer.detachClipboard?.();
	layer.detachSharing?.();
	try {
		layer.rfb?.disconnect();
	} catch {
		// Already gone.
	}
	layer.channel?.close();
	layer.el.remove();
}
