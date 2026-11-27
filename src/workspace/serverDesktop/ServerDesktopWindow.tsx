/**
 * The server desktop: one window per client window, showing the whole
 * desktop of the server this window is on.
 *
 * The server owns everything that matters here. It decides whether there is
 * a desktop, who controls it, and what mode each stream is in; this window
 * shows what it said and asks for changes by name. Closing the window ends
 * only this window's stream: the desktop, and a setup in progress, carry on.
 */

import {
	type ServerDesktopClient,
	type ServerDesktopController,
	type ServerDesktopMode,
	type ServerDesktopStatus,
	serverDesktopRefusal,
} from '@terminay/client-core';
import {
	RemoteDesktopCanvas,
	type RemoteDesktopClassNames,
	type RemoteDesktopSharingState,
	type RemoteDesktopStream,
} from '@terminay/remote-desktop/ui';
import { Monitor } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { desktopClipboardHost } from '../../host/desktopClipboardHost';
import { writeClipboardText } from '../../host/nativeActions';
import { InPageWindow } from '../../shared/inPageWindow/InPageWindow';
import {
	ServerDesktopBar,
	ServerDesktopStateView,
	type ServerDesktopViewerState,
} from './ServerDesktopViews';
import {
	controlWasTaken,
	deviceLabel,
	serverDesktopTitle,
} from './serverDesktopModel.ts';
import './serverDesktop.css';

const classNames: RemoteDesktopClassNames = {
	root: 'server-desktop-vnc',
	thumbnail: 'server-desktop-vnc--thumb',
	layer: 'server-desktop-vnc__layer',
	pasteCatcher: 'server-desktop-vnc__paste-catcher',
};

const DEFAULT_SIZE = { width: 1280, height: 860 } as const;

function failureText(error: unknown): string {
	const refusal = serverDesktopRefusal(error);
	if (refusal?.reason === 'not-ready') return 'The desktop is not running.';
	if (refusal?.reason === 'unsupported')
		return 'This server cannot show a desktop.';
	if (refusal?.reason === 'setup-by-command')
		return 'Setup has to be run on the server.';
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 0 ? message : 'The server refused the request.';
}

/** A new client, which a new connection makes, is a new desktop stream. */
const clientKeys = new WeakMap<object, number>();
let clientCount = 0;
function clientKey(client: object): number {
	let key = clientKeys.get(client);
	if (key === undefined) {
		key = ++clientCount;
		clientKeys.set(client, key);
	}
	return key;
}

/** What the server says about its desktop, followed while the window is open. */
export function useServerDesktop(client: ServerDesktopClient): {
	readonly status: ServerDesktopStatus | undefined;
	readonly controller: ServerDesktopController | null;
	readonly error: string | undefined;
	readonly busy: boolean;
	/** Run a request; its answer, when it is a status, is shown at once. */
	readonly run: (
		request: () => Promise<ServerDesktopStatus | undefined>,
	) => Promise<boolean>;
	readonly checkAgain: () => Promise<boolean>;
	readonly clearError: () => void;
} {
	const [status, setStatus] = useState<ServerDesktopStatus>();
	const [controller, setController] = useState<ServerDesktopController | null>(
		null,
	);
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const live = useRef(true);

	useEffect(() => {
		live.current = true;
		let stop: (() => void) | undefined;
		const load = () =>
			client.status().then(
				(snapshot) => {
					if (!live.current) return;
					setStatus(snapshot.status);
					setController(snapshot.controller);
				},
				(cause: unknown) => {
					if (live.current) setError(failureText(cause));
				},
			);
		void load();
		void client
			.watch({
				status: (next) => {
					if (live.current) setStatus(next);
				},
				controller: (next) => {
					if (live.current) setController(next);
				},
				// Events may have been missed while the connection was away.
				resync: () => void load(),
			})
			.then(
				(off) => {
					if (live.current) stop = off;
					else off();
				},
				(cause: unknown) => {
					if (live.current) setError(failureText(cause));
				},
			);
		return () => {
			live.current = false;
			stop?.();
		};
	}, [client]);

	const run = useCallback(
		async (request: () => Promise<ServerDesktopStatus | undefined>) => {
			setBusy(true);
			setError(undefined);
			try {
				const next = await request();
				if (live.current && next !== undefined) setStatus(next);
				return true;
			} catch (cause) {
				if (live.current) setError(failureText(cause));
				return false;
			} finally {
				if (live.current) setBusy(false);
			}
		},
		[],
	);
	const checkAgain = useCallback(
		() =>
			run(async () => {
				const snapshot = await client.status();
				if (live.current) setController(snapshot.controller);
				return snapshot.status;
			}),
		[client, run],
	);
	return {
		status,
		controller,
		error,
		busy,
		run,
		checkAgain,
		clearError: useCallback(() => setError(undefined), []),
	};
}

