/**
 * A window on a client that does not control its terminal: a live, read-only
 * mirror of the view the controlling client is running (ADR-0039).
 *
 * The mirror document goes into the same sandbox proxy as a view. It is drawn
 * at the size the view has on the controlling client and scaled to this
 * window's width, and nothing typed or clicked here reaches it.
 */

import type { AppWindow, AppWindowClient } from '@terminay/client-core';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { APP_VIEW_SANDBOX, appViewProxyUrl } from './appViewAvailability';
import type { AppWindowPane } from './appWindowPanes';
import { buildMirrorDocument } from './mirror/mirrorDocument.ts';
import { parseFieldState } from './mirror/fieldState.ts';
import type { AppWindowMirrorHub, MirrorSink } from './mirror/mirrorHub.ts';
import { MIRROR_MESSAGE_KEY, type MirrorReplicaControl } from './mirror/mirrorProtocol.ts';

const PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
const RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
/** The strip under a mirror that says what it is. */
export const MIRROR_BAR_HEIGHT = 30;
const MAX_VIEWPORT = 16_384;

type MirrorProps = Readonly<{
	windowKey: string;
	window: AppWindow;
	client: AppWindowClient;
	mirror: AppWindowMirrorHub;
	pane: AppWindowPane;
	/** The width the window's body has on this client. */
	bodyWidth: number;
	/** Whether the window sizes itself to its content here. */
	autoHeight: boolean;
	onResized: (key: string, height: number) => void;
}>;

type Status = 'loading' | 'live' | 'unavailable';

const dimension = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.min(Math.round(value), MAX_VIEWPORT)
		: undefined;

export function AppWindowMirror(props: MirrorProps): ReactElement {
	const { window: appWindow, client, mirror, pane, bodyWidth } = props;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const [document, setDocument] = useState<string | undefined>(undefined);
	const [status, setStatus] = useState<Status>('loading');
	const [viewport, setViewport] = useState<{ width: number; height: number } | undefined>(undefined);
	const kind = appWindow.source.kind;

	// The mirror may load what the view may load, so it needs the view's policy.
	// A client that cannot read the window's content mirrors it without one.
	useEffect(() => {
		let cancelled = false;
		void client
			.content(appWindow.id)
			.then(
				(content) => content.csp,
				() => undefined,
			)
			.then((csp) => {
				if (!cancelled) setDocument(buildMirrorDocument({ kind }, csp));
			});
		return () => {
			cancelled = true;
		};
	}, [client, appWindow.id, kind]);

	useEffect(() => {
		if (document === undefined) return;
		let stopWatching: (() => void) | undefined;
		let resourceSent = false;
		const post = (message: unknown): void =>
			frameRef.current?.contentWindow?.postMessage(message, '*');
		const sink: MirrorSink = {
			apply: (batchKind, data) => {
				const control: MirrorReplicaControl = { type: 'apply', kind: batchKind, data };
				post({ [MIRROR_MESSAGE_KEY]: control });
				if (batchKind === 'snapshot') setStatus('live');
			},
			loading: () => setStatus('loading'),
			unavailable: () => setStatus('unavailable'),
		};
		const onMessage = (event: MessageEvent): void => {
			if (frameRef.current === null || event.source !== frameRef.current.contentWindow) return;
			const data = event.data as Record<string, unknown> | null;
			if (data?.method === PROXY_READY) {
				// Once per proxy document, as for a view.
				if (resourceSent) return;
				resourceSent = true;
				post({ jsonrpc: '2.0', method: RESOURCE_READY, params: { html: document, allow: '' } });
				return;
			}
			const report = data?.[MIRROR_MESSAGE_KEY] as Record<string, unknown> | undefined;
			if (typeof report !== 'object' || report === null) return;
			if (report.type === 'ready') {
				// The replica can draw now, so this is when to start receiving. It
				// says so once; whatever says it again is not asking for a mirror.
				if (stopWatching !== undefined) return;
				stopWatching = mirror.watch(appWindow.terminalSessionId, appWindow.id, sink);
			} else if (report.type === 'size') {
				const width = dimension(report.width);
				const height = dimension(report.height);
				if (width !== undefined && height !== undefined) setViewport({ width, height });
				// The replica reports its size once it has drawn what it was given.
				mirror.drawn(appWindow.terminalSessionId);
			} else if (report.type === 'failed') {
				mirror.failed(appWindow.terminalSessionId, appWindow.id);
			} else if (report.type === 'state') {
				// Kept in case this client takes control: it goes into the view that starts here.
				const state = parseFieldState(report.state);
				if (state !== undefined) mirror.rememberState(appWindow.terminalSessionId, appWindow.id, state);
			}
		};
		window.addEventListener('message', onMessage);
		return () => {
			window.removeEventListener('message', onMessage);
			stopWatching?.();
		};
	}, [document, mirror, appWindow.terminalSessionId, appWindow.id]);

	const scale = viewport === undefined ? 1 : bodyWidth / viewport.width;
	const scaledHeight = viewport === undefined ? 0 : Math.round(viewport.height * scale);
	const { windowKey, autoHeight, onResized } = props;
	useEffect(() => {
		if (!autoHeight) return;
		// Until there is something to show, leave room for the waiting notice.
		onResized(windowKey, (status === 'live' && scaledHeight > 0 ? scaledHeight : 72) + MIRROR_BAR_HEIGHT);
	}, [autoHeight, onResized, windowKey, status, scaledHeight]);

	return (
		<div className="app-window__mirror" data-status={status}>
			<div className="app-window__mirror-stage">
				{document === undefined ? null : (
					<iframe
						ref={frameRef}
						className="app-window__mirror-frame"
						title={`Mirror of ${appWindow.title}`}
						src={appViewProxyUrl()}
						sandbox={APP_VIEW_SANDBOX}
						referrerPolicy="no-referrer"
						tabIndex={-1}
						aria-hidden={status !== 'live'}
						style={
							viewport === undefined
								? { width: bodyWidth, height: 1 }
								: {
										width: viewport.width,
										height: viewport.height,
										transform: `scale(${scale})`,
									}
						}
					/>
				)}
				{status === 'live' ? null : (
					<p className="app-window__mirror-status" role="status">
						{status === 'loading'
							? 'Waiting for the device controlling the terminal…'
							: 'This window cannot be mirrored right now. It is running on the device controlling the terminal.'}
					</p>
				)}
			</div>
			<div className="app-window__mirror-bar">
				<span>Mirror, view only. Taking control keeps what is filled in.</span>
				<button type="button" onClick={pane.takeControl}>
					Take control
				</button>
			</div>
		</div>
	);
}
