/**
 * Renders every terminal's app windows (terminal-app-windows).
 *
 * The host is mounted once, outside the docking layout, and positions each
 * window over the pane of the terminal that owns it. A window and its
 * minimised tab are one element that is restyled and moved, never re-parented,
 * so a view keeps its state through minimise, terminal switches, and project
 * switches. Only the client that controls a terminal runs its views.
 */

import type { AppWindow, AppWindowClient } from '@terminay/client-core';
import {
	type PointerEvent as ReactPointerEvent,
	type ReactElement,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { openExternalUrl } from '../../host/nativeActions';
import {
	APP_VIEW_SANDBOX,
	appViewAvailable,
	appViewProxyUrl,
} from './appViewAvailability';
import {
	type AppWindowPane,
	appWindowPanesSnapshot,
	isPaneVisible,
	markAppWindowSeen,
	markAppWindowUnseen,
	retainAppWindowUnseen,
	subscribeAppWindowPanes,
} from './appWindowPanes';
import {
	AppWindowsContext,
	appWindowPaneKey,
} from './useServerAppWindows';
import { AppWindowMirror } from './AppWindowMirror';
import { isNotControllerError } from './controlErrors.ts';
import { MIRROR_RECORDER_SCRIPT } from './mirror/bundles.generated.ts';
import type { AppWindowMirrorHub } from './mirror/mirrorHub.ts';
import { MIRROR_MESSAGE_KEY, type MirrorLoaderControl } from './mirror/mirrorProtocol.ts';
import { ViewRecorderLink } from './mirror/recorderLink.ts';
import { AppViewBridge, type ViewHostContext } from './viewBridge';
import { buildViewDocument } from './viewDocument';
import {
	layoutAppWindows,
	type PlacedWindow,
	TAB_MAX_WIDTH,
	tabOffsetAfterDrag,
	WINDOW_HEADER_HEIGHT,
	WINDOW_HEADER_HEIGHT_NARROW,
} from './windowLayout';
import './AppWindowHost.css';

/** Fired by the workspace when the docking layout or active project changes. */
export const APP_WINDOW_LAYOUT_EVENT = 'terminay-app-window-layout';
const RAIL_VARIABLE = '--app-window-rail';
const RAIL_SELECTOR = ':scope > .terminal-app-window-rail';
const TERMINAL_SELECTOR = ':scope > .terminal-panel-root';
/** A phone or tablet: focusing the terminal there raises the software keyboard. */
const TOUCH_DEVICE_QUERY = '(hover: none) and (pointer: coarse)';
/**
 * How long a view that is about to be removed is kept after it has been told,
 * so that it hears. A frame that is removed at once never receives the message.
 */
const VIEW_TEARDOWN_GRACE_MS = 150;
/** Messages between a view's sandbox proxy and the workspace; never relayed for a view. */
const PROXY_KEY = 'terminayProxy';
/** A Tab pressed in the workspace this recently is what moved the focus into a view. */
const FOCUS_BY_TAB_MS = 500;

type PaneFrame = Readonly<{
	left: number;
	top: number;
	width: number;
	height: number;
	visible: boolean;
}>;

type WindowEntry = Readonly<{
	key: string;
	paneKey: string;
	serverId: string;
	window: AppWindow;
	client: AppWindowClient;
	/** Present when this server mirrors views to clients not in control. */
	mirror?: AppWindowMirrorHub;
}>;

const sameFrame = (left: PaneFrame | undefined, right: PaneFrame): boolean =>
	left !== undefined &&
	left.left === right.left &&
	left.top === right.top &&
	left.width === right.width &&
	left.height === right.height &&
	left.visible === right.visible;

/** A tab's width for its title, without measuring the DOM. */
function tabWidthFor(title: string): number {
	return Math.min(TAB_MAX_WIDTH, 46 + Math.ceil([...title].length * 7.4));
}

export function AppWindowHost(): ReactElement | null {
	const byServer = useContext(AppWindowsContext);
	const panes = useSyncExternalStore(
		subscribeAppWindowPanes,
		appWindowPanesSnapshot,
		appWindowPanesSnapshot,
	);
	const [available, setAvailable] = useState<boolean | undefined>(undefined);
	const [frames, setFrames] = useState<ReadonlyMap<string, PaneFrame>>(() => new Map());
	const [contentHeights, setContentHeights] = useState<ReadonlyMap<string, number>>(
		() => new Map(),
	);
	const [tabOffsets, setTabOffsets] = useState<ReadonlyMap<string, number>>(() => new Map());
	const [fullscreen, setFullscreen] = useState<ReadonlyMap<string, string>>(() => new Map());

	const entries = useMemo<readonly WindowEntry[]>(() => {
		const list: WindowEntry[] = [];
		for (const server of byServer.values())
			for (const window of server.windows)
				list.push({
					key: `${server.serverId}:${window.id}`,
					paneKey: appWindowPaneKey(server.serverId, window.terminalSessionId),
					serverId: server.serverId,
					window,
					client: server.client,
					...(server.mirror === undefined ? {} : { mirror: server.mirror }),
				});
		return list;
	}, [byServer]);

	// Probe the sandbox proxy the first time any window exists.
	const hasWindows = entries.length > 0;
	useEffect(() => {
		if (!hasWindows || available !== undefined) return;
		let cancelled = false;
		void appViewAvailable().then((value) => {
			if (!cancelled) setAvailable(value);
		});
		return () => {
			cancelled = true;
		};
	}, [hasWindows, available]);

	// --- follow each pane's rectangle ---
	const panesRef = useRef(panes);
	panesRef.current = panes;
	const measure = useCallback(() => {
		setFrames((previous) => {
			let changed = false;
			const next = new Map<string, PaneFrame>();
			for (const [key, pane] of panesRef.current) {
				const rect = pane.element.getBoundingClientRect();
				// Windows and tabs end where the rail ends. A pane may put rows of
				// its own under the rail (on a phone, the keyboard's command bar),
				// and nothing of a window may cover those.
				const rail = pane.element.querySelector(RAIL_SELECTOR)?.getBoundingClientRect();
				const bottom =
					rail !== undefined && rail.bottom > rect.top
						? Math.min(rail.bottom, rect.bottom)
						: rect.bottom;
				const frame: PaneFrame = {
					left: Math.round(rect.left),
					top: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(bottom - rect.top),
					visible: isPaneVisible(pane),
				};
				if (!sameFrame(previous.get(key), frame)) changed = true;
				next.set(key, frame);
			}
			return changed || next.size !== previous.size ? next : previous;
		});
	}, []);

	useLayoutEffect(() => {
		if (typeof ResizeObserver === 'undefined') return;
		let queued = false;
		const schedule = (): void => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				measure();
			});
		};
		const observer = new ResizeObserver(schedule);
		for (const pane of panes.values()) {
			observer.observe(pane.element);
			// The rail moves, without the pane changing size, when a row appears
			// under it. The terminal above it changes size whenever that happens.
			const terminal = pane.element.querySelector(TERMINAL_SELECTOR);
			if (terminal !== null) observer.observe(terminal);
		}
		window.addEventListener('resize', schedule);
		window.addEventListener(APP_WINDOW_LAYOUT_EVENT, schedule);
		measure();
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			window.removeEventListener(APP_WINDOW_LAYOUT_EVENT, schedule);
		};
	}, [panes, measure]);

	// --- layout per pane ---
	// A pane that is switched away (an inactive tab, another project) has no
	// size. Its windows stay mounted at their last position, hidden, so their
	// views keep running and keep their state until the pane is shown again.
	const lastFrames = useRef(new Map<string, PaneFrame>());
	const layouts = useMemo(() => {
		const byPane = new Map<string, WindowEntry[]>();
		for (const entry of entries) {
			const list = byPane.get(entry.paneKey) ?? [];
			list.push(entry);
			byPane.set(entry.paneKey, list);
		}
		const placed = new Map<string, PlacedWindow>();
		const rails = new Map<string, number>();
		const narrow = new Map<string, boolean>();
		const effective = new Map<string, PaneFrame>();
		for (const [paneKey, list] of byPane) {
			const measured = frames.get(paneKey);
			const onScreen =
				measured?.visible === true && measured.width > 0 && measured.height > 0;
			const frame = onScreen ? measured : lastFrames.current.get(paneKey);
			if (frame === undefined) continue;
			if (onScreen) lastFrames.current.set(paneKey, frame);
			effective.set(paneKey, { ...frame, visible: onScreen });
			const fullscreenId = fullscreen.get(paneKey);
			const layout = layoutAppWindows({
				paneWidth: frame.width,
				paneHeight: frame.height,
				windows: list.map(({ key, window }) => ({
					id: key,
					state: window.state,
					contentHeight: contentHeights.get(key),
					tabOffset: tabOffsets.get(key),
					tabWidth: tabWidthFor(window.title),
				})),
				...(fullscreenId === undefined ? {} : { fullscreenId }),
			});
			for (const item of layout.windows) placed.set(item.id, item);
			rails.set(paneKey, layout.railHeight);
			narrow.set(paneKey, layout.narrow);
		}
		for (const paneKey of [...lastFrames.current.keys()])
			if (!byPane.has(paneKey)) lastFrames.current.delete(paneKey);
		return { placed, rails, narrow, frames: effective };
	}, [entries, frames, contentHeights, tabOffsets, fullscreen]);

	// The pane reserves the rail under its terminal, so the terminal ends above
	// the tabs. The variable is all the pane needs to know about windows.
	const railed = useRef(new Set<string>());
	useLayoutEffect(() => {
		const next = new Set<string>();
		for (const [paneKey, pane] of panes) {
			if (layouts.frames.get(paneKey)?.visible === false) {
				if (railed.current.has(paneKey)) next.add(paneKey);
				continue;
			}
			const height = layouts.rails.get(paneKey) ?? 0;
			if (height > 0) {
				pane.element.style.setProperty(RAIL_VARIABLE, `${height}px`);
				next.add(paneKey);
			} else if (railed.current.has(paneKey)) {
				pane.element.style.removeProperty(RAIL_VARIABLE);
			}
		}
		railed.current = next;
	}, [panes, layouts]);

	// --- attention: a window that arrived while its terminal was off screen ---
	const known = useRef(new Map<string, Set<string>>());
	useEffect(() => {
		const paneKeys = new Set<string>();
		for (const server of byServer.values()) {
			const seenIds = known.current.get(server.serverId);
			const ids = new Set(server.windows.map((window) => window.id));
			for (const window of server.windows) {
				const paneKey = appWindowPaneKey(server.serverId, window.terminalSessionId);
				paneKeys.add(paneKey);
				// The first list a server sends is what already existed, not news.
				if (
					seenIds !== undefined &&
					!seenIds.has(window.id) &&
					!isPaneVisible(panesRef.current.get(paneKey))
				)
					markAppWindowUnseen(paneKey);
			}
			if (server.loaded) known.current.set(server.serverId, ids);
		}
		retainAppWindowUnseen(paneKeys);
	}, [byServer]);
	useEffect(() => {
		for (const [paneKey, frame] of frames) if (frame.visible) markAppWindowSeen(paneKey);
	}, [frames]);

	// Forget local state for windows that no longer exist.
	useEffect(() => {
		const live = new Set(entries.map((entry) => entry.key));
		const prune = <T,>(map: ReadonlyMap<string, T>): ReadonlyMap<string, T> => {
			if ([...map.keys()].every((key) => live.has(key))) return map;
			return new Map([...map].filter(([key]) => live.has(key)));
		};
		setContentHeights(prune);
		setTabOffsets(prune);
		setFullscreen((previous) => {
			if ([...previous.values()].every((key) => live.has(key))) return previous;
			return new Map([...previous].filter(([, key]) => live.has(key)));
		});
	}, [entries]);

	const onResized = useCallback((key: string, height: number) => {
		setContentHeights((previous) =>
			Math.abs((previous.get(key) ?? 0) - height) < 1
				? previous
				: new Map(previous).set(key, height),
		);
	}, []);
	const onTabOffset = useCallback((key: string, offset: number) => {
		setTabOffsets((previous) => new Map(previous).set(key, offset));
	}, []);
	const onFullscreen = useCallback((paneKey: string, key: string | undefined) => {
		setFullscreen((previous) => {
			const next = new Map(previous);
			if (key === undefined) next.delete(paneKey);
			else next.set(paneKey, key);
			return next;
		});
	}, []);

	// A window that has ended is kept, hidden, for a moment after it leaves the
	// server's list, so that its view can be told it is going before its frame
	// is removed. This is worked out while rendering: a window dropped for even
	// one render would lose its frame at once.
	const liveKeys = new Set(entries.map((entry) => entry.key));
	const previousEntries = useRef<readonly WindowEntry[]>([]);
	const leaving = useRef(new Map<string, WindowEntry>());
	for (const entry of previousEntries.current)
		if (!liveKeys.has(entry.key) && !leaving.current.has(entry.key))
			leaving.current.set(entry.key, entry);
	for (const key of liveKeys) leaving.current.delete(key);
	previousEntries.current = entries;
	const [, forget] = useState(0);
	// Which windows are leaving, not how many: one returning as another leaves
	// is a change, though the count is the same.
	const leavingKeys = [...leaving.current.keys()].join('\n');
	useEffect(() => {
		if (leavingKeys === '') return;
		const keys = leavingKeys.split('\n');
		const timer = setTimeout(() => {
			for (const key of keys) leaving.current.delete(key);
			forget((count) => count + 1);
		}, VIEW_TEARDOWN_GRACE_MS * 2);
		return () => clearTimeout(timer);
	}, [leavingKeys]);
	const departing = [...leaving.current.values()];
	const lastShown = useRef(
		new Map<string, { frame: PaneFrame; placed: PlacedWindow; pane: AppWindowPane; narrow: boolean }>(),
	);

	if (entries.length === 0 && departing.length === 0) return null;
	for (const key of [...lastShown.current.keys()])
		if (!liveKeys.has(key) && !leaving.current.has(key)) lastShown.current.delete(key);
	return (
		<div className="app-window-host">
			{[...entries, ...departing].map((entry) => {
				const isLeaving = !liveKeys.has(entry.key);
				const shown = isLeaving
					? lastShown.current.get(entry.key)
					: (() => {
							const frame = layouts.frames.get(entry.paneKey);
							const placed = layouts.placed.get(entry.key);
							const pane = panes.get(entry.paneKey);
							if (frame === undefined || placed === undefined || pane === undefined)
								return undefined;
							const next = {
								frame,
								placed,
								pane,
								narrow: layouts.narrow.get(entry.paneKey) === true,
							};
							lastShown.current.set(entry.key, next);
							return next;
						})();
				if (shown === undefined) return null;
				return (
					<AppWindowCard
						key={entry.key}
						entry={entry}
						pane={shown.pane}
						frame={isLeaving ? { ...shown.frame, visible: false } : shown.frame}
						placed={shown.placed}
						narrow={shown.narrow}
						available={available}
						isFullscreen={fullscreen.get(entry.paneKey) === entry.key}
						leaving={isLeaving}
						onResized={onResized}
						onTabOffset={onTabOffset}
						onFullscreen={onFullscreen}
					/>
				);
			})}
		</div>
	);
}