/** The running desktop: the bar and the viewer. */
function ServerDesktopViewer({
	client,
	display,
	controller,
	busy,
	onTurnOff,
}: Readonly<{
	client: ServerDesktopClient;
	display: number;
	controller: ServerDesktopController | null;
	busy: boolean;
	/** Ask to turn the desktop off. Resolves to the open-window count when the
	 * server wants confirmation, `true` when it is off, `false` on failure. */
	onTurnOff: (confirmed: boolean) => Promise<boolean | { windows?: number }>;
}>) {
	// What the next stream asks for. The server answers with the mode.
	const request = useRef<'open' | 'take' | 'release'>('open');
	const requesting = useRef(false);
	const ownClientId = useRef<string | undefined>(undefined);
	const [attempt, setAttempt] = useState(0);
	const [mode, setMode] = useState<ServerDesktopMode>();
	const modeNow = useRef<ServerDesktopMode | undefined>(undefined);
	const [state, setState] = useState<ServerDesktopViewerState>('connecting');
	const [failure, setFailure] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [sharing, setSharing] = useState<RemoteDesktopSharingState>('inactive');
	const [confirming, setConfirming] = useState<{ windows?: number }>();

	const open = useCallback(async (): Promise<RemoteDesktopStream> => {
		const which = request.current;
		request.current = 'open';
		requesting.current = true;
		try {
			const stream =
				which === 'take'
					? await client.takeControl()
					: which === 'release'
						? await client.releaseControl()
						: await client.open();
			modeNow.current = stream.mode;
			setMode(stream.mode);
			if (stream.mode === 'control')
				ownClientId.current = stream.controller?.clientId;
			return stream;
		} finally {
			requesting.current = false;
		}
	}, [client]);

	const reopen = useCallback((which: 'open' | 'take' | 'release') => {
		request.current = which;
		setAttempt((n) => n + 1);
	}, []);

	// Another device took control: say so, and carry on as a viewer. The
	// server already ended this window's controlling stream.
	useEffect(() => {
		if (
			!controlWasTaken({
				mode: modeNow.current,
				ownClientId: ownClientId.current,
				requesting: requesting.current,
				controller,
			}) ||
			controller === null
		)
			return;
		setNotice(`Taken over by ${deviceLabel(controller)}.`);
		modeNow.current = 'view-only';
		setMode('view-only');
		reopen('open');
	}, [controller, reopen]);

	const turnOff = async (confirmed: boolean) => {
		const answer = await onTurnOff(confirmed);
		setConfirming(typeof answer === 'object' ? answer : undefined);
	};

	return (
		<div
			className="server-desktop"
			data-server-desktop-state="ready"
			data-server-desktop-viewer={state}
		>
			<ServerDesktopBar
				mode={mode}
				controller={controller}
				display={display}
				state={state}
				busy={busy}
				{...(notice === undefined ? {} : { notice })}
				{...(confirming === undefined ? {} : { confirmingTurnOff: confirming })}
				onTakeControl={() => {
					setNotice(undefined);
					reopen('take');
				}}
				onReleaseControl={() => reopen('release')}
				onReconnect={() => reopen('open')}
				onTurnOff={() => void turnOff(false)}
				onConfirmTurnOff={() => void turnOff(true)}
				onCancelTurnOff={() => setConfirming(undefined)}
			/>
			{failure === undefined ? null : (
				<p className="server-desktop__reason" role="alert">
					{failure}
				</p>
			)}
			<div className="server-desktop__frame">
				<RemoteDesktopCanvas
					open={open}
					streamKey={`${clientKey(client)}:${display}`}
					// The server decides the mode; the stream says which it got.
					mode="view-only"
					attempt={attempt}
					resize
					clipboard={desktopClipboardHost}
					classNames={classNames}
					describeFailure={failureText}
					rootAttributes={{ 'data-server-desktop-canvas': mode ?? 'none' }}
					onState={(next, why) => {
						setState(next);
						setFailure(why);
					}}
					onSharing={setSharing}
				/>
			</div>
			{mode === 'control' && state === 'open' ? (
				<div className="server-desktop__foot" data-server-desktop-sharing={sharing}>
					{sharing === 'active'
						? 'Clipboard text is shared both ways while you control this desktop.'
						: sharing === 'syncing'
							? 'Starting clipboard sharing…'
							: sharing === 'unavailable'
								? 'Use your device’s paste shortcut to send text to the desktop.'
								: 'Click the desktop to share your clipboard with it.'}
				</div>
			) : null}
		</div>
	);
}

