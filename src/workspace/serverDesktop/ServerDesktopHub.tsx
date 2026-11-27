/**
 * The server desktop as this client window shows it: one stream, however many
 * places show it.
 *
 * The desktop can be shown in the header's dropdown and in any number of
 * tabs, in projects and in Home. They all share one stream of the desktop and
 * one noVNC viewer. The viewer's element is moved into the tab that was
 * focused last, which is where input, the clipboard, and the desktop's size
 * come from. Every other place draws a copy of that viewer's picture, only
 * while it is on screen. With no tab showing, the viewer waits out of sight
 * at the desktop's own size, so the dropdown can show it without resizing it.
 *
 * The server owns everything that matters here. It decides whether there is
 * a desktop, who controls it, and what mode the stream is in; this window
 * shows what it said and asks for changes by name. Closing every place that
 * shows the desktop ends only this window's stream: the desktop, and a setup
 * in progress, carry on.
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
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { desktopClipboardHost } from '../../host/desktopClipboardHost';
import type { ServerDesktopViewerState } from './ServerDesktopViews';
import { controlWasTaken, deviceLabel } from './serverDesktopModel.ts';
import './serverDesktop.css';

const classNames: RemoteDesktopClassNames = {
	root: 'server-desktop-vnc',
	thumbnail: 'server-desktop-vnc--thumb',
	layer: 'server-desktop-vnc__layer',
	pasteCatcher: 'server-desktop-vnc__paste-catcher',
};

export function failureText(error: unknown): string {
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

/** What the server says about its desktop, followed while anything shows it. */
export function useServerDesktop(client: ServerDesktopClient | undefined): {
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
		setStatus(undefined);
		setController(null);
		setError(undefined);
		if (client === undefined) return;
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
				if (client === undefined) return undefined;
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

/** One place that shows the desktop. */
type Surface = Readonly<{
	kind: 'tab' | 'dropdown';
	/** Where the viewer goes when this place is the one in use. */
	slot: HTMLElement | null;
	/** On screen now. */
	visible: boolean;
	/** When it was last focused; the latest visible tab holds the viewer. */
	focusedAt: number;
}>;

export type ServerDesktopHubValue = Readonly<{
	client: ServerDesktopClient;
	serverId: string;
	serverLabel: string;
	status: ServerDesktopStatus | undefined;
	controller: ServerDesktopController | null;
	error: string | undefined;
	busy: boolean;
	/** The mode the server gave this window's stream; undefined until it has. */
	mode: ServerDesktopMode | undefined;
	viewer: ServerDesktopViewerState;
	failure: string | undefined;
	notice: string | undefined;
	sharing: RemoteDesktopSharingState;
	confirmingTurnOff: Readonly<{ windows?: number }> | undefined;
	/** The place that holds the viewer, if a tab does. */
	primaryId: string | undefined;
	setup: () => void;
	checkAgain: () => void;
	turnOn: () => void;
	takeControl: () => void;
	releaseControl: () => void;
	reconnect: () => void;
	turnOff: (confirmed: boolean) => void;
	cancelTurnOff: () => void;
	/** Say a place exists; returns how to forget it. */
	register: (id: string, kind: Surface['kind']) => () => void;
	update: (id: string, change: Partial<Omit<Surface, 'kind'>>) => void;
	/** Make a tab the one in use. */
	focus: (id: string) => void;
	/** The viewer's picture, for the places that copy it. */
	picture: () => HTMLCanvasElement | null;
}>;

const HubContext = createContext<ServerDesktopHubValue | null>(null);

/** The desktop of the server this window is on, or null when it has none. */
export function useServerDesktopHub(): ServerDesktopHubValue | null {
	return useContext(HubContext);
}

export function ServerDesktopHubProvider({
	client,
	serverId,
	serverLabel,
	children,
}: Readonly<{
	client: ServerDesktopClient | undefined;
	serverId: string;
	serverLabel: string;
	children: ReactNode;
}>) {
	const desktop = useServerDesktop(client);
	const [surfaces, setSurfaces] = useState<ReadonlyMap<string, Surface>>(
		() => new Map(),
	);

	// The viewer's own element, and where it waits while no tab shows it.
	const viewerElement = useMemo(() => {
		const element = document.createElement('div');
		element.className = 'server-desktop-hub';
		return element;
	}, []);
	const parking = useMemo(() => {
		const element = document.createElement('div');
		element.className = 'server-desktop-hub-parking';
		element.setAttribute('aria-hidden', 'true');
		return element;
	}, []);
	useEffect(() => {
		document.body.appendChild(parking);
		return () => parking.remove();
	}, [parking]);

	const primaryId = useMemo(() => {
		let best: [string, Surface] | undefined;
		for (const entry of surfaces) {
			const [, surface] = entry;
			if (surface.kind !== 'tab' || !surface.visible || surface.slot === null)
				continue;
			if (best === undefined || surface.focusedAt > best[1].focusedAt)
				best = entry;
		}
		return best?.[0];
	}, [surfaces]);
	const primarySlot =
		primaryId === undefined ? null : (surfaces.get(primaryId)?.slot ?? null);
	useLayoutEffect(() => {
		const target = primarySlot ?? parking;
		if (viewerElement.parentElement !== target)
			target.appendChild(viewerElement);
	}, [primarySlot, parking, viewerElement]);

	const register = useCallback((id: string, kind: Surface['kind']) => {
		setSurfaces((was) => {
			const next = new Map(was);
			next.set(id, { kind, slot: null, visible: false, focusedAt: Date.now() });
			return next;
		});
		return () =>
			setSurfaces((was) => {
				if (!was.has(id)) return was;
				const next = new Map(was);
				next.delete(id);
				return next;
			});
	}, []);
	const update = useCallback(
		(id: string, change: Partial<Omit<Surface, 'kind'>>) =>
			setSurfaces((was) => {
				const surface = was.get(id);
				if (surface === undefined) return was;
				if (
					(change.slot === undefined || change.slot === surface.slot) &&
					(change.visible === undefined ||
						change.visible === surface.visible) &&
					change.focusedAt === undefined
				)
					return was;
				const next = new Map(was);
				next.set(id, { ...surface, ...change });
				return next;
			}),
		[],
	);
	const focus = useCallback(
		(id: string) => update(id, { focusedAt: Date.now() }),
		[update],
	);

	// --- The one stream -------------------------------------------------
	const ready = desktop.status?.state === 'ready';
	const wanted = client !== undefined && ready && surfaces.size > 0;
	const display =
		ready && desktop.status?.state === 'ready' ? desktop.status.display : 0;
	const request = useRef<'open' | 'take' | 'release'>('open');
	const requesting = useRef(false);
	const ownClientId = useRef<string | undefined>(undefined);
	const [attempt, setAttempt] = useState(0);
	const [mode, setMode] = useState<ServerDesktopMode>();
	const modeNow = useRef<ServerDesktopMode | undefined>(undefined);
	const [viewer, setViewer] = useState<ServerDesktopViewerState>('connecting');
	const [failure, setFailure] = useState<string>();
	const [notice, setNotice] = useState<string>();
	const [sharing, setSharing] = useState<RemoteDesktopSharingState>('inactive');
	const [confirming, setConfirming] = useState<{ windows?: number }>();

	useEffect(() => {
		if (wanted) return;
		// The next stream starts from scratch.
		modeNow.current = undefined;
		setMode(undefined);
		setViewer('connecting');
		setFailure(undefined);
		setSharing('inactive');
	}, [wanted]);

	const open = useCallback(async (): Promise<RemoteDesktopStream> => {
		if (client === undefined) throw new Error('This server has no desktop.');
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
	const { controller } = desktop;
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

	// A takeover notice is said once, then gets out of the way.
	useEffect(() => {
		if (notice === undefined) return;
		const clear = setTimeout(() => setNotice(undefined), 8_000);
		return () => clearTimeout(clear);
	}, [notice]);

	const { run } = desktop;
	const turnOff = useCallback(
		(confirmed: boolean) => {
			if (client === undefined) return;
			let windows: { windows?: number } | undefined;
			void run(async () => {
				try {
					return await client.disable(confirmed);
				} catch (cause) {
					const refusal = serverDesktopRefusal(cause);
					if (refusal?.reason !== 'windows-open') throw cause;
					// Not a failure: the server wants a yes first.
					windows =
						refusal.windows === undefined ? {} : { windows: refusal.windows };
					return undefined;
				}
			}).then(() => setConfirming(windows));
		},
		[client, run],
	);

	const picture = useCallback((): HTMLCanvasElement | null => {
		const layers = viewerElement.querySelectorAll<HTMLElement>(
			`.${classNames.layer}`,
		);
		for (let i = layers.length - 1; i >= 0; i--) {
			const layer = layers[i];
			if (layer === undefined || layer.style.visibility === 'hidden') continue;
			const canvas = layer.querySelector('canvas');
			if (canvas !== null) return canvas;
		}
		return null;
	}, [viewerElement]);

	const value = useMemo<ServerDesktopHubValue | null>(
		() =>
			client === undefined
				? null
				: {
						client,
						serverId,
						serverLabel,
						status: desktop.status,
						controller: desktop.controller,
						error: desktop.error,
						busy: desktop.busy,
						mode,
						viewer,
						failure,
						notice,
						sharing,
						confirmingTurnOff: confirming,
						primaryId,
						setup: () => void desktop.run(() => client.setup()),
						checkAgain: () => void desktop.checkAgain(),
						turnOn: () => void desktop.run(() => client.enable()),
						takeControl: () => {
							setNotice(undefined);
							reopen('take');
						},
						releaseControl: () => reopen('release'),
						reconnect: () => reopen('open'),
						turnOff,
						cancelTurnOff: () => setConfirming(undefined),
						register,
						update,
						focus,
						picture,
					},
		[
			client,
			serverId,
			serverLabel,
			desktop,
			mode,
			viewer,
			failure,
			notice,
			sharing,
			confirming,
			primaryId,
			reopen,
			turnOff,
			register,
			update,
			focus,
			picture,
		],
	);

	return (
		<HubContext.Provider value={value}>
			{children}
			{wanted
				? createPortal(
						<RemoteDesktopCanvas
							open={open}
							streamKey={`${clientKey(client)}:${display}`}
							// The server decides the mode; the stream says which it got.
							mode="view-only"
							attempt={attempt}
							// Only a tab's size is the desktop's; out of sight it keeps its own.
							resize={primaryId !== undefined}
							clipboard={desktopClipboardHost}
							classNames={classNames}
							describeFailure={failureText}
							rootAttributes={{ 'data-server-desktop-canvas': mode ?? 'none' }}
							onState={(next, why) => {
								setViewer(next);
								setFailure(why);
							}}
							onSharing={setSharing}
						/>,
						viewerElement,
					)
				: null}
		</HubContext.Provider>
	);
}