type CardProps = Readonly<{
	entry: WindowEntry;
	pane: AppWindowPane;
	frame: PaneFrame;
	placed: PlacedWindow;
	narrow: boolean;
	available: boolean | undefined;
	isFullscreen: boolean;
	/** The window has ended and is kept only until its view has been told. */
	leaving: boolean;
	onResized: (key: string, height: number) => void;
	onTabOffset: (key: string, offset: number) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

function AppWindowCard(props: CardProps): ReactElement {
	const { entry, pane, frame, placed, narrow, available } = props;
	const { window: appWindow, client } = entry;
	const isTab = placed.placement === 'tab';
	const hidden = !frame.visible || placed.placement === 'hidden';
	const drag = useRef<{ startX: number; offset: number; moved: boolean } | null>(null);
	/** The press that just ended moved the tab, so its click is not an activation. */
	const dragged = useRef(false);
	const [dragging, setDragging] = useState(false);
	// A view runs here while this client controls the terminal. When that stops
	// being so (control moves, the window is closing) the view is told, and its
	// frame is kept for a moment so that it hears.
	const teardownRef = useRef<((reason: string) => void) | null>(null);
	const wantView = available === true && pane.isController && !props.leaving;
	const [showView, setShowView] = useState(wantView);
	// A view that has been told it is going does go, even if the reason passes
	// before its frame is removed: it is then started afresh, not left running
	// after being told it was over.
	const told = useRef(false);
	useEffect(() => {
		if (!showView) {
			told.current = false;
			if (wantView) setShowView(true);
			return;
		}
		if (wantView && !told.current) return;
		if (!told.current) {
			told.current = true;
			teardownRef.current?.('closed');
		}
		const timer = setTimeout(() => setShowView(false), VIEW_TEARDOWN_GRACE_MS);
		return () => clearTimeout(timer);
	}, [wantView, showView]);
	// The host sits outside the pane, so the window borrows the pane's colours
	// explicitly: it should look like part of the terminal it belongs to.
	const colours = useMemo(() => {
		const style = getComputedStyle(pane.element);
		const background = style.backgroundColor || '#111316';
		const text = style.color || '#e6e6e6';
		return {
			color: text,
			'--app-window-surface': `color-mix(in srgb, ${text} 7%, ${background})`,
			'--app-window-border': `color-mix(in srgb, ${text} 24%, ${background})`,
		};
	}, [pane.element, frame.visible]);

	const restore = (): void => void client.setState(appWindow.id, 'open').catch(() => {});
	// On a touch device the focus stays where it was: focusing the terminal
	// would raise the software keyboard over what the user is looking at.
	const returnFocus = (): void => {
		if (!matchMedia(TOUCH_DEVICE_QUERY).matches) pane.focusTerminal();
	};
	const minimise = (): void => {
		props.onFullscreen(entry.paneKey, undefined);
		void client.setState(appWindow.id, 'minimised').catch(() => {});
		returnFocus();
	};
	const close = (): void => {
		void client.close(appWindow.id).catch(() => {});
		returnFocus();
	};

	// Only a minimised window can be dragged, and only along the bottom edge.
	const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
		if ((event.target as HTMLElement).closest('button') !== null) {
			// A tapped control does not take the focus, so a terminal that has the
			// keyboard up keeps it.
			if (event.pointerType === 'touch') event.preventDefault();
			return;
		}
		if (!isTab) return;
		dragged.current = false;
		drag.current = { startX: event.clientX, offset: placed.rect.x, moved: false };
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// A pointer that is already gone cannot be captured; the drag still
			// works while it stays over the tab.
		}
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
		const state = drag.current;
		if (state === null) return;
		const delta = event.clientX - state.startX;
		if (!state.moved && Math.abs(delta) < 5) return;
		state.moved = true;
		setDragging(true);
		props.onTabOffset(
			entry.key,
			tabOffsetAfterDrag(state.offset, delta, placed.rect.width, frame.width),
		);
	};
	const onPointerUp = (): void => {
		const state = drag.current;
		drag.current = null;
		setDragging(false);
		dragged.current = state?.moved === true;
	};
	// A tab opens on the click, not on the pointer's release. The click comes
	// after the release, so opening on the release would leave that click to
	// land on whatever the opening window had put under the pointer by then:
	// on a phone, its minimise control.
	const onTabClick = (): void => {
		if (dragged.current) dragged.current = false;
		else restore();
	};

	const source =
		appWindow.source.kind === 'agent'
			? 'Agent'
			: `${appWindow.source.server} · ${appWindow.source.tool}`;
	return (
		<section
			className={`app-window${dragging ? ' app-window--dragging' : ''}`}
			data-placement={placed.placement}
			data-narrow={narrow ? 'true' : undefined}
			data-hidden={hidden ? 'true' : undefined}
			aria-label={`${appWindow.title} window`}
			style={{
				...colours,
				left: frame.left + placed.rect.x,
				top: frame.top + placed.rect.y,
				width: placed.rect.width,
				height: placed.rect.height,
			}}
		>
			<header
				className="app-window__header"
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					drag.current = null;
					setDragging(false);
				}}
				{...(isTab
					? {
							role: 'button',
							tabIndex: 0,
							'aria-label': `Open ${appWindow.title}`,
							onClick: onTabClick,
							onKeyDown: (event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									restore();
								}
							},
						}
					: {})}
			>
				<span className="app-window__glyph" aria-hidden="true">
					▣
				</span>
				<span className="app-window__title">{appWindow.title}</span>
				{isTab ? null : (
					<>
						<span className="app-window__source">{source}</span>
						<span className="app-window__spacer" />
						<button type="button" aria-label="Minimise window" onClick={minimise}>
							–
						</button>
						<button
							type="button"
							aria-label={props.isFullscreen ? 'Restore window size' : 'Fill the pane'}
							onClick={() =>
								props.onFullscreen(
									entry.paneKey,
									props.isFullscreen ? undefined : entry.key,
								)
							}
						>
							⤢
						</button>
						<button type="button" aria-label="Close window" onClick={close}>
							×
						</button>
					</>
				)}
			</header>
			<div className="app-window__body">
				{available === false ? (
					<p className="app-window__notice">
						App windows cannot be shown on this connection.
					</p>
				) : showView ? (
					<AppWindowView
						entry={entry}
						pane={pane}
						placed={placed}
						narrow={narrow}
						teardownRef={teardownRef}
						onResized={props.onResized}
						onFullscreen={props.onFullscreen}
					/>
				) : props.leaving ? null : !pane.isController &&
					entry.mirror !== undefined &&
					available === true ? (
					// A minimised window shows only its tab, so it mirrors nothing.
					isTab ? null : (
						<AppWindowMirror
							windowKey={entry.key}
							window={appWindow}
							client={client}
							mirror={entry.mirror}
							pane={pane}
							bodyWidth={placed.bodyWidth}
							autoHeight={placed.placement === 'window' || placed.placement === 'sheet'}
							onResized={props.onResized}
						/>
					)
				) : !pane.isController ? (
					<div className="app-window__notice">
						<p>This window runs on the device controlling the terminal.</p>
						<button type="button" onClick={pane.takeControl}>
							Take control
						</button>
					</div>
				) : null}
			</div>
		</section>
	);
}