/** The window's contents for one server. */
export function ServerDesktopContent({
	client,
}: Readonly<{ client: ServerDesktopClient }>) {
	const desktop = useServerDesktop(client);
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const clear = setTimeout(() => setCopied(false), 2_000);
		return () => clearTimeout(clear);
	}, [copied]);

	const { status } = desktop;
	if (status === undefined)
		return (
			<div className="server-desktop__state" data-server-desktop-state="loading">
				{desktop.error === undefined ? (
					<p className="server-desktop__faint">Asking the server…</p>
				) : (
					<p className="server-desktop__reason" role="alert">
						{desktop.error}
					</p>
				)}
			</div>
		);
	if (status.state === 'ready')
		return (
			<ServerDesktopViewer
				client={client}
				display={status.display}
				controller={desktop.controller}
				busy={desktop.busy}
				onTurnOff={async (confirmed) => {
					let windows: { windows?: number } | undefined;
					const done = await desktop.run(async () => {
						try {
							return await client.disable(confirmed);
						} catch (cause) {
							const refusal = serverDesktopRefusal(cause);
							if (refusal?.reason !== 'windows-open') throw cause;
							// Not a failure: the server wants a yes first.
							windows =
								refusal.windows === undefined
									? {}
									: { windows: refusal.windows };
							return undefined;
						}
					});
					return windows ?? done;
				}}
			/>
		);
	return (
		<ServerDesktopStateView
			status={status}
			busy={desktop.busy}
			copied={copied}
			{...(desktop.error === undefined ? {} : { error: desktop.error })}
			actions={{
				onSetup: () => void desktop.run(() => client.setup()),
				onCheckAgain: () => void desktop.checkAgain(),
				onTurnOn: () => void desktop.run(() => client.enable()),
				onCopyCommand: (command) => {
					void writeClipboardText(command).then(
						() => setCopied(true),
						() => undefined,
					);
				},
			}}
		/>
	);
}

/** The one desktop window of this client window. */
export function ServerDesktopWindow({
	client,
	serverLabel,
	onClose,
}: Readonly<{
	client: ServerDesktopClient;
	serverLabel: string;
	onClose: () => void;
}>) {
	// Portalled out of the header so its window-drag regions cannot sit over it.
	return createPortal(
		<InPageWindow
			icon={<Monitor size={14} aria-hidden="true" />}
			kind={{ resizable: true, id: 'server-desktop', defaultSize: DEFAULT_SIZE }}
			name="server-desktop"
			className="server-desktop-window"
			title={serverDesktopTitle(serverLabel)}
			onClose={onClose}
		>
			<ServerDesktopContent client={client} />
		</InPageWindow>,
		document.body,
	);
}