type ViewProps = Readonly<{
	entry: WindowEntry;
	pane: AppWindowPane;
	placed: PlacedWindow;
	narrow: boolean;
	/** Set by the view: tells it that it is about to be removed. */
	teardownRef: { current: ((reason: string) => void) | null };
	onResized: (key: string, height: number) => void;
	onFullscreen: (paneKey: string, key: string | undefined) => void;
}>;

/** One running view: the sandbox proxy frame and its bridge. */
function AppWindowView(props: ViewProps): ReactElement {
	const { entry, pane, placed, narrow } = props;
	const { window: appWindow, client } = entry;
	const frameRef = useRef<HTMLIFrameElement | null>(null);
	const bridgeRef = useRef<AppViewBridge | null>(null);
	const recorderRef = useRef<ViewRecorderLink | null>(null);
	/** The view's own document has spoken, so it is running and can be recorded. */
	const viewAliveRef = useRef(false);
	const [allow, setAllow] = useState<string | undefined>(undefined);
	const [recorderCount, setRecorderCount] = useState(0);
	const mirror = entry.mirror;
	// An agent may replace its document, which is a new view; an MCP App's
	// revision only means its tool result arrived.
	const documentKey =
		appWindow.source.kind === 'agent'
			? `${appWindow.id}:${appWindow.contentRevision}`
			: appWindow.id;
	// The document actually on screen. It follows `documentKey` a moment late,
	// so the view being replaced is told before its frame is taken away.
	const [activeKey, setActiveKey] = useState(documentKey);
	const [failed, setFailed] = useState(false);
	// The view's frame was removed by its proxy: the page tried to become another.
	const [gone, setGone] = useState(false);

	const latest = useRef({ placed, narrow, pane, entry, props });
	latest.current = { placed, narrow, pane, entry, props };

	const hostContext = useCallback((): ViewHostContext => {
		const { placed: place, narrow: isNarrow, pane: currentPane } = latest.current;
		const style = getComputedStyle(currentPane.element);
		const fill = place.placement === 'fullscreen';
		return {
			displayMode: fill ? 'fullscreen' : 'pip',
			platform: isNarrow ? 'mobile' : 'desktop',
			touch: isNarrow || matchMedia('(pointer: coarse)').matches,
			width: place.bodyWidth,
			...(fill ? { height: place.bodyHeight ?? 0 } : { maxHeight: place.bodyMaxHeight }),
			theme: 'dark',
			variables: themeVariables(style),
		};
	}, []);

	const asController = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			// Only a lapsed lease is worth a second try. A permission the user
			// declined is an answer, and asking again would prompt them again.
			if (!isNotControllerError(error)) throw error;
			await latest.current.pane.renewControl();
			return work();
		}
	}, []);

	// Fetch the content, then start (or update) the view.
	useEffect(() => {
		let cancelled = false;
		void client
			.content(appWindow.id)
			.then((content) => {
				if (cancelled) return;
				const kind = content.window.source.kind;
				const built = buildViewDocument({
					html: content.html,
					source: { kind },
					...(content.csp === undefined ? {} : { csp: content.csp }),
					...(content.permissions === undefined
						? {}
						: { permissions: content.permissions }),
				});
				const bridgeContent = {
					html: built.html,
					allow: built.allow,
					source: kind,
					...(content.tool === undefined ? {} : { tool: content.tool }),
					...(content.toolInput === undefined ? {} : { toolInput: content.toolInput }),
					...(content.toolResult === undefined ? {} : { toolResult: content.toolResult }),
					...(content.toolCancelled === undefined
						? {}
						: { toolCancelled: content.toolCancelled }),
				} as const;
				// While another client watches this terminal, the view is recorded
				// for it (ADR-0039). The recorder is sent only then. A view that
				// started before this server offered a mirror gets its link now.
				const ensureRecorder = (): void => {
					if (recorderRef.current !== null || mirror === undefined) return;
					recorderRef.current = new ViewRecorderLink({
						post: (message) =>
							frameRef.current?.contentWindow?.postMessage(message, '*'),
						recorderScript: MIRROR_RECORDER_SCRIPT,
						publish: (batch) =>
							asController(() => mirror.publish(appWindow.id, batch)),
					});
					if (viewAliveRef.current) recorderRef.current.viewAlive();
					setRecorderCount((count) => count + 1);
				};
				if (bridgeRef.current !== null) {
					bridgeRef.current.updateContent(bridgeContent);
					ensureRecorder();
					return;
				}
				bridgeRef.current = new AppViewBridge(bridgeContent, {
					post: (message) => frameRef.current?.contentWindow?.postMessage(message, '*'),
					context: hostContext,
					resized: (height) => {
						const place = latest.current.placed.placement;
						// Only meaningful while the view controls its own height.
						if (place === 'window' || place === 'sheet')
							latest.current.props.onResized(latest.current.entry.key, height);
					},
					// The server honours a view only from the client controlling its
					// terminal. This client is that one, but its lease may have lapsed
					// while its timers were paused, so it renews its own lease first.
					sendMessage: (text) =>
						asController(() => client.sendMessage(appWindow.id, text)),
					updateContext: (text) =>
						asController(() => client.updateContext(appWindow.id, text)),
					viewRequest: (method, params) =>
						asController(() =>
							client.viewRequest(appWindow.id, method, params as never),
						),
					openLink: (url) => void openExternalUrl(url),
					requestDisplayMode: (mode) => {
						const current = latest.current;
						current.props.onFullscreen(
							current.entry.paneKey,
							mode === 'fullscreen' ? current.entry.key : undefined,
						);
						return mode;
					},
					close: () => void client.close(appWindow.id).catch(() => {}),
				});
				ensureRecorder();
				setAllow(built.allow);
			})
			.catch(() => {
				// The window ended, this client may not read it, or its content
				// could not be carried. Say so; an empty box explains nothing.
				if (!cancelled && bridgeRef.current === null) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
		// The revision is what changes the content; the active key decides
		// whether the view is new.
	}, [client, appWindow.id, appWindow.contentRevision, activeKey, hostContext, asController, mirror]);

	// A new document is a new view. The old view is told it is going, given a
	// moment to hear it, and only then is its frame replaced.
	useEffect(() => {
		if (documentKey === activeKey) return;
		const replace = (): void => {
			bridgeRef.current = null;
			recorderRef.current = null;
			viewAliveRef.current = false;
			setAllow(undefined);
			setFailed(false);
			setGone(false);
			setActiveKey(documentKey);
		};
		if (bridgeRef.current === null) {
			replace();
			return;
		}
		bridgeRef.current.teardown('replaced');
		const timer = setTimeout(replace, VIEW_TEARDOWN_GRACE_MS);
		return () => clearTimeout(timer);
	}, [documentKey, activeKey]);

	// Whoever removes this view (the window closing, control moving) tells it
	// first through this.
	const { teardownRef } = props;
	useEffect(() => {
		teardownRef.current = (reason) => bridgeRef.current?.teardown(reason);
		return () => {
			teardownRef.current = null;
		};
	}, [teardownRef]);

	// Offer this view to the mirror for as long as it runs. Each new view has
	// its own recorder; the count is what tells this effect one was made.
	useEffect(() => {
		const recorder = recorderRef.current;
		if (recorderCount === 0 || mirror === undefined || recorder === null) return;
		return mirror.registerRecorder(appWindow.terminalSessionId, appWindow.id, recorder);
	}, [recorderCount, mirror, appWindow.terminalSessionId, appWindow.id]);

	useEffect(() => {
		const onMessage = (event: MessageEvent): void => {
			if (frameRef.current === null || event.source !== frameRef.current.contentWindow)
				return;
			// What the proxy itself says about the view, which a view cannot send.
			const proxy = (event.data as { [PROXY_KEY]?: { type?: unknown; id?: unknown; active?: unknown } } | null)?.[PROXY_KEY];
			if (typeof proxy === 'object' && proxy !== null) {
				if (proxy.type === 'view-gone') setGone(true);
				else if (proxy.type === 'activation' && proxy.id === focusQuestion.current && proxy.active !== true) {
					// The view has the keyboard and nobody gave it: it took the focus
					// itself. Keys meant for the terminal would go to it, and one of
					// them would count as the gesture that lets it type back. The
					// focus goes back where it was.
					if (document.activeElement === frameRef.current) {
						frameRef.current?.blur();
						latest.current.pane.focusTerminal();
					}
				}
				return;
			}
			const recorder = recorderRef.current;
			if (recorder?.handle(event.data) === true) return;
			// Anything a view says other than its proxy announcing itself shows
			// that the view's own document is running and can be recorded.
			const method = (event.data as { method?: unknown } | null)?.method;
			if (typeof method !== 'string' || !method.startsWith('ui/notifications/sandbox-'))
{
				if (!viewAliveRef.current) {
					// This client was mirroring the window until it took control.
					// What the mirror showed a person had typed, ticked and chosen
					// goes into the view that has just started in its place.
					const { entry: current } = latest.current;
					const state = current.mirror?.takeState(
						current.window.terminalSessionId,
						current.window.id,
					);
					if (state !== undefined) {
						const restore: MirrorLoaderControl = { type: 'restore', state };
						frameRef.current?.contentWindow?.postMessage({ [MIRROR_MESSAGE_KEY]: restore }, '*');
					}
				}
				viewAliveRef.current = true;
				recorder?.viewAlive();
			}
			void bridgeRef.current?.handle(event.data);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	// A view can take the keyboard focus by itself. When the focus moves into
	// this view's frame, the proxy is asked whether a person has just acted in
	// it; the answer is handled with the proxy's other messages above. Tabbing
	// in from the workspace is a person's doing and needs no asking.
	const focusQuestion = useRef(0);
	useEffect(() => {
		let lastTab = 0;
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === 'Tab') lastTab = Date.now();
		};
		const onBlur = (): void => {
			// The focused element is settled once the event has been dispatched.
			setTimeout(() => {
				const frame = frameRef.current;
				if (frame === null || document.activeElement !== frame) return;
				if (Date.now() - lastTab < FOCUS_BY_TAB_MS) return;
				focusQuestion.current += 1;
				frame.contentWindow?.postMessage(
					{ [PROXY_KEY]: { type: 'activation?', id: focusQuestion.current } },
					'*',
				);
			}, 0);
		};
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('blur', onBlur);
		};
	}, []);

	// Tell the view when its container changes.
	const contextKey = `${placed.placement}:${placed.bodyWidth}:${placed.bodyHeight ?? ''}:${placed.bodyMaxHeight ?? ''}:${narrow}`;
	useEffect(() => {
		bridgeRef.current?.contextChanged();
	}, [contextKey]);

	if (failed)
		return <p className="app-window__notice">This window could not be loaded.</p>;
	if (gone)
		return (
			<p className="app-window__notice">
				This window stopped because its page tried to leave or replace itself.
			</p>
		);
	if (allow === undefined) return <div className="app-window__loading" aria-busy="true" />;
	return (
		<iframe
			key={activeKey}
			ref={frameRef}
			className="app-window__frame"
			title={appWindow.title}
			src={appViewProxyUrl()}
			sandbox={APP_VIEW_SANDBOX}
			referrerPolicy="no-referrer"
			{...(allow === '' ? {} : { allow })}
		/>
	);
}

/** The standard MCP Apps theme variables, taken from the pane the view is in. */
function themeVariables(style: CSSStyleDeclaration): Record<string, string> {
	const background = style.backgroundColor || '#111316';
	const text = style.color || '#e6e6e6';
	return {
		'--color-background-primary': background,
		'--color-background-secondary': `color-mix(in srgb, ${text} 6%, ${background})`,
		'--color-background-tertiary': `color-mix(in srgb, ${text} 11%, ${background})`,
		'--color-text-primary': text,
		'--color-text-secondary': `color-mix(in srgb, ${text} 68%, ${background})`,
		'--color-text-tertiary': `color-mix(in srgb, ${text} 48%, ${background})`,
		'--color-border-primary': `color-mix(in srgb, ${text} 22%, ${background})`,
		'--color-border-secondary': `color-mix(in srgb, ${text} 13%, ${background})`,
		'--color-ring-primary': style.getPropertyValue('--accent-color').trim() || '#8fb7e8',
		'--font-sans': 'system-ui, -apple-system, "Segoe UI", sans-serif',
		'--font-mono': 'ui-monospace, Menlo, Consolas, monospace',
		'--border-radius-sm': '4px',
		'--border-radius-md': '6px',
		'--border-radius-lg': '10px',
	};
}

export const APP_WINDOW_HEADER_HEIGHTS = {
	desktop: WINDOW_HEADER_HEIGHT,
	narrow: WINDOW_HEADER_HEIGHT_NARROW,
} as const;
